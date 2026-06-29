import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIM,
  MAX_IMAGE_SIZE,
  MAX_TOTAL_SIZE,
  WARN_IMAGE_SIZE,
  classifyImageFormat,
  sniffImageMeta,
  validateImageFile,
} from "@/lib/image";
import { PDFDocument, PageSizes, rgb } from "pdf-lib";
import { MAX_QUEUE_SIZE } from "../constants";

// Re-export shared PDF helpers so Route.tsx imports everything from one module
// and tests mock a single path.
export { downloadBlob, readFileBytes } from "@/lib/pdf";
export type { ValidationResult } from "@/lib/pdf";

// Re-export the shared queue cap (Route imports it from here).
export { MAX_QUEUE_SIZE };

// Re-export the shared format/validation helpers + size caps from @/lib/image so
// Route.tsx and the converter test keep importing them from this module (§5.5).
// `classifyImageFormat` is re-exported as-is (now also recognizes AVIF, but this
// tool only ACCEPTS png/jpeg/webp via the `accept` list it passes — recognition
// ≠ acceptance). `validateImageFile` now takes an explicit `accept` allow-list.
export {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIM,
  MAX_IMAGE_SIZE,
  MAX_TOTAL_SIZE,
  WARN_IMAGE_SIZE,
  classifyImageFormat,
  validateImageFile,
};

// ── Constants (kept local — see plan §3.1) ──
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
export const LARGE_OUTPUT_WARN_SIZE = 50 * 1024 * 1024; // soft-warn when the assembled PDF exceeds this (G1)
export const DEFAULT_JPEG_QUALITY = 0.95; // applied to JPEG-encoded outputs at convert time
export const PT_PER_PX = 72 / 96; // px→pt @96 DPI for "match" + "actual" sizing

/**
 * Compatibility shim for the old `sniffRasterFormat` (now `sniffImageMeta` in
 * @/lib/image). Returns the bare format and — since images-to-pdf only handles
 * PNG/JPEG/WebP — narrows a recognized AVIF back to `null` so `ImageMeta.format`
 * stays constrained to the three supported formats.
 */
export function sniffRasterFormat(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  const f = sniffImageMeta(bytes).format;
  return f === "png" || f === "jpeg" || f === "webp" ? f : null;
}

export type PageSizeKey = "match" | "A4" | "Letter" | "Legal" | "A3" | "A5";
export type OrientationKey = "auto" | "portrait" | "landscape";
export type FitMode = "fit" | "fill" | "stretch" | "actual";

export interface ConvertOptions {
  pageSize: PageSizeKey;
  orientation: OrientationKey;
  margin: number; // points, ≥ 0, uniform on all sides
  fit: FitMode;
  jpegQuality: number; // 0..1, applied at convert time to JPEG-encoded outputs
}

// Lightweight upload-time metadata (no re-encoded bytes held in memory).
export interface ImageMeta {
  format: "png" | "jpeg" | "webp"; // from sniffRasterFormat — authoritative, NOT raw MIME
  width: number; // oriented pixel width (post-EXIF)
  height: number; // oriented pixel height
}

// Normalized, ready-to-embed image (produced at CONVERT time, one at a time).
export interface PreparedImage {
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  width: number; // oriented pixel width (post-downscale)
  height: number; // oriented pixel height (post-downscale)
  downscaled: boolean; // true if clamped by MAX_CANVAS_DIM/AREA
}

// PageSizeKey → points. Bracket access keyed by a finite literal union.
const PAGE_SIZE_PT: Record<Exclude<PageSizeKey, "match">, [number, number]> = {
  A4: PageSizes.A4,
  Letter: PageSizes.Letter,
  Legal: PageSizes.Legal,
  A3: PageSizes.A3,
  A5: PageSizes.A5,
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read this image. It may be corrupt."));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode this image."));
      },
      type,
      quality,
    );
  });
}

/**
 * UPLOAD-time, lightweight metadata read. Sniff the leading bytes for the
 * authoritative format (a mislabeled GIF-as-PNG fails here, not at convert),
 * then read ORIENTED dims via an `<img>` (EXIF applied by the browser), NOT a
 * canvas — no re-encode, no retained bytes.
 */
