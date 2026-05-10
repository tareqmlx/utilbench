import { zipSync } from "fflate";

export type CornerRounding = "none" | "soft" | "circle";
export type ExportFormat = "recommended" | "ico-only" | "modern-only";

export const FAVICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 512] as const;
export const ICO_SIZES = [16, 32, 48] as const;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const WARN_FILE_SIZE = 2.5 * 1024 * 1024; // 2.5MB

export interface FaviconOptions {
  backgroundColor: string;
  cornerRounding: CornerRounding;
  exportFormat: ExportFormat;
  svgContent?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

export function validateFile(file: File): ValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Please upload a PNG, JPG, or SVG image." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 5MB." };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }
  return { valid: true };
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

function applyClipPath(
  ctx: CanvasRenderingContext2D,
  size: number,
  rounding: CornerRounding,
): void {
  if (rounding === "none") return;

  ctx.beginPath();
  if (rounding === "circle") {
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else {
    const radius = size * 0.15;
    ctx.roundRect(0, 0, size, size, radius);
  }
  ctx.clip();
}

export function renderToCanvas(
  img: HTMLImageElement,
  size: number,
  backgroundColor: string,
  rounding: CornerRounding,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

  // Fill background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, size, size);

  // Apply clip path for rounding
  ctx.save();
  applyClipPath(ctx, size, rounding);

  // Fill background inside clip too
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, size, size);

  // Draw image scaled to cover
  ctx.drawImage(img, 0, 0, size, size);
  ctx.restore();

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to create blob from canvas"));
    }, "image/png");
  });
}

export async function renderPreview(
  dataUrl: string,
  size: number,
  backgroundColor: string,
  rounding: CornerRounding,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = renderToCanvas(img, size, backgroundColor, rounding);
  return canvas.toDataURL("image/png");
}

export function encodeIco(pngBuffers: ArrayBuffer[]): Uint8Array {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = entrySize * pngBuffers.length;
  let dataOffset = headerSize + directorySize;

  let totalSize = dataOffset;
  for (const buf of pngBuffers) {
    totalSize += buf.byteLength;
  }

  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);

  // ICO header: reserved(2) + type(2) + count(2)
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: 1 = ICO
  view.setUint16(4, pngBuffers.length, true); // image count

  for (let i = 0; i < pngBuffers.length; i++) {
    const buf = pngBuffers[i];
    if (!buf) continue;
    const pngView = new DataView(buf);

    // Read dimensions from PNG header (IHDR chunk starts at byte 16)
    const width = pngView.getUint32(16, false);
    const height = pngView.getUint32(20, false);

    const offset = headerSize + i * entrySize;
    view.setUint8(offset, width >= 256 ? 0 : width); // width (0 = 256)
    view.setUint8(offset + 1, height >= 256 ? 0 : height); // height
    view.setUint8(offset + 2, 0); // color palette count
    view.setUint8(offset + 3, 0); // reserved
    view.setUint16(offset + 4, 1, true); // color planes
    view.setUint16(offset + 6, 32, true); // bits per pixel
    view.setUint32(offset + 8, buf.byteLength, true); // data size
    view.setUint32(offset + 12, dataOffset, true); // data offset

    result.set(new Uint8Array(buf), dataOffset);
    dataOffset += buf.byteLength;
  }

  return result;
}

export function generateWebManifest(): string {
  return JSON.stringify(
    {
      icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  );
}

export function getSizesForFormat(format: ExportFormat): readonly number[] {
  if (format === "ico-only") return ICO_SIZES;
  return FAVICON_SIZES;
}

export async function generateFaviconPack(dataUrl: string, options: FaviconOptions): Promise<Blob> {
  const { backgroundColor, cornerRounding, exportFormat, svgContent } = options;
  const img = await loadImage(dataUrl);

  // Generate all needed PNGs
  const sizes = exportFormat === "ico-only" ? ICO_SIZES : FAVICON_SIZES;
  const pngMap = new Map<number, ArrayBuffer>();

  for (const size of sizes) {
    const canvas = renderToCanvas(img, size, backgroundColor, cornerRounding);
    const blob = await canvasToBlob(canvas);
    pngMap.set(size, await blob.arrayBuffer());
  }

  // ICO-only: return single .ico file, no ZIP
  if (exportFormat === "ico-only") {
    const icoBuffers = ICO_SIZES.map((s) => pngMap.get(s) as ArrayBuffer);
    const ico = encodeIco(icoBuffers);
    return new Blob([ico], { type: "image/x-icon" });
  }

  // Build ZIP contents
  const files: Record<string, Uint8Array> = {};

  // Add ICO for recommended pack
  if (exportFormat === "recommended") {
    const icoBuffers = ICO_SIZES.map((s) => pngMap.get(s) as ArrayBuffer);
    files["favicon.ico"] = encodeIco(icoBuffers);
  }

  // Add PNGs
  for (const size of sizes) {
    const buf = pngMap.get(size);
    if (!buf) continue;
    let filename: string;
    if (size === 180) {
      filename = "apple-touch-icon.png";
    } else if (size === 192 || size === 512) {
      filename = `android-chrome-${size}x${size}.png`;
    } else {
      filename = `favicon-${size}x${size}.png`;
    }
    files[filename] = new Uint8Array(buf);
  }

  // Add web manifest
  files["site.webmanifest"] = new TextEncoder().encode(generateWebManifest());

  // Add SVG if source was SVG
  if (svgContent) {
    files["favicon.svg"] = new TextEncoder().encode(svgContent);
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: "application/zip" });
}
