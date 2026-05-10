import { zipSync } from "fflate";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

export interface MetadataSummary {
  hasGps: boolean;
  cameraModel: string | null;
  exifVersion: string | null;
  tagCount: number;
  hasXmp: boolean;
  hasIptc: boolean;
}

export type FileItemStatus = "analyzing" | "ready" | "processing" | "done" | "error";

export interface FileItem {
  id: string;
  file: File;
  previewUrl: string;
  status: FileItemStatus;
  metadata: MetadataSummary | null;
  cleanedBlob: Blob | null;
  error: string | null;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const WARN_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const EMPTY_SUMMARY: MetadataSummary = {
  hasGps: false,
  cameraModel: null,
  exifVersion: null,
  tagCount: 0,
  hasXmp: false,
  hasIptc: false,
};

export function validateFile(file: File): ValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Please upload a JPG, PNG, or WebP image." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 50MB." };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }
  return { valid: true };
}

// --- Internal EXIF/metadata parsing ---

function readAscii(view: DataView, offset: number, length: number): string {
  let str = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
}

function parseExifData(
  view: DataView,
  tiffOffset: number,
  tiffLength: number,
): { hasGps: boolean; cameraModel: string | null; exifVersion: string | null; tagCount: number } {
  let hasGps = false;
  let cameraModel: string | null = null;
  let exifVersion: string | null = null;
  let tagCount = 0;

  try {
    // Read byte order
    const byteOrder = view.getUint16(tiffOffset);
    const le = byteOrder === 0x4949; // II = little-endian
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d)
      return { hasGps, cameraModel, exifVersion, tagCount };

    // Verify magic number 42
    const magic = view.getUint16(tiffOffset + 2, le);
    if (magic !== 42) return { hasGps, cameraModel, exifVersion, tagCount };

    // Read IFD0 offset
    const ifd0Offset = view.getUint32(tiffOffset + 4, le);
    const ifd0Pos = tiffOffset + ifd0Offset;

    if (ifd0Pos + 2 > tiffOffset + tiffLength)
      return { hasGps, cameraModel, exifVersion, tagCount };

    const ifd0Count = view.getUint16(ifd0Pos, le);
    tagCount = ifd0Count;

    let exifIfdOffset: number | null = null;

    for (let i = 0; i < ifd0Count; i++) {
      const entryOffset = ifd0Pos + 2 + i * 12;
      if (entryOffset + 12 > tiffOffset + tiffLength) break;

      const tag = view.getUint16(entryOffset, le);
      const type = view.getUint16(entryOffset + 2, le);
      const count = view.getUint32(entryOffset + 4, le);
      const valueOffset = view.getUint32(entryOffset + 8, le);

      if (tag === 0x0110) {
        // Camera Model
        const strOffset = count > 4 ? tiffOffset + valueOffset : entryOffset + 8;
        if (strOffset + count <= tiffOffset + tiffLength && type === 2) {
          cameraModel = readAscii(view, strOffset, count).trim() || null;
        }
      } else if (tag === 0x8769) {
        // ExifIFD pointer
        exifIfdOffset = valueOffset;
      } else if (tag === 0x8825) {
        // GPS IFD pointer
        hasGps = true;
      }
    }

    // Parse ExifIFD for version and additional tags
    if (exifIfdOffset !== null) {
      const exifPos = tiffOffset + exifIfdOffset;
      if (exifPos + 2 <= tiffOffset + tiffLength) {
        const exifCount = view.getUint16(exifPos, le);
        tagCount += exifCount;

        for (let i = 0; i < exifCount; i++) {
          const entryOffset = exifPos + 2 + i * 12;
          if (entryOffset + 12 > tiffOffset + tiffLength) break;

          const tag = view.getUint16(entryOffset, le);
          if (tag === 0x9000) {
            // EXIF version (undefined type, 4 bytes inline)
            const v = readAscii(view, entryOffset + 8, 4);
            if (v.length >= 4) {
              exifVersion = `${v[0]}${v[1]}.${v[2]}${v[3]}`.replace(/^0/, "");
            }
          }
        }
      }
    }
  } catch {
    // Gracefully handle corrupt data
  }

  return { hasGps, cameraModel, exifVersion, tagCount };
}

function parseJpegMetadata(buffer: ArrayBuffer): MetadataSummary {
  const view = new DataView(buffer);
  const summary = { ...EMPTY_SUMMARY };

  if (buffer.byteLength < 4) return summary;
  // Verify JPEG SOI
  if (view.getUint16(0) !== 0xffd8) return summary;

  let offset = 2;
  while (offset + 4 < buffer.byteLength) {
    const marker = view.getUint16(offset);

    // Stop at SOS or invalid markers
    if (marker === 0xffda || (marker & 0xff00) !== 0xff00) break;

    const segmentLength = view.getUint16(offset + 2);

    if (marker === 0xffe1) {
      // APP1 - EXIF or XMP
      const sig = readAscii(view, offset + 4, 6);
      if (sig.startsWith("Exif")) {
        // EXIF: TIFF header starts after "Exif\0\0" (6 bytes) from segment data start
        const tiffOffset = offset + 4 + 6;
        const tiffLength = segmentLength - 6;
        if (tiffOffset + tiffLength <= buffer.byteLength) {
          const exif = parseExifData(view, tiffOffset, tiffLength);
          summary.hasGps = exif.hasGps;
          summary.cameraModel = exif.cameraModel;
          summary.exifVersion = exif.exifVersion;
          summary.tagCount += exif.tagCount;
        }
      } else {
        // Check for XMP
        const xmpSig = readAscii(view, offset + 4, 29);
        if (xmpSig.startsWith("http://ns.adobe.com/xap/1.0/")) {
          summary.hasXmp = true;
          summary.tagCount += 1;
        }
      }
    } else if (marker === 0xffed) {
      // APP13 - IPTC
      summary.hasIptc = true;
      summary.tagCount += 1;
    }

    offset += 2 + segmentLength;
  }

  return summary;
}

