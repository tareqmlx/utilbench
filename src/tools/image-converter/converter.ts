import { __resetEncodeProbeCache } from "@/lib/encode"; // encode-only memo reset (shared helpers)
import { clampToCanvasLimits } from "@/lib/image"; // shared canvas-limit helper (reuse, don't redeclare)
import { MAX_QUEUE_SIZE } from "../constants"; // shared = 50

// Shared encode helpers now live in @/lib/encode (single source of truth) so pure-canvas
// tools can reuse them without dragging AVIF_PROBE_DATA_URI into their chunk. Re-exported
// here so converter.ts (and converter.test.ts) keep importing them from this module.
export { canEncode, createBatchZip } from "@/lib/encode";

export type OutputFormat = "png" | "jpeg" | "webp";
export type InputFormat = "png" | "jpeg" | "webp" | "gif" | "bmp" | "avif";

export const ACCEPTED_INPUT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp", // Windows reports BMP as image/x-ms-bmp, NOT image/bmp
  "image/avif",
] as const;
// Extension fallback for empty/octet-stream MIME (drag-drop sometimes yields file.type === "").
export const ACCEPTED_INPUT_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"];

export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB per image
export const WARN_IMAGE_SIZE = 25 * 1024 * 1024; // soft warning
export const MAX_TOTAL_SIZE = 250 * 1024 * 1024; // cumulative input footprint guard
export const DEFAULT_QUALITY = 0.92; // Chromium JPEG default
export const DEFAULT_BG_COLOR = "#ffffff"; // alpha-flatten background for JPEG output
export const LARGE_OUTPUT_WARN_SIZE = 50 * 1024 * 1024; // soft-warn when retained output exceeds this

// MAX_QUEUE_SIZE is re-exported for Route.tsx convenience (shared = 50).
export { MAX_QUEUE_SIZE };

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// Lightweight upload-time metadata (oriented dims + sniffed format). No re-encode here.
export interface ImageMeta {
  format: InputFormat; // from sniffImageFormat (magic bytes) — authoritative, NOT raw MIME
  width: number; // oriented pixel width  (post-EXIF, from <img>.naturalWidth)
  height: number; // oriented pixel height
}

export interface ConvertOptions {
  format: OutputFormat;
  quality: number; // 0..1; used only for jpeg/webp
  bgColor: string; // CSS color; used only when flattening alpha for jpeg output
}

export interface ConvertResult {
  blob: Blob;
  type: string; // actual blob.type — validated against the requested format
  width: number; // output pixel width  (post-downscale)
  height: number; // output pixel height
  downscaled: boolean; // true if clamped by canvas limits
}

export const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const EXT_BY_FORMAT: Record<OutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

// HEIC/HEIF major brands that must be rejected even when other compatible brands are present.
const HEIC_MAJOR_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/** Read a 4-char ASCII brand at `offset`, or null if out of bounds. */
function readBrand(bytes: Uint8Array, offset: number): string | null {
  if (offset + 4 > bytes.length) return null;
  let brand = "";
  for (let i = 0; i < 4; i++) {
    const c = bytes[offset + i];
    if (c === undefined) return null;
    brand += String.fromCharCode(c);
  }
  return brand;
}

