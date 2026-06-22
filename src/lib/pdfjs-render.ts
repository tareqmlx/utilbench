import { MAX_CANVAS_AREA, clampToCanvasLimits } from "@/lib/image";
import { PDFDocument } from "pdf-lib";
// Vite emits a hashed asset URL for the pdf.js ES-module worker.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Lower-level, policy-free pdf.js render core. Shared by the PDF→image and
// PDF-compress tools. Anything in here is "how to drive pdf.js for a single
// page / probe"; multi-page looping, failure-collection, page caps, and naming
// policy live in the consuming tool's renderer.

// ── Types ──────────────────────────────────────────────────────────────────

export type ImageFormat = "png" | "jpeg";

export interface PageSize {
  width: number;
  height: number;
} // points; from the upload-time probe (§5.6)

export interface PdfProbe {
  pageCount: number;
  encrypted: boolean;
  pageSizes: PageSize[];
  // false ⇒ pdf-lib could not parse the structure (commonly a strongly-encrypted
  // PDF). Page count / sizes are unknown until pdf.js unlocks it at render time
  // (§5.6). The pre-convert readout is skipped, but Convert stays enabled.
  dimsKnown: boolean;
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
export const PDFJS_ASSETS = {
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
  // pdf-lib does NOT detach the buffer (unlike pdf.js), so no slice() needed here.
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageSizes = doc.getPages().map((p) => {
      const { width, height } = p.getSize(); // MediaBox — rotation-AGNOSTIC
      // pdf.js getViewport({scale:1}) SWAPS w/h for 90°/270°; match it so the readout/clamp agree.
      const rot = ((p.getRotation().angle % 360) + 360) % 360;
      return rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
    });
    return {
      pageCount: doc.getPageCount(),
      encrypted: doc.isEncrypted,
      pageSizes,
      dimsKnown: true,
    };
  } catch {
    // pdf-lib failed to PARSE the structure — most often a strongly-encrypted PDF
    // (e.g. AES-128/256) it can't read even with ignoreEncryption. Do NOT reject:
    // pdf.js may still render it after a password (§5.6). Fall back to "dimensions
    // available after rendering" — skip the pre-convert readout but keep Convert live.
    // Re-load WITHOUT ignoreEncryption to tell "encrypted" apart from genuine corruption,
    // so the lock badge is only shown when the file really is encrypted.
    let encrypted = false;
    try {
      await PDFDocument.load(bytes);
    } catch (e2) {
      encrypted =
        e2 instanceof Error && (/encrypt/i.test(e2.message) || e2.name === "EncryptedPDFError");
    }
    return { pageCount: 0, encrypted, pageSizes: [], dimsKnown: false };
  }
}

// ── Filename helpers (§5.5) ────────────────────────────────────────────────

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

// ── Single-page render primitive (policy-free) ─────────────────────────────

export interface RenderPageOptions {
  dpi: number; // target DPI; scale = dpi / 72 (§5.3)
  format: ImageFormat;
  jpegQuality?: number; // 0..1, applied only when format === "jpeg"
  signal?: AbortSignal; // cancels the IN-FLIGHT render
}

export interface RenderPageResult {
  blob: Blob;
  clamped: boolean; // true if the effective DPI was reduced by the canvas-area guard
  ptW: number; // oriented page width in points (page.getViewport({scale:1}).width)
  ptH: number; // oriented page height in points
  width: number; // output px (post area-clamp)
  height: number; // output px
}

// Render ONE pdf.js page to a white opaque canvas and encode it. No multi-page
// loop, no failure-collection: the caller owns looping, failure handling, and
// the page lifecycle (this does NOT call page.cleanup()).
export async function renderPageToBlob(
  page: import("pdfjs-dist").PDFPageProxy,
  opts: RenderPageOptions,
): Promise<RenderPageResult> {
  const lib = await getPdfjs();
  const baseVp = page.getViewport({ scale: 1 }); // intrinsic oriented size
  const ptW = baseVp.width;
  const ptH = baseVp.height;
  const { width, height, clamped } = computeOutputDims(ptW, ptH, opts.dpi);
  const effScale = width / ptW; // honor the area clamp
  const viewport = page.getViewport({ scale: effScale });

  const canvas = document.createElement("canvas");
  canvas.width = width; // integer dims FROM computeOutputDims (single source)
  canvas.height = height;
  try {
    // ALWAYS opaque white. THREE belt-and-suspenders layers:
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
      annotationMode: lib.AnnotationMode.DISABLE, // clean page images, no link/widget overlays
      background: "rgb(255,255,255)", // (c) pdf.js documented white paint
    });
    // Wire the abort signal so an in-flight render is interruptible. The caller
    // owns abort POLICY (the resulting RenderingCancelledException propagates).
    const onAbort = () => renderTask.cancel();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      await renderTask.promise; // RenderingCancelledException if cancelled
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }

    const type = opts.format === "png" ? "image/png" : "image/jpeg";
    const blob = await canvasToBlob(
      canvas,
      type,
      opts.format === "jpeg" ? opts.jpegQuality : undefined,
    );
    return { blob, clamped, ptW, ptH, width, height };
  } finally {
    // RELEASE the bitmap (Safari/iOS frees it on width/height = 0) even when
    // render/encode threw. Page-level cleanup is the CALLER's job, not ours.
    canvas.width = 0;
    canvas.height = 0;
  }
}
