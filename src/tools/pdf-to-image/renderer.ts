import { MAX_CANVAS_AREA, MAX_CANVAS_DIM, clampToCanvasLimits } from "@/lib/image";
import {
  downloadBlob,
  getPdfMeta,
  parsePageRanges,
  readFileBytes,
  validatePdfFile,
} from "@/lib/pdf";
import type { ValidationResult } from "@/lib/pdf";
import { PDFDocument } from "pdf-lib";
// Vite emits a hashed asset URL for the pdf.js ES-module worker.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Re-export the shared PDF helpers so Route.tsx imports from one module and
// tests mock a single path.
export { downloadBlob, getPdfMeta, parsePageRanges, readFileBytes, validatePdfFile };
export type { ValidationResult };
export { MAX_CANVAS_AREA, MAX_CANVAS_DIM, clampToCanvasLimits };

// ── Constants & types (§5.1) ──────────────────────────────────────────────

export type ImageFormat = "png" | "jpeg";
export const DPI_PRESETS = [72, 96, 150, 300] as const;
export type DpiPreset = (typeof DPI_PRESETS)[number];
export const DEFAULT_DPI: DpiPreset = 150;
export const DEFAULT_JPEG_QUALITY = 0.9; // document-scan sweet spot (0.8–0.92); JPEG only
export const MAX_OUTPUT_DIMENSION = MAX_CANVAS_DIM; // re-export for the UI readout

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

export interface PageSize {
  width: number;
  height: number;
} // points; from the upload-time probe (§5.6)

export interface PdfProbe {
  pageCount: number;
  encrypted: boolean;
  pageSizes: PageSize[];
}

// ── pdf.js bootstrap (§5.2) ────────────────────────────────────────────────

let pdfjs: typeof import("pdfjs-dist") | null = null;

export async function getPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist"); // dynamic → lands in the vendor-pdfjs chunk
  // Set workerSrc BEFORE the first getDocument, or pdf.js throws.
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjs = lib;
  return lib;
}

// Runtime assets fetched by URL (NOT imports) — staged into public/pdfjs/.
// Absolute paths are mandatory: the worker thread fetches these, and a relative
// URL would resolve against the worker script's URL, not the page.
const PDFJS_ASSETS = {
  cMapUrl: "/pdfjs/cmaps/", // trailing slash REQUIRED — pdf.js concatenates the filename
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  // Tell pdf.js the SAME canvas ceiling the tool clamps to. canvasMaxAreaInBytes
  // is in BYTES — an RGBA px is 4 bytes → MAX_CANVAS_AREA px² × 4.
  canvasMaxAreaInBytes: MAX_CANVAS_AREA * 4,
} as const;

// ── Output dimensions & the DPI↔scale math (§5.3) ──────────────────────────

export function computeOutputDims(
  pageWidthPt: number,
  pageHeightPt: number,
  dpi: number,
): { width: number; height: number; effectiveDpi: number; clamped: boolean } {
  const scale = dpi / 72; // a PDF point is 1/72 in. — NOT /96, NOT devicePixelRatio
  const w = Math.max(1, Math.round(pageWidthPt * scale));
  const h = Math.max(1, Math.round(pageHeightPt * scale));
  const c = clampToCanvasLimits(w, h); // clamps by BOTH max side and max area, preserving aspect
  // If clamped, the effective DPI is lower than requested; report it for the warning + readout.
  const effectiveDpi = c.downscaled ? dpi * (c.width / w) : dpi;
  return { width: c.width, height: c.height, effectiveDpi, clamped: c.downscaled };
}

// ── Page-size probe (§5.6) ─────────────────────────────────────────────────

export async function probePdf(bytes: Uint8Array): Promise<PdfProbe> {
  // pdf-lib does NOT detach the buffer (unlike pdf.js), so no slice() needed here. ONE load.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageSizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize(); // MediaBox — rotation-AGNOSTIC
    // pdf.js getViewport({scale:1}) SWAPS w/h for 90°/270°; match it so the readout/clamp agree.
    const rot = ((p.getRotation().angle % 360) + 360) % 360;
    return rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
  });
  return { pageCount: doc.getPageCount(), encrypted: doc.isEncrypted, pageSizes };
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