function parsePngMetadata(buffer: ArrayBuffer): MetadataSummary {
  const view = new DataView(buffer);
  const summary = { ...EMPTY_SUMMARY };

  if (buffer.byteLength < 8) return summary;
  // Verify PNG signature
  if (view.getUint32(0) !== 0x89504e47) return summary;

  let offset = 8; // After signature
  while (offset + 8 < buffer.byteLength) {
    const chunkLength = view.getUint32(offset);
    const chunkType = readAscii(view, offset + 4, 4);

    if (chunkType === "eXIf") {
      // Raw EXIF data (TIFF header)
      const tiffOffset = offset + 8;
      if (tiffOffset + chunkLength <= buffer.byteLength) {
        const exif = parseExifData(view, tiffOffset, chunkLength);
        summary.hasGps = exif.hasGps;
        summary.cameraModel = exif.cameraModel;
        summary.exifVersion = exif.exifVersion;
        summary.tagCount += exif.tagCount;
      }
    } else if (chunkType === "tEXt" || chunkType === "iTXt" || chunkType === "zTXt") {
      summary.tagCount += 1;
      // Check for XMP in iTXt
      if (chunkType === "iTXt" && offset + 12 < buffer.byteLength) {
        const keyword = readAscii(view, offset + 8, Math.min(chunkLength, 30));
        if (keyword.startsWith("XML:com.adobe.xmp")) {
          summary.hasXmp = true;
        }
      }
    } else if (chunkType === "iCCP") {
      summary.tagCount += 1;
    } else if (chunkType === "IEND") {
      break;
    }

    offset += 12 + chunkLength; // 4 (length) + 4 (type) + data + 4 (CRC)
  }

  return summary;
}

function parseWebpMetadata(buffer: ArrayBuffer): MetadataSummary {
  const view = new DataView(buffer);
  const summary = { ...EMPTY_SUMMARY };

  if (buffer.byteLength < 12) return summary;
  // Verify RIFF header
  const riff = readAscii(view, 0, 4);
  const webp = readAscii(view, 8, 4);
  if (riff !== "RIFF" || webp !== "WEBP") return summary;

  let offset = 12;
  while (offset + 8 < buffer.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true); // WebP uses little-endian

    if (chunkId === "EXIF") {
      const tiffOffset = offset + 8;
      if (tiffOffset + chunkSize <= buffer.byteLength) {
        const exif = parseExifData(view, tiffOffset, chunkSize);
        summary.hasGps = exif.hasGps;
        summary.cameraModel = exif.cameraModel;
        summary.exifVersion = exif.exifVersion;
        summary.tagCount += exif.tagCount;
      }
    } else if (chunkId === "XMP ") {
      summary.hasXmp = true;
      summary.tagCount += 1;
    }

    // Chunks are padded to even size
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return summary;
}

export async function extractMetadata(file: File): Promise<MetadataSummary> {
  try {
    const slice = file.slice(0, 65536);
    const buffer = await slice.arrayBuffer();

    if (file.type === "image/jpeg") return parseJpegMetadata(buffer);
    if (file.type === "image/png") return parsePngMetadata(buffer);
    if (file.type === "image/webp") return parseWebpMetadata(buffer);

    return { ...EMPTY_SUMMARY };
  } catch {
    return { ...EMPTY_SUMMARY };
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create blob from canvas"));
      },
      mimeType,
      quality,
    );
  });
}

export async function stripMetadata(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.drawImage(img, 0, 0);

  const quality = file.type === "image/jpeg" ? 0.92 : undefined;
  return canvasToBlob(canvas, file.type, quality);
}

export function buildZip(items: Array<{ name: string; data: Uint8Array }>): Blob {
  const files: Record<string, Uint8Array> = {};
  const nameCount = new Map<string, number>();

  for (const item of items) {
    let finalName = item.name;
    const count = nameCount.get(item.name);
    if (count !== undefined) {
      const dotIndex = item.name.lastIndexOf(".");
      const base = dotIndex > 0 ? item.name.slice(0, dotIndex) : item.name;
      const ext = dotIndex > 0 ? item.name.slice(dotIndex) : "";
      finalName = `${base}_${count + 1}${ext}`;
      nameCount.set(item.name, count + 1);
    } else {
      nameCount.set(item.name, 1);
    }
    files[finalName] = item.data;
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: "application/zip" });
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
