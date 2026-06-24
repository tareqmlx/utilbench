import { downloadBlob, parsePageRanges, readFileBytes, validatePdfFile } from "@/lib/pdf";
import type { ValidationResult } from "@/lib/pdf";
import {
  PDFJS_ASSETS,
  buildBaseName,
  canvasToBlob,
  computeOutputDims,
  getPdfjs,
  probePdf,
  renderPageToBlob,
} from "@/lib/pdfjs-render";
import type { ImageFormat, PageSize, PdfProbe } from "@/lib/pdfjs-render";

// Re-export the shared PDF helpers Route.tsx actually consumes so it imports
// from one module and tests mock a single path.
export { downloadBlob, parsePageRanges, readFileBytes, validatePdfFile };
export type { ValidationResult };

// Re-export the moved pdf.js render-core pieces that Route.tsx / the tests still
// import from "./renderer".
export { buildBaseName, canvasToBlob, computeOutputDims, getPdfjs, probePdf };
export type { ImageFormat, PageSize, PdfProbe };

// ── Constants & types (§5.1) ──────────────────────────────────────────────

export const DPI_PRESETS = [72, 96, 150, 300] as const;
export type DpiPreset = (typeof DPI_PRESETS)[number];
export const DEFAULT_DPI: DpiPreset = 150;
export const DEFAULT_JPEG_QUALITY = 0.9; // document-scan sweet spot (0.8–0.92); JPEG only

// DPI-aware output-page cap: bitmap AREA is the real cost, so the cap shrinks
// as DPI rises to keep peak memory/time roughly constant across presets.
export const MAX_OUTPUT_PAGES_BY_DPI: Record<number, number> = {
  72: 500,
  96: 400,
  150: 300,
  300: 150,
};

export function maxOutputPages(dpi: number): number {
  return MAX_OUTPUT_PAGES_BY_DPI[dpi] ?? 150; // unknown DPI ⇒ conservative floor
}

export interface RenderOptions {
  dpi: number; // target DPI; scale = dpi / 72 (§5.3)
  format: ImageFormat;
  jpegQuality: number; // 0..1, applied only when format === "jpeg"
  pageRange: string; // "" / "all" ⇒ every page; else parsed by parsePageRanges (§5.4)
}

export interface RenderedPage {
  pageNumber: number; // 1-indexed (as in the source PDF)
  blob: Blob;
  filename: string; // e.g. "report-page-03.png"
  width: number; // output px (post area-clamp)
  height: number; // output px
  clamped: boolean; // true if the effective DPI was reduced by the canvas-area guard
}

export interface PageFailure {
  pageNumber: number;
  message: string;
}

// renderPdfToImages returns BOTH successes and per-page failures (collect-and-continue).
export interface RenderResult {
  pages: RenderedPage[];
  failures: PageFailure[];
}

// ── Page-list resolution (§5.4) ────────────────────────────────────────────

export function resolvePageList(pageRange: string, numPages: number): number[] {
  const spec = pageRange.trim();
  if (spec === "" || spec.toLowerCase() === "all") {
    return Array.from({ length: numPages }, (_, i) => i + 1); // 1..numPages, 1-indexed
  }
  const parsed = parsePageRanges(spec, numPages); // shipped helper from @/lib/pdf (tested)
  if (parsed.error) throw new Error(parsed.error);
  // Flatten to a deduped, ascending, 1-indexed list. parsePageRanges yields
  // ParsedRange[] with 0-based `indices`; convert to 1-based and dedupe.
  const set = new Set<number>();
  for (const r of parsed.ranges) for (const idx of r.indices) set.add(idx + 1);
  const list = [...set].sort((a, b) => a - b);
  if (list.length === 0) throw new Error("No valid pages in that range.");
  return list;
}

// ── Filename helpers (§5.5) ────────────────────────────────────────────────

export function buildImageFilename(
  base: string,
  pageNumber: number,
  pad: number,
  format: ImageFormat,
): string {
  const ext = format === "png" ? "png" : "jpg";
  return `${base || "page"}-page-${String(pageNumber).padStart(pad, "0")}.${ext}`;
}

// ── ZIP assembly (§5.5) ────────────────────────────────────────────────────

export async function zipImages(pages: RenderedPage[]): Promise<Blob> {
  // fflate async zip, level 0 (images already PNG/JPEG-compressed; re-deflating is wasted CPU).
  const entries: Record<string, Uint8Array> = {};
  for (const p of pages) {
    entries[p.filename] = new Uint8Array(await p.blob.arrayBuffer());
  }
  const { zip } = await import("fflate");
  const bytes: Uint8Array = await new Promise((resolve, reject) =>
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))),
  );
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}