// Local replica of split-pdf's tested sanitizer (see split-pdf/splitter.ts:140).
// Replicated rather than cross-imported to avoid the repo's only cross-tool logic import.
export function buildBaseName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "document";
}

// ── Canvas → Blob ──────────────────────────────────────────────────────────

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode canvas to image."))),
      type,
      quality,
    );
  });
}

// ── ZIP assembly (§5.5) ────────────────────────────────────────────────────

export async function zipImages(pages: RenderedPage[], _zipName: string): Promise<Blob> {
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
    const annotationMode = lib.AnnotationMode.DISABLE; // clean page images, no link/widget overlays
    const out: RenderedPage[] = [];
    const failures: PageFailure[] = [];

    // Cancel: interrupt the IN-FLIGHT page, not just between pages.
    let currentRenderTask: import("pdfjs-dist").RenderTask | null = null;
    const onAbort = () => currentRenderTask?.cancel(); // → RenderingCancelledException (fatal)
    hooks?.signal?.addEventListener("abort", onAbort);
    try {
      for (let i = 0; i < pages.length; i++) {
        if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const pageNumber = pages[i];
        if (pageNumber === undefined) continue; // noUncheckedIndexedAccess guard

        // COLLECT-AND-CONTINUE: one bad page is recorded, not fatal.
        try {
          const page = await doc.getPage(pageNumber);
          try {
            const baseVp = page.getViewport({ scale: 1 }); // intrinsic oriented size
            const { width, height, clamped } = computeOutputDims(
              baseVp.width,
              baseVp.height,
              opts.dpi,
            );
            const effScale = width / baseVp.width; // honor the area clamp
            const viewport = page.getViewport({ scale: effScale });

            const canvas = document.createElement("canvas");
            canvas.width = width; // integer dims FROM computeOutputDims (single source)
            canvas.height = height;
            // ALWAYS opaque white for v1. THREE belt-and-suspenders layers:
            //   (a) alpha:false       — opaque output (kills the JPEG black-page trap)
            //   (b) ctx.fillRect white — guarantees a white base under transparent regions
            //   (c) background arg     — pdf.js's OWN documented white-paint mechanism
            const ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) throw new Error("Failed to get 2d canvas context.");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height); // (b) explicit white base

            const renderTask = page.render({
              canvas,
              viewport,
              annotationMode,
              background: "rgb(255,255,255)", // (c) pdf.js documented white paint
            });
            currentRenderTask = renderTask; // expose to onAbort so Cancel interrupts THIS page
            await renderTask.promise; // RenderingCancelledException if cancelled
            currentRenderTask = null;

            const type = opts.format === "png" ? "image/png" : "image/jpeg";
            const blob = await canvasToBlob(
              canvas,
              type,
              opts.format === "jpeg" ? opts.jpegQuality : undefined,
            );
            const filename = buildImageFilename(base, pageNumber, pad, opts.format);
            out.push({
              pageNumber,
              blob,
              filename,
              width: canvas.width,
              height: canvas.height,
              clamped,
            });

            canvas.width = 0; // RELEASE (Safari frees the bitmap on width/height = 0)
            canvas.height = 0;
          } finally {
            page.cleanup(); // free page-level intermediates
          }
        } catch (e) {
          const name = (e as { name?: string })?.name;
          // Abort + render-cancel are FATAL (a Cancel press stops the batch).
          if (name === "AbortError" || name === "RenderingCancelledException") throw e;
          failures.push({ pageNumber, message: e instanceof Error ? e.message : String(e) });
        }
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
      hooks?.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    await loadingTask.destroy(); // v6: teardown via the loading task (worker + doc)
  }
}
