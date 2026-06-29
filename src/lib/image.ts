import type { ValidationResult } from "@/lib/pdf";

export const MAX_CANVAS_DIM = 8192; // px, max single side
export const MAX_CANVAS_AREA = 16_777_216; // px², iOS/Safari canvas-area ceiling (~16.7 MP)

// ── Size caps (canonical home — consumed by images-to-pdf + image-compress) ──
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB per image (hard reject)
export const WARN_IMAGE_SIZE = 25 * 1024 * 1024; // soft warning threshold
export const MAX_TOTAL_SIZE = 250 * 1024 * 1024; // cumulative queue footprint guard

/**
 * The single normalized raster-format vocabulary shared across every image tool.
 * `sniffImageMeta`, `classifyImageFormat`, `normalizeFormat`, and `readImageDims`
 * all speak this — so a `"jpg"` extension, an `"image/jpg"` MIME, and a `0xFFD8`
 * magic-byte sniff all collapse to the same `"jpeg"` token (avoids `===` drift).
 */
export type NormFormat = "jpeg" | "png" | "webp" | "avif";

export function clampToCanvasLimits(
  w: number,
  h: number,
): { width: number; height: number; downscaled: boolean } {
  const sideOver = Math.max(w, h) / MAX_CANVAS_DIM;
  const areaOver = Math.sqrt((w * h) / MAX_CANVAS_AREA);
  const over = Math.max(1, sideOver, areaOver);
  const downscaled = over > 1;
  if (!downscaled) return { width: w, height: h, downscaled: false };
  // FLOOR (not round) so the result is guaranteed to stay within BOTH caps.
  return {
    width: Math.max(1, Math.floor(w / over)),
    height: Math.max(1, Math.floor(h / over)),
    downscaled: true,
  };
}

const FORMAT_LABELS: Record<NormFormat, string> = {
  jpeg: "JPG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
};

/**
 * Normalize any format spelling — a bare extension (`"jpg"`), a MIME
 * (`"image/jpeg"`), the non-standard `"image/jpg"`, or an ISOBMFF brand
 * (`"avis"`) — to the canonical {@link NormFormat}. Case-insensitive; returns
 * `null` for anything unrecognized.
 */
export function normalizeFormat(input: string): NormFormat | null {
  switch (input.toLowerCase()) {
    case "jpg":
    case "jpeg":
    case "image/jpg":
    case "image/jpeg":
      return "jpeg";
    case "png":
    case "image/png":
      return "png";
    case "webp":
    case "image/webp":
      return "webp";
    case "avif":
    case "avis":
    case "image/avif":
      return "avif";
    default:
      return null;
  }
}

/**
 * Resolve a file to its {@link NormFormat} via MIME (with the non-standard
 * `image/jpg` alias), falling back to the extension when the MIME is absent or
 * generic (`""` / `application/octet-stream`, as some OS drag-drop paths emit).
 * A file that explicitly declares an unsupported image MIME (e.g. `image/gif`)
 * is rejected even if its extension lies. **Recognition ≠ acceptance** — a tool
 * still gates the result through its own `accept` list (see `validateImageFile`).
 */
export function classifyImageFormat(file: File): NormFormat | null {
  switch (file.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg": // non-standard but emitted by some browsers/OS paths
      return "jpeg";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
  }
  if (file.type === "" || file.type === "application/octet-stream") {
    const name = file.name.toLowerCase();
    if (name.endsWith(".png")) return "png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
    if (name.endsWith(".webp")) return "webp";
    if (name.endsWith(".avif")) return "avif";
  }
  return null;
}

/**
 * Validate an uploaded image against an explicit `accept` allow-list. The
 * classifier recognizes AVIF, but recognition is NOT acceptance: a tool only
 * admits formats it passes in `accept` (images-to-pdf passes `["png","jpeg",
 * "webp"]`, so an AVIF is rejected there even though it is recognized). Rejects
 * unsupported/disallowed types, 0-byte files, and files over the size cap; warns
 * (does not reject) on large-but-valid files.
 */
export function validateImageFile(file: File, accept: NormFormat[]): ValidationResult {
  const format = classifyImageFormat(file);
  if (format === null || !accept.includes(format)) {
    const labels = accept.map((f) => FORMAT_LABELS[f]).join(", ");
    return { valid: false, error: `Invalid file type. Use ${labels}.` };
  }
  if (file.size === 0) {
    return { valid: false, error: "Empty file. The selected image has no content." };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const capMb = Math.round(MAX_IMAGE_SIZE / (1024 * 1024));
    return { valid: false, error: `Image too large. Maximum size is ${capMb}MB.` };
  }
  if (file.size > WARN_IMAGE_SIZE) {
    return {
      valid: true,
      warning: "Large image detected. Processing may be slow on some devices.",
    };
  }
  return { valid: true };
}

// ── Magic-byte sniffing ────────────────────────────────────────────────────