/** Big-endian uint32 at `offset`, or null if out of bounds. */
function readU32BE(bytes: Uint8Array, offset: number): number | null {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return null;
  return (b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3) >>> 0;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Magic-byte sniff. Callers pass the first 32 bytes (needed for the AVIF ftyp compatible_brands scan).
 * Returns null for HEIC/SVG/TIFF/garbage (rejected, not transcoded).
 */
export function sniffImageFormat(bytes: Uint8Array): InputFormat | null {
  // PNG  89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // JPEG FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // GIF  47 49 46 38 ("GIF8" — covers 87a/89a)
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  // BMP  42 4D ("BM")
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  // WebP "RIFF"....then "WEBP" at offset 8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && readBrand(bytes, 8) === "WEBP") {
    return "webp";
  }
  // AVIF/HEIF "ftyp" box at offset 4 — parse the full ftyp brand region.
  if (readBrand(bytes, 4) === "ftyp") {
    const boxSize = readU32BE(bytes, 0);
    // Brand region ends at min(boxSize, bytesRead). boxSize may be 0/huge; bound by bytes.length.
    const limit = boxSize !== null && boxSize > 0 ? Math.min(boxSize, bytes.length) : bytes.length;

    const major = readBrand(bytes, 8);
    // Reject HEIC FIRST — a heic major returns null even if avif is in compatible_brands.
    if (major !== null && HEIC_MAJOR_BRANDS.has(major)) return null;

    if (major === "avif" || major === "avis") return "avif";

    // compatible_brands start at offset 16 (bytes 12–15 are minor_version, not a brand).
    for (let off = 16; off + 4 <= limit; off += 4) {
      const brand = readBrand(bytes, off);
      if (brand === "avif" || brand === "avis") return "avif";
    }
    // Generic HEIF / unknown ftyp.
    return null;
  }
  return null;
}

/**
 * Maps file.type (incl. non-standard "image/jpg" → jpeg, and "image/x-ms-bmp" → bmp);
 * on "" / "application/octet-stream" falls back to the file extension.
 * Returns null if neither MIME nor extension is in the accepted set.
 */
export function classifyByMimeOrExt(file: File): InputFormat | null {
  const mime = file.type.toLowerCase();
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg": // non-standard but seen in the wild
      return "jpeg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
    case "image/x-ms-bmp": // Windows BMP MIME
      return "bmp";
    case "image/avif":
      return "avif";
  }
  // Fallback to extension on empty / octet-stream / unknown MIME.
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = name.slice(dot);
  if (!ACCEPTED_INPUT_EXT.includes(ext)) return null;
  switch (ext) {
    case ".png":
      return "png";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".webp":
      return "webp";
    case ".gif":
      return "gif";
    case ".bmp":
      return "bmp";
    case ".avif":
      return "avif";
  }
  return null;
}

/**
 * Reject when classifyByMimeOrExt(file) === null, file.size === 0, or file.size > MAX_IMAGE_SIZE;
 * warn when file.size > WARN_IMAGE_SIZE.
 */
export function validateImageFile(file: File): ValidationResult {
  if (classifyByMimeOrExt(file) === null) {
    return {
      valid: false,
      error: "Unsupported file type. Use PNG, JPG, WebP, GIF, BMP, or AVIF.",
    };
  }
  if (file.size === 0) {
    return { valid: false, error: "This file is empty." };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { valid: false, error: "Image too large. Maximum size is 50MB." };
  }
  if (file.size > WARN_IMAGE_SIZE) {
    return {
      valid: true,
      warning: "Large image detected. Conversion may be slow on some devices.",
    };
  }
  return { valid: true };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode this image."))),
      type,
      quality,
    );
  });
}

/**
 * UPLOAD-time, lightweight. Read the first 32 bytes → sniffImageFormat (null ⇒ throw), then read
 * oriented dims via <img> + URL.createObjectURL. No re-encode, no retained bytes.
 */
export async function readImageMeta(file: File): Promise<ImageMeta> {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const format = sniffImageFormat(header);
  if (format === null) {
    throw new Error("Unsupported or unrecognized image. Use PNG, JPG, WebP, GIF, BMP, or AVIF.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url).catch(() => {
      if (format === "avif") {
        throw new Error("AVIF isn't supported in this browser.");
      }
      throw new Error("Could not read this image. It may be corrupt.");
    });
    return { format, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Feature detection ───────────────────────────────────────────────────────

let avifDecodeCache: Promise<boolean> | null = null;

// Known-good minimal 1×1 AVIF, produced by avifenc (major brand "avif"); verified decodable.
const AVIF_PROBE_DATA_URI =
  "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAAEsbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAGcAAAAJgACAAAAAQAAAVQAAABIAAAAQWlpbmYAAAAAAAIAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAABlpbmZlAgAAAAACAABFeGlmRXhpZgAAAAAaaXJlZgAAAAAAAAAOY2RzYwACAAEAAQAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAABAAAAAQAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EgAAAAAAATY29scm5jbHgAAQANAAaAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAB2bWRhdAAAAABNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAABoAMABAAAAAEAAAABAAAAABIACgc4AAaQENBpMhkZQmMEw88880AAAJBAyRxhS40a1hBUsfsg";

/**
 * ASYNC, cached. Decode a 1×1 AVIF data-URI via a probe <img> (onload ⇒ true, onerror ⇒ false).
 * Memoizes the Promise. Help-text-only signal — decode is still attempted per file in readImageMeta.
 */
export function canDecodeAvif(): Promise<boolean> {
  if (avifDecodeCache !== null) return avifDecodeCache;
  avifDecodeCache = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = AVIF_PROBE_DATA_URI;
  });
  return avifDecodeCache;
}

