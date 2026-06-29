import { PDFJS_ASSETS, buildBaseName, getPdfjs, renderPageToBlob } from "@/lib/pdfjs-render";
import { PDFDocument, rgb } from "pdf-lib";

// Re-export shared helpers so Route imports from ONE module and tests mock one path.
export { downloadBlob, readFileBytes, validatePdfFile } from "@/lib/pdf";
// PIN 2 (Crit#2): the upload probe is the SHARED probePdf, NOT getPdfMeta —
// getPdfMeta throws on AES encryption and would make the encrypted-Strong path
// unreachable. Re-export the shared one so Route + tests resolve a single source.
export { probePdf } from "@/lib/pdfjs-render";
export type { ValidationResult } from "@/lib/pdf";
export type { PdfProbe } from "@/lib/pdfjs-render";

// ── Constants & types ──────────────────────────────────────────────────────

export type CompressMode = "lossless" | "strong";

export const STRONG_DPI_PRESETS = [72, 96, 150] as const;
export type StrongDpi = (typeof STRONG_DPI_PRESETS)[number];
export const DEFAULT_STRONG_DPI: StrongDpi = 150;
export const DEFAULT_STRONG_QUALITY = 0.6; // JPEG 0..1

// LOCAL Strong page caps (NOT pdf-to-image's MAX_OUTPUT_PAGES_BY_DPI). Stricter @150
// because Strong retains every embedJpg until save(). 200@150 is the shipped default.
export const STRONG_MAX_PAGES_BY_DPI: Record<number, number> = { 72: 500, 96: 400, 150: 200 };
export function maxStrongPages(dpi: number): number {
  return STRONG_MAX_PAGES_BY_DPI[dpi] ?? 150; // unknown DPI ⇒ conservative floor
}

export interface StrongOptions {
  dpi: StrongDpi;
  jpegQuality: number;
}

export interface CompressResult {
  bytes: Uint8Array;
  outputSize: number; // bytes.length
  inputSize: number; // original byte length
  ratio: number; // 1 - outputSize/inputSize (0 when regression-kept)
  keptOriginal: boolean; // true ⇒ regression guard fired; bytes === original input
  mode: CompressMode;
  rasterized: boolean; // true for strong mode
  clampedPages: number; // Strong only: pages whose effective DPI was clamped
  pageCount: number; // output page count — asserted === input in BOTH modes
}

export interface CompressHooks {
  onProgress?: (done: number, total: number) => void;
  onPassword?: (reason: "need" | "incorrect") => Promise<string>; // UI prompt; reject ⇒ abort
  signal?: AbortSignal;
}

// The mode fns return small result objects rather than bare Uint8Arrays so the
// dispatcher can carry clampedPages/pageCount through without re-deriving them
// (the plan's bare-Uint8Array signature note is non-binding; clarity wins).
interface LosslessResult {
  bytes: Uint8Array;
  pageCount: number;
}
interface StrongResult {
  bytes: Uint8Array;
  clampedPages: number;
  pageCount: number;
}

// ── Lossless ────────────────────────────────────────────────────────────────

// pdf-lib structural rewrite: re-save with object streams + nulled metadata. No
// raster, no quality loss. Encrypted input is rejected (Route disables lossless
// for encrypted; defend here too — pdf-lib can't faithfully re-save encrypted).
export async function compressLossless(input: Uint8Array): Promise<LosslessResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true });
  } catch {
    // pdf-lib raises low-level parse errors ("Failed to parse number…") on a
    // corrupt/truncated PDF. Map them to the plan §11.3 friendly message so the
    // raw internal never reaches the UI — mirrors compressStrong's
    // InvalidPDFException handling.
    throw new Error("This file is not a valid PDF or is corrupt.");
  }
  if (doc.isEncrypted) {
    throw new Error("This PDF is encrypted. Use Strong mode to compress it.");
  }
  try {
    const pageCount = doc.getPageCount();
    doc.setProducer("");
    doc.setCreator("");
    const bytes = await doc.save({ useObjectStreams: true });
    // Real symmetry check (§5.2 / L4): re-parse the SAVED bytes and confirm the page
    // count survived the re-serialize. Comparing doc.getPageCount() to itself after
    // save() is tautological — it can never fire; loading the output actually can.
    const verify = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (verify.getPageCount() !== pageCount) {
      throw new Error("Internal error: page count mismatch.");
    }
    return { bytes, pageCount };
  } catch (e) {
    // A PDF can LOAD yet still throw a raw pdf-lib error later — e.g. a broken
    // catalog/Pages tree makes getPageCount()/save() throw "Expected instance of
    // PDFDict…" / "catalog.Pages". Keep our deliberate integrity assert; map every
    // other processing failure to the §11.3 friendly message so no raw internal
    // (which Route now surfaces) reaches the UI.
    if (e instanceof Error && e.message.startsWith("Internal")) throw e;
    throw new Error("This file is not a valid PDF or is corrupt.");
  }
}

// ── Strong (raster) ─────────────────────────────────────────────────────────

