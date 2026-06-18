import { PDFDocument } from "pdf-lib";

export const ACCEPTED_TYPES = ["application/pdf"];
export const ACCEPTED_EXT = [".pdf"];
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB hard cap per file
export const WARN_FILE_SIZE = 25 * 1024 * 1024; // soft warning threshold

export interface PdfMeta {
  pageCount: number;
  encrypted: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

export function validatePdfFile(file: File): ValidationResult {
  const isPdfType = ACCEPTED_TYPES.includes(file.type);
  const isPdfExt = file.name.toLowerCase().endsWith(".pdf");
  if (!isPdfType && !isPdfExt) {
    return { valid: false, error: "Invalid file type. Please upload a PDF file." };
  }
  if (file.size === 0) {
    return { valid: false, error: "Empty file. The selected PDF has no content." };
  }
  if (file.size > MAX_FILE_SIZE) {
    const capMb = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    return { valid: false, error: `File too large. Maximum size is ${capMb}MB.` };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }
  return { valid: true };
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function getPdfMeta(bytes: Uint8Array): Promise<PdfMeta> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return { pageCount: doc.getPageCount(), encrypted: doc.isEncrypted };
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

// ── Range parsing (shared by split-pdf and watermark-pdf page targeting) ──

export interface ParsedRange {
  /** 1-based, inclusive, as the user typed it (for naming). */
  start: number;
  end: number;
  /** 0-based page indices for pdf-lib copyPages. */
  indices: number[];
}

export interface ParseResult {
  ranges: ParsedRange[];
  error?: string;
}

/** Strict positive-integer parse: only ASCII digits, else NaN. */
function parseIntStrict(s: string): number {
  if (!/^\d+$/.test(s)) return Number.NaN;
  return Number.parseInt(s, 10);
}

/**
 * Parse a human range spec against a known page count.
 * Input is 1-based inclusive; output `indices` are 0-based.
 *   "1-3, 5, 8-10"  (total=12) → three ranges: [0,1,2], [4], [7,8,9]
 * Never throws — malformed input returns `{ ranges: [], error }`.
 */
export function parsePageRanges(spec: string, totalPages: number): ParseResult {
  const trimmed = spec.trim();
  if (!trimmed) {
    return { ranges: [], error: "Enter at least one page or range." };
  }

  const ranges: ParsedRange[] = [];
  for (const rawGroup of trimmed.split(",")) {
    const group = rawGroup.trim();
    if (!group) continue; // tolerate stray / trailing comma

    let start: number;
    let end: number;

    if (group.includes("-")) {
      const parts = group.split("-");
      if (parts.length !== 2) {
        return { ranges: [], error: `Invalid range "${group}".` };
      }
      const startStr = (parts[0] ?? "").trim();
      const endStr = (parts[1] ?? "").trim();
      if (startStr === "" && endStr === "") {
        return { ranges: [], error: `Invalid range "${group}".` };
      }
      start = startStr === "" ? 1 : parseIntStrict(startStr);
      end = endStr === "" ? totalPages : parseIntStrict(endStr);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return { ranges: [], error: `Invalid range "${group}".` };
      }
    } else {
      const n = parseIntStrict(group);
      if (Number.isNaN(n)) {
        return { ranges: [], error: `Invalid page "${group}".` };
      }
      start = n;
      end = n;
    }

    if (start < 1 || start > totalPages) {
      return { ranges: [], error: `Page ${start} is out of range (1–${totalPages}).` };
    }
    if (end < 1 || end > totalPages) {
      return { ranges: [], error: `Page ${end} is out of range (1–${totalPages}).` };
    }
    if (end < start) {
      return { ranges: [], error: `Range ${start}-${end} is backwards.` };
    }

    const indices: number[] = [];
    for (let p = start; p <= end; p++) indices.push(p - 1);
    ranges.push({ start, end, indices });
  }

  if (ranges.length === 0) {
    return { ranges: [], error: "Enter at least one page or range." };
  }
  return { ranges };
}