// ── Render loop — the heart (§5.5) ─────────────────────────────────────────

export async function renderPdfToImages(
  bytes: Uint8Array, // pass the STORED bytes — do NOT re-read the File
  fileName: string,
  opts: RenderOptions,
  hooks?: {
    onProgress?: (done: number, total: number) => void;
    onPassword?: (reason: "need" | "incorrect") => Promise<string>; // UI prompt; reject ⇒ abort
    signal?: AbortSignal;
  },
): Promise<RenderResult> {
  const lib = await getPdfjs();
  // COPY the bytes: pdf.js detaches the buffer into its worker. The stored copy
  // must survive (re-render at new settings, retry after wrong password).
  const data = bytes.slice();

  const loadingTask = lib.getDocument({ data, ...PDFJS_ASSETS });
  let passwordCancelled = false; // user dismissed the prompt — quiet abort, NOT a password error
  if (hooks?.onPassword) {
    const onPassword = hooks.onPassword;
    loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      const kind = reason === lib.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need";
      onPassword(kind)
        .then(updatePassword)
        .catch(() => {
          passwordCancelled = true;
          void loadingTask.destroy();
        });
    };
  }

  // SINGLE outer try/finally so loadingTask.destroy() ALSO runs when getDocument rejects.
  try {
    let doc: import("pdfjs-dist").PDFDocumentProxy;
    try {
      doc = await loadingTask.promise; // may throw PasswordException / InvalidPDFException
    } catch (e) {
      // Checked FIRST because destroy() rejects loadingTask.promise as a PasswordException-shaped error.
      if (passwordCancelled) throw new DOMException("Aborted", "AbortError");
      // PasswordException is NOT exported in v6 — detect by name only (instanceof would throw).
      const name = (e as { name?: string })?.name;
      if (name === "PasswordException") {
        throw new Error("This PDF is password-protected. Enter the correct password to continue.");
      }
      if (name === "InvalidPDFException") {
        throw new Error("This file is not a valid PDF or is corrupt.");
      }
      throw e;
    }

    const pages = resolvePageList(opts.pageRange, doc.numPages);
    const cap = maxOutputPages(opts.dpi);
    if (pages.length > cap) {
      throw new Error(
        `Too many pages (${pages.length}) at ${opts.dpi} DPI. The limit is ${cap}; lower the DPI or narrow the page range.`,
      );
    }
    const pad = String(doc.numPages).length; // zero-pad width from total page count
    const base = buildBaseName(fileName);
    const out: RenderedPage[] = [];
    const failures: PageFailure[] = [];

    for (let i = 0; i < pages.length; i++) {
      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const pageNumber = pages[i];
      if (pageNumber === undefined) continue; // noUncheckedIndexedAccess guard

      // COLLECT-AND-CONTINUE: one bad page is recorded, not fatal.
      try {
        const page = await doc.getPage(pageNumber);
        try {
          const { blob, clamped, width, height } = await renderPageToBlob(page, {
            dpi: opts.dpi,
            format: opts.format,
            jpegQuality: opts.jpegQuality,
            signal: hooks?.signal,
          });
          const filename = buildImageFilename(base, pageNumber, pad, opts.format);
          out.push({ pageNumber, blob, filename, width, height, clamped });
        } finally {
          page.cleanup(); // page-level intermediates — caller-owned lifecycle
        }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        // Cancel is FATAL (a Cancel press stops the batch). The primitive wires
        // renderTask.cancel() to our signal, so a RenderingCancelledException here is
        // always a user cancel — normalize it to AbortError so the UI shows the
        // quiet "Cancelled." status (§6.4) instead of a red "Rendering cancelled,
        // page N" error alert leaking pdf.js's exception message.
        if (name === "AbortError") throw e;
        if (name === "RenderingCancelledException") throw new DOMException("Aborted", "AbortError");
        failures.push({ pageNumber, message: e instanceof Error ? e.message : String(e) });
      }
      // Honor an abort that landed while no render was in flight — during getPage,
      // dims compute, canvasToBlob, or the inter-page reset — when the primitive's
      // cancel() was a no-op. Without this, a Cancel pressed in that window lets the
      // finished (only/last) page download despite the press.
      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      hooks?.onProgress?.(i + 1, pages.length);
      if (i + 1 < pages.length) await new Promise((r) => setTimeout(r, 0)); // yield so the UI repaints
    }
    if (out.length === 0) {
      throw new Error(
        `No pages could be rendered${failures.length ? ` (${failures.length} failed)` : ""}.`,
      );
    }
    return { pages: out, failures };
  } finally {
    await loadingTask.destroy(); // v6: teardown via the loading task (worker + doc)
  }
}