/** Read `len` bytes from `off` as an ASCII fourCC/string; stops at EOF. */
function asciiAt(bytes: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = bytes[off + i];
    if (c === undefined) return s;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Big-endian uint32; returns 0 past EOF (callers bound-check the loop). */
function readU32be(bytes: Uint8Array, pos: number): number {
  const a = bytes[pos];
  const b = bytes[pos + 1];
  const c = bytes[pos + 2];
  const d = bytes[pos + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

/** APNG = an `acTL` chunk appearing before the first `IDAT` chunk. */
function isApng(bytes: Uint8Array): boolean {
  let pos = 8; // past the PNG signature
  const len = bytes.length;
  while (pos + 8 <= len) {
    const chunkLen = readU32be(bytes, pos);
    const type = asciiAt(bytes, pos + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    // 4 (length) + 4 (type) + data + 4 (CRC)
    pos += 12 + chunkLen;
  }
  return false;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP";
}

/** Animated WebP = a `VP8X` extended header with the ANIM flag bit (0x02) set. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 21 || asciiAt(bytes, 12, 4) !== "VP8X") return false;
  const flags = bytes[20] ?? 0;
  return (flags & 0x02) !== 0;
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || asciiAt(bytes, 4, 4) !== "ftyp") return false;
  const brand = asciiAt(bytes, 8, 4);
  return brand === "avif" || brand === "avis" || brand === "mif1";
}

/**
 * Sniff the actual raster format from the leading magic bytes (the only
 * authority — MIME and extension can lie) plus a best-effort `animated` flag.
 * Replaces the old `sniffRasterFormat`; format-only callers read `.format`.
 * Detection: PNG signature (+ `acTL` APNG check), JPEG `FFD8FF`, RIFF/WEBP
 * (+ `VP8X` ANIM flag), and ISOBMFF `ftyp` AVIF brands.
 */
export function sniffImageMeta(bytes: Uint8Array): {
  format: NormFormat | null;
  animated?: boolean;
} {
  if (isPng(bytes)) return { format: "png", animated: isApng(bytes) };
  if (isJpeg(bytes)) return { format: "jpeg" };
  if (isWebp(bytes)) return { format: "webp", animated: isAnimatedWebp(bytes) };
  if (isAvif(bytes)) return { format: "avif" };
  return { format: null };
}

// ── Dimension reading (EXIF-oriented for JPEG; non-oriented for WebP/AVIF) ──

function readPngDims(view: DataView): { width: number; height: number } {
  // IHDR is the first chunk: width/height are big-endian uint32 at byte 16/20.
  if (view.byteLength < 24) throw new Error("Invalid PNG: too short for IHDR.");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function isSofMarker(marker: number): boolean {
  // SOF0..15 (0xC0..0xCF) except DHT (0xC4), JPG (0xC8), DAC (0xCC).
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Parse the EXIF Orientation tag (0x0112) out of a JPEG APP1 segment, or undefined. */
function parseExifOrientation(
  view: DataView,
  segStart: number,
  segDataLen: number,
): number | undefined {
  // segment must begin with "Exif\0\0" then a TIFF header.
  if (segDataLen < 14) return undefined;
  if (
    view.getUint8(segStart) !== 0x45 || // E
    view.getUint8(segStart + 1) !== 0x78 || // x
    view.getUint8(segStart + 2) !== 0x69 || // i
    view.getUint8(segStart + 3) !== 0x66 || // f
    view.getUint8(segStart + 4) !== 0x00 ||
    view.getUint8(segStart + 5) !== 0x00
  ) {
    return undefined;
  }
  const tiff = segStart + 6;
  const byteOrder = view.getUint16(tiff);
  const le = byteOrder === 0x4949; // "II" little-endian; "MM" (0x4D4D) big-endian
  if (!le && byteOrder !== 0x4d4d) return undefined;
  if (view.getUint16(tiff + 2, le) !== 0x002a) return undefined;
  const ifdOffset = view.getUint32(tiff + 4, le);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > view.byteLength) return undefined;
  const count = view.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, le) === 0x0112) {
      return view.getUint16(entry + 8, le); // SHORT value sits in the value field
    }
  }
  return undefined;
}

function readJpegDims(view: DataView): { width: number; height: number } {
  const len = view.byteLength;
  let pos = 2; // past SOI (FFD8)
  let orientation = 1;
  let dims: { width: number; height: number } | null = null;
  while (pos + 4 <= len) {
    if (view.getUint8(pos) !== 0xff) {
      pos++;
      continue;
    }
    let marker = view.getUint8(pos + 1);
    // collapse fill bytes (0xFF 0xFF ...)
    while (marker === 0xff && pos + 2 < len) {
      pos++;
      marker = view.getUint8(pos + 1);
    }
    pos += 2;
    // standalone markers with no length payload
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      continue;
    }
    if (pos + 2 > len) break;
    const segLen = view.getUint16(pos);
    const segStart = pos + 2;
    if (segLen < 2 || segStart + (segLen - 2) > len) break;
    if (isSofMarker(marker)) {
      // [precision(1)][height(2)][width(2)]
      dims = { width: view.getUint16(segStart + 3), height: view.getUint16(segStart + 1) };
      break; // APP1/EXIF precedes SOF, so orientation is already captured
    }
    if (marker === 0xe1) {
      const o = parseExifOrientation(view, segStart, segLen - 2);
      if (o !== undefined) orientation = o;
    }
    pos = segStart + (segLen - 2);
  }
  if (!dims) throw new Error("Invalid JPEG: no SOF marker found.");
  // Orientation 5/6/7/8 are 90°/270° rotations → decoded dims are swapped.
  if (orientation >= 5 && orientation <= 8) {
    return { width: dims.height, height: dims.width };
  }
  return dims;
}

function readWebpDims(view: DataView, bytes: Uint8Array): { width: number; height: number } {
  if (view.byteLength < 16) throw new Error("Invalid WebP: too short.");
  const fourcc = asciiAt(bytes, 12, 4);
  if (fourcc === "VP8X") {
    // canvas width-1 / height-1 as 24-bit little-endian at byte 24 / 27.
    const w = (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)) + 1;
    const h = (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8L") {
    // 0x2F signature byte at 20, then 14-bit (width-1) | 14-bit (height-1).
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    const w = (b0 | ((b1 & 0x3f) << 8)) + 1;
    const h = ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8 ") {
    // lossy: 14-bit dims (little-endian) after the 3-byte start code.
    const w = view.getUint16(26, true) & 0x3fff;
    const h = view.getUint16(28, true) & 0x3fff;
    return { width: w, height: h };
  }
  throw new Error("Unsupported WebP variant.");
}

interface Box {
  type: string;
  contentStart: number;
  contentEnd: number;
}

/** Iterate ISOBMFF boxes in [start, end); handles 32/64-bit and to-EOF sizes. */
function iterBoxes(view: DataView, bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = asciiAt(bytes, pos + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      const hi = view.getUint32(pos + 8);
      const lo = view.getUint32(pos + 12);
      size = hi * 2 ** 32 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    const boxEnd = pos + size;
    if (size < headerSize || boxEnd > end) break;
    boxes.push({ type, contentStart: pos + headerSize, contentEnd: boxEnd });
    pos = boxEnd;
  }
  return boxes;
}

/**
 * AVIF dims via ISOBMFF traversal (meta → iprp → ipco → ispe). AVIF is a fragile
 * box format; if `ispe` can't be located this THROWS, and the caller is expected
 * to fall back to `createImageBitmap` for AVIF dims (plan §5.2/P1-3). Per the
 * §11.4 P2-8 contract these dims are assumed NON-oriented (no EXIF rotation).
 */
function readAvifDims(view: DataView, bytes: Uint8Array): { width: number; height: number } {
  const len = view.byteLength;
  const meta = iterBoxes(view, bytes, 0, len).find((b) => b.type === "meta");
  if (!meta) throw new Error("AVIF: no meta box (fall back to createImageBitmap).");
  // `meta` is a FullBox: skip its 4-byte version/flags before child boxes.
  const iprp = iterBoxes(view, bytes, meta.contentStart + 4, meta.contentEnd).find(
    (b) => b.type === "iprp",
  );
  if (!iprp) throw new Error("AVIF: no iprp box (fall back to createImageBitmap).");
  const ipco = iterBoxes(view, bytes, iprp.contentStart, iprp.contentEnd).find(
    (b) => b.type === "ipco",
  );
  if (!ipco) throw new Error("AVIF: no ipco box (fall back to createImageBitmap).");
  const ispe = iterBoxes(view, bytes, ipco.contentStart, ipco.contentEnd).find(
    (b) => b.type === "ispe",
  );
  if (!ispe) throw new Error("AVIF: no ispe box (fall back to createImageBitmap).");
  // `ispe` is a FullBox: [version/flags(4)][width(4)][height(4)], big-endian.
  return {
    width: view.getUint32(ispe.contentStart + 4),
    height: view.getUint32(ispe.contentStart + 8),
  };
}

/**
 * Read pixel dimensions straight from the header bytes — no full rasterization,
 * so it is cheap and OOM-safe at upload time. **Orientation contract (§11.4
 * P2-8): JPEG dims are EXIF-oriented (orientation 5–8 swap W/H to match a
 * `imageOrientation:"from-image"` decode); WebP and AVIF dims are assumed
 * non-oriented.** AVIF may throw if the ISOBMFF `ispe` box can't be located —
 * the caller should fall back to `createImageBitmap` for AVIF dims.
 */
export function readImageDims(
  bytes: Uint8Array,
  format: NormFormat,
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (format) {
    case "png":
      return readPngDims(view);
    case "jpeg":
      return readJpegDims(view);
    case "webp":
      return readWebpDims(view, bytes);
    case "avif":
      return readAvifDims(view, bytes);
  }
}