// Rasterize every page to JPEG and reassemble. This is the high-risk path: it
// emits ONE PDF, so a dropped page would silently ship a truncated document
// that the byte-size regression guard would NOT catch. PIN 1 (Crit#1): the
// FIRST page-render failure is FATAL — it aborts the whole run (throws, produces
// nothing); per-page errors are never swallowed/collected.
export async function compressStrong(
  input: Uint8Array,
  opts: StrongOptions,
  hooks?: CompressHooks,
): Promise<StrongResult> {
  const lib = await getPdfjs();
  // PIN 3: COPY the bytes BEFORE getDocument — pdf.js DETACHES the input buffer
  // into its worker; the stored copy must survive a retry/re-run.
  const data = input.slice();

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
          // Swallow a rejecting destroy() — fire-and-forget must not surface as
          // an unhandled promise rejection.
          void loadingTask.destroy().catch(() => {});
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

    // Page cap is POST-unlock (the page count is unknown until pdf.js opens the doc).
    if (doc.numPages > maxStrongPages(opts.dpi)) {
      throw new Error("Too many pages at this resolution — lower the DPI or use Lossless mode.");
    }

    const out = await PDFDocument.create();
    let clampedPages = 0;

    for (let i = 0; i < doc.numPages; i++) {
      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      // PIN 1: a page-render failure is FATAL — do NOT collect-and-continue.
      const page = await getPageFatal(doc, i + 1);
      try {
        const { blob, clamped, ptW, ptH } = await renderPageToBlob(page, {
          dpi: opts.dpi,
          format: "jpeg",
          jpegQuality: opts.jpegQuality,
          signal: hooks?.signal,
        });
        if (clamped) clampedPages++;
        const jpegBytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = await out.embedJpg(jpegBytes);
        // Geometry in POINTS straight from the viewport (ptW/ptH) — NOT PT_PER_PX.
        const pg = out.addPage([ptW, ptH]);
        pg.drawRectangle({ x: 0, y: 0, width: ptW, height: ptH, color: rgb(1, 1, 1) });
        pg.drawImage(embedded, { x: 0, y: 0, width: ptW, height: ptH });
      } catch (e) {
        // FATAL (Crit#1 / §11.3): normalize cancel to AbortError, otherwise
        // rethrow with the plan-mandated page context so the user knows WHICH
        // page failed ("Couldn't compress page N — the PDF may be damaged…").
        const name = (e as { name?: string })?.name;
        if (name === "AbortError") throw e;
        if (name === "RenderingCancelledException") {
          throw new DOMException("Aborted", "AbortError");
        }
        throw new Error(`Couldn't compress page ${i + 1} — the PDF may be damaged on that page.`);
      } finally {
        page.cleanup();
      }

      hooks?.onProgress?.(i + 1, doc.numPages);
      if (i + 1 < doc.numPages) await new Promise((r) => setTimeout(r, 0)); // yield for UI repaint
    }

    // PIN 1: every input page MUST have produced an output page.
    if (out.getPageCount() !== doc.numPages) {
      throw new Error("Internal error: page count mismatch.");
    }

    out.setProducer("");
    out.setCreator("");
    return {
      bytes: await out.save({ useObjectStreams: true }),
      clampedPages,
      pageCount: out.getPageCount(),
    };
  } finally {
    await loadingTask.destroy(); // v6: teardown via the loading task (worker + doc)
  }
}

// Fetch a page; FATAL on error (PIN 1). Normalizes cancel → AbortError so a user
// Cancel during getPage surfaces as the quiet abort, not a leaked pdf.js message.
async function getPageFatal(
  doc: import("pdfjs-dist").PDFDocumentProxy,
  pageNumber: number,
): Promise<import("pdfjs-dist").PDFPageProxy> {
  try {
    return await doc.getPage(pageNumber);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "AbortError") throw e;
    if (name === "RenderingCancelledException") throw new DOMException("Aborted", "AbortError");
    throw new Error(`Couldn't compress page ${pageNumber} — the PDF may be damaged on that page.`);
  }
}

// ── Dispatcher + regression guard ───────────────────────────────────────────

export async function compressPdf(
  input: Uint8Array,
  mode: CompressMode,
  strong: StrongOptions,
  hooks?: CompressHooks,
): Promise<CompressResult> {
  let produced: Uint8Array;
  let clampedPages = 0;
  let pageCount: number;
  const rasterized = mode === "strong";

  if (mode === "strong") {
    const r = await compressStrong(input, strong, hooks);
    produced = r.bytes;
    clampedPages = r.clampedPages;
    pageCount = r.pageCount;
  } else {
    const r = await compressLossless(input);
    produced = r.bytes;
    pageCount = r.pageCount;
  }

  // Regression guard — ALWAYS compare against the ORIGINAL input.length, never an
  // intermediate. If we couldn't beat the original, ship the original untouched.
  if (produced.length >= input.length) {
    return {
      bytes: input,
      outputSize: input.length,
      inputSize: input.length,
      ratio: 0,
      keptOriginal: true,
      mode,
      rasterized,
      clampedPages,
      pageCount,
    };
  }

  return {
    bytes: produced,
    outputSize: produced.length,
    inputSize: input.length,
    ratio: 1 - produced.length / input.length,
    keptOriginal: false,
    mode,
    rasterized,
    clampedPages,
    pageCount,
  };
}

// ── Filename + formatting helpers ───────────────────────────────────────────

export function buildCompressedFilename(originalName: string): string {
  return `${buildBaseName(originalName)}-compressed.pdf`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