/** Test hook — clears canEncode (via @/lib/encode) / canDecodeAvif memo caches. */
export function __resetProbeCache(): void {
  __resetEncodeProbeCache();
  avifDecodeCache = null;
}

/**
 * CONVERT-time, called ONE image at a time. decode → clamp → optional JPEG bg-fill → drawImage →
 * toBlob → blob.type validation.
 */
export async function convertImage(file: File, opts: ConvertOptions): Promise<ConvertResult> {
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Image too large. Maximum size is 50MB.");
  }
  if (classifyByMimeOrExt(file) === null) {
    throw new Error("Unsupported file type. Use PNG, JPG, WebP, GIF, BMP, or AVIF.");
  }
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const sniffed = sniffImageFormat(header);
  if (sniffed === null) {
    throw new Error("Unsupported or unrecognized image. Use PNG, JPG, WebP, GIF, BMP, or AVIF.");
  }

  // Decode-validate with createImageBitmap before drawing. A truncated/corrupt image (e.g. a PNG cut
  // off mid-stream) keeps a valid header, so the <img> below still fires `load` with non-zero
  // naturalWidth and silently paints a blank canvas — producing a "successful" all-transparent output.
  // createImageBitmap actually decodes the pixel data and rejects when it can't, catching that case
  // (and unsupported AVIF) here instead. The probe is closed immediately; drawing still uses the <img>
  // path below to preserve its EXIF auto-orientation behavior.
  try {
    (await createImageBitmap(file)).close();
  } catch {
    if (sniffed === "avif") {
      throw new Error("AVIF isn't supported in this browser.");
    }
    throw new Error("Could not read this image. It may be corrupt.");
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url).catch(() => {
      if (sniffed === "avif") {
        throw new Error("AVIF isn't supported in this browser.");
      }
      throw new Error("Could not read this image. It may be corrupt.");
    });
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      throw new Error("Could not read this image. It may be corrupt.");
    }

    const { width, height, downscaled } = clampToCanvasLimits(img.naturalWidth, img.naturalHeight);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context.");

    if (opts.format === "jpeg") {
      // Flatten alpha onto the chosen background BEFORE drawing (transparent → JPEG = black otherwise).
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);

    const mime = MIME_BY_FORMAT[opts.format];
    const quality = opts.format === "png" ? undefined : opts.quality;
    const blob = await canvasToBlob(canvas, mime, quality);

    // Backstop for the silent-PNG-fallback trap when an unsupported encode slips through canEncode gating.
    if (blob.type !== mime) {
      throw new Error(`This browser can't encode ${opts.format.toUpperCase()} images.`);
    }

    return { blob, type: blob.type, width, height, downscaled };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Strip the original extension, append the target extension. Empty base → "image".
 */
export function buildOutputFilename(originalName: string, format: OutputFormat): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const safeBase = base.length > 0 ? base : "image";
  return `${safeBase}.${EXT_BY_FORMAT[format]}`;
}

export function buildZipName(count: number): string {
  return `images-converted-${count}.zip`;
}

/** Create <a download>, click, revoke. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// createBatchZip now lives in @/lib/encode (re-exported near the top of this module).
