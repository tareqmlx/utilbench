import { zipSync } from "fflate";

export type OutputFormat = "jpeg" | "png" | "webp" | "avif";
export type ResizeMode = "single" | "batch";

export interface ResizeOptions {
  width: number;
  height: number;
  format: OutputFormat;
  quality: number; // 1-100
}

export interface QueueItem {
  id: string;
  file: File;
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  thumbnailUrl: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  resultBlob?: Blob;
  resultUrl?: string;
  resultSize?: number;
  processingTime?: number;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const WARN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateFile(file: File): ValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Please upload a PNG, JPG, or WebP image." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 20MB." };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }
  return { valid: true };
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = source;
  });
}

export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export function getMimeType(format: OutputFormat): string {
  const map: Record<OutputFormat, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
  };
  return map[format];
}

export function getFileExtension(format: OutputFormat): string {
  const map: Record<OutputFormat, string> = {
    jpeg: "jpg",
    png: "png",
    webp: "webp",
    avif: "avif",
  };
  return map[format];
}

export function getQualityForCanvas(format: OutputFormat, quality: number): number | undefined {
  // PNG is lossless — quality parameter is ignored by canvas
  if (format === "png") return undefined;
  return quality / 100;
}

export function isFormatSupported(format: OutputFormat): boolean {
  if (format === "png" || format === "jpeg") return true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const dataUrl = canvas.toDataURL(getMimeType(format));
    return dataUrl.startsWith(`data:${getMimeType(format)}`);
  } catch {
    return false;
  }
}

export function clampDimension(value: number): number {
  return Math.max(1, Math.min(10000, Math.round(value)));
}

export function estimateSize(
  originalSize: number,
  originalWidth: number,
  originalHeight: number,
  targetWidth: number,
  targetHeight: number,
  format: OutputFormat,
  quality: number,
): number {
  const pixelRatio = (targetWidth * targetHeight) / (originalWidth * originalHeight);
  let estimate = originalSize * pixelRatio;

  // Format-based multipliers
  if (format === "jpeg") estimate *= (quality / 100) * 0.8;
  else if (format === "webp") estimate *= (quality / 100) * 0.6;
  else if (format === "avif") estimate *= (quality / 100) * 0.4;
  // PNG is lossless, no quality-based reduction

  return Math.max(1024, Math.round(estimate));
}

export function generateFilename(originalName: string, options: ResizeOptions): string {
  const baseName = originalName.replace(/\.[^.]+$/, "");
  const ext = getFileExtension(options.format);
  return `${baseName}_${options.width}x${options.height}.${ext}`;
}

export async function resizeImage(file: File, options: ResizeOptions): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height, format, quality } = options;

    const scaleFactor = Math.max(img.naturalWidth / width, img.naturalHeight / height);
    let sourceCanvas: HTMLCanvasElement;

    // Two-pass downscaling for quality when scale factor > 2x
    if (scaleFactor > 2) {
      const intermediateWidth = width * 2;
      const intermediateHeight = height * 2;
      const intermediate = document.createElement("canvas");
      intermediate.width = intermediateWidth;
      intermediate.height = intermediateHeight;
      const iCtx = intermediate.getContext("2d");
      if (!iCtx) throw new Error("Failed to get 2d context");
      iCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);
      sourceCanvas = intermediate;
    } else {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const tCtx = tempCanvas.getContext("2d");
      if (!tCtx) throw new Error("Failed to get 2d context");
      tCtx.drawImage(img, 0, 0);
      sourceCanvas = tempCanvas;
    }

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = width;
    finalCanvas.height = height;
    const fCtx = finalCanvas.getContext("2d");
    if (!fCtx) throw new Error("Failed to get 2d context");
    fCtx.drawImage(sourceCanvas, 0, 0, width, height);

    const mimeType = getMimeType(format);
    const canvasQuality = getQualityForCanvas(format, quality);

    return new Promise((resolve, reject) => {
      finalCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create blob from canvas"));
        },
        mimeType,
        canvasQuality,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

export async function createBatchZip(
  items: Array<{ blob: Blob; filename: string }>,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  for (const item of items) {
    const buf = await item.blob.arrayBuffer();
    files[item.filename] = new Uint8Array(buf);
  }
  const zipped = zipSync(files);
  return new Blob([zipped], { type: "application/zip" });
}