export async function readImageMeta(file: File): Promise<ImageMeta> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const format = sniffRasterFormat(head);
  if (!format) {
    throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (width === 0 || height === 0) {
      throw new Error("Could not read this image. It may be corrupt.");
    }
    return { format, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * CONVERT-time normalize, called ONE image at a time. Enforce the size cap,
 * gate the format (MIME/ext + magic-byte sniff), decode via `<img>` (EXIF
 * baked), draw to a canvas clamped by both the max side and the max area, then
 * re-encode (sniffed jpeg → JPEG with quality; png/webp → PNG, keeping alpha).
 */
export async function prepareImageBytes(
  file: File,
  jpegQuality = DEFAULT_JPEG_QUALITY,
): Promise<PreparedImage> {
  if (file.size > MAX_IMAGE_SIZE) {
    const capMb = Math.round(MAX_IMAGE_SIZE / (1024 * 1024));
    throw new Error(`Image too large. Maximum size is ${capMb}MB.`);
  }
  if (!classifyImageFormat(file)) {
    throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
  }
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const sniffed = sniffRasterFormat(head);
  if (!sniffed) {
    throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w === 0 || h === 0) {
      throw new Error("Could not read this image. It may be corrupt.");
    }
    // Downscale preserving aspect if either side or the area exceeds the caps.
    const sideOver = Math.max(w, h) / MAX_CANVAS_DIM;
    const areaOver = Math.sqrt((w * h) / MAX_CANVAS_AREA);
    const over = Math.max(1, sideOver, areaOver);
    const downscaled = over > 1;
    if (downscaled) {
      // Floor (not round) so the result is guaranteed to stay within BOTH caps:
      // rounding each side up independently can push w*h back over MAX_CANVAS_AREA
      // (e.g. 9000×3000 → 7094×2365 = 16,777,310 > 16,777,216).
      w = Math.max(1, Math.floor(w / over));
      h = Math.max(1, Math.floor(h / over));
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2d context");
    }
    ctx.drawImage(img, 0, 0, w, h); // must run BEFORE the URL is revoked
    const outType = sniffed === "jpeg" ? "image/jpeg" : "image/png"; // png & webp → png
    const blob = await canvasToBlob(
      canvas,
      outType,
      outType === "image/jpeg" ? jpegQuality : undefined,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, type: outType, width: w, height: h, downscaled };
  } finally {
    URL.revokeObjectURL(url); // revoke AFTER the canvas has the pixels
  }
}

/**
 * Resolve the PDF page size in points. "match" → the image's own pixel dims
 * (orientation ignored). A preset uses its fixed size, then orientation swaps
 * the axes if needed.
 */
export function resolvePageSize(
  opts: ConvertOptions,
  img: { width: number; height: number },
): [number, number] {
  if (opts.pageSize === "match") {
    return [img.width * PT_PER_PX, img.height * PT_PER_PX];
  }
  const [pw, ph] = PAGE_SIZE_PT[opts.pageSize];
  let w = pw;
  let h = ph;
  switch (opts.orientation) {
    case "auto":
      // portrait if the image is portrait (h ≥ w), else landscape.
      if (img.height >= img.width) {
        if (w > h) [w, h] = [h, w]; // ensure portrait (W ≤ H)
      } else {
        if (w < h) [w, h] = [h, w]; // ensure landscape (W ≥ H)
      }
      break;
    case "portrait":
      if (w > h) [w, h] = [h, w];
      break;
    case "landscape":
      if (w < h) [w, h] = [h, w];
      break;
  }
  return [w, h];
}

/**
 * Compute the centered draw rect (points) for an image inside a page's content
 * box (page minus uniform margin). Returns null for a degenerate box (margin
 * too large) or a 0×0 image.
 */
export function computeImageLayout(
  img: { width: number; height: number },
  page: [number, number],
  margin: number,
  fit: FitMode,
): { x: number; y: number; width: number; height: number } | null {
  const iw = img.width;
  const ih = img.height;
  if (iw <= 0 || ih <= 0) return null;
  const [pageW, pageH] = page;
  const cw = pageW - 2 * margin;
  const ch = pageH - 2 * margin;
  if (cw <= 0 || ch <= 0) return null;

  let dw: number;
  let dh: number;
  switch (fit) {
    case "fit": {
      const s = Math.min(cw / iw, ch / ih);
      dw = iw * s;
      dh = ih * s;
      break;
    }
    case "fill": {
      const s = Math.max(cw / iw, ch / ih);
      dw = iw * s;
      dh = ih * s;
      break;
    }
    case "stretch":
      dw = cw;
      dh = ch;
      break;
    case "actual":
      dw = iw * PT_PER_PX;
      dh = ih * PT_PER_PX;
      break;
  }
  const x = margin + (cw - dw) / 2;
  const y = margin + (ch - dh) / 2;
  return { x, y, width: dw, height: dh };
}

/**
 * Assemble the input images into a single PDF, one image per page. Prepares
 * each file sequentially (bounded peak memory). Returns the PDF bytes plus the
 * names of any images that were downscaled, for a non-blocking warning.
 */
export async function imagesToPdf(
  files: { name: string; file: File }[],
  opts: ConvertOptions,
  hooks?: { onProgress?: (done: number, total: number) => void },
): Promise<{ bytes: Uint8Array; downscaledNames: string[] }> {
  if (files.length === 0) {
    throw new Error("No images to convert.");
  }
  const doc = await PDFDocument.create();
  const downscaledNames: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const entry = files[i];
    if (!entry) continue;
    const { name, file } = entry;

    let prepared: PreparedImage;
    try {
      prepared = await prepareImageBytes(file, opts.jpegQuality);
    } catch (e) {
      throw new Error(`Could not process "${name}": ${e instanceof Error ? e.message : e}`);
    }
    if (prepared.downscaled) downscaledNames.push(name);

    const [pw, ph] = resolvePageSize(opts, prepared);
    const rect = computeImageLayout(prepared, [pw, ph], opts.margin, opts.fit);
    if (!rect) {
      throw new Error(`Margin is too large for "${name}" at the chosen page size.`);
    }

    const page = doc.addPage([pw, ph]);
    page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(1, 1, 1) });

    let embedded: Awaited<ReturnType<typeof doc.embedJpg>>;
    try {
      embedded =
        prepared.type === "image/jpeg"
          ? await doc.embedJpg(prepared.bytes)
          : await doc.embedPng(prepared.bytes);
    } catch {
      throw new Error(`Could not embed "${name}". The image may be unsupported.`);
    }
    page.drawImage(embedded, rect);

    hooks?.onProgress?.(i + 1, files.length);
    if (i + 1 < files.length) await new Promise((r) => setTimeout(r, 0));
  }

  doc.setProducer("");
  doc.setCreator("");
  return { bytes: await doc.save({ useObjectStreams: true }), downscaledNames };
}

/**
 * Derive a clean output filename from the first image (sanitized base + .pdf;
 * falls back to "images.pdf"). No "-merged" suffix — this is a conversion.
 */
export function buildPdfFilename(images: { name: string }[]): string {
  const first = images[0];
  if (!first) {
    return "images.pdf";
  }
  const base = first.name.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = sanitized || "images";
  return `${safe}.pdf`;
}
