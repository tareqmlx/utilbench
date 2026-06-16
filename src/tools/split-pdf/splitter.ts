import { zip } from "fflate";
import { PDFDocument } from "pdf-lib";

export const ACCEPTED_TYPES = ["application/pdf"];
export const ACCEPTED_EXT = [".pdf"];
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB hard cap
export const WARN_FILE_SIZE = 25 * 1024 * 1024; // soft warning threshold
export const MAX_OUTPUT_FILES = 500; // guard "one file per page" on huge PDFs

export interface PdfMeta {
  pageCount: number;
  encrypted: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// ── File helpers (duplicated verbatim from merge-pdf/merger.ts; see plan §14) ──

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

// ── Range parsing (the core — see plan §5.3) ──

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

// ── Split modes (see plan §5.4) ──

export interface SplitOutput {
  filename: string;
  bytes: Uint8Array;
}

interface ProgressOpts {
  onProgress?: (done: number, total: number) => void;
}

/** Build one output PDF from a set of 0-based page indices of `src`. */
async function buildOutput(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  out.setProducer("");
  out.setCreator("");
  return out.save({ useObjectStreams: true });
}

/** One output file per range group. */
export async function splitByRanges(
  bytes: Uint8Array,
  ranges: ParsedRange[],
  baseName: string,
  opts?: ProgressOpts,
): Promise<SplitOutput[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outputs: SplitOutput[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (!range) continue;
    const outBytes = await buildOutput(src, range.indices);
    const filename =
      range.start === range.end
        ? `${baseName}-page-${range.start}.pdf`
        : `${baseName}-pages-${range.start}-${range.end}.pdf`;
    outputs.push({ filename, bytes: outBytes });
    opts?.onProgress?.(i + 1, ranges.length);
  }
  return outputs;
}

/** Sequential chunks of `n` pages; the last chunk may be short. */
export async function splitEveryN(
  bytes: Uint8Array,
  n: number,
  baseName: string,
  opts?: ProgressOpts,
): Promise<SplitOutput[]> {
  if (n < 1) throw new Error("N must be at least 1.");
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();

  const chunks: number[][] = [];
  for (let start = 0; start < total; start += n) {
    const indices: number[] = [];
    for (let p = start; p < Math.min(start + n, total); p++) indices.push(p);
    chunks.push(indices);
  }

  const outputs: SplitOutput[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const indices = chunks[i];
    if (!indices) continue;
    const outBytes = await buildOutput(src, indices);
    outputs.push({ filename: `${baseName}-part-${i + 1}.pdf`, bytes: outBytes });
    opts?.onProgress?.(i + 1, chunks.length);
  }
  return outputs;
}

/** One file per page, zero-padded to the page-count width so the zip sorts naturally. */
export async function splitPerPage(
  bytes: Uint8Array,
  baseName: string,
  opts?: ProgressOpts,
): Promise<SplitOutput[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const width = String(total).length;

  const outputs: SplitOutput[] = [];
  for (let i = 0; i < total; i++) {
    const outBytes = await buildOutput(src, [i]);
    const num = String(i + 1).padStart(width, "0");
    outputs.push({ filename: `${baseName}-page-${num}.pdf`, bytes: outBytes });
    opts?.onProgress?.(i + 1, total);
  }
  return outputs;
}

/** Wrap outputs in a ZIP via fflate's async `zip()` (yields to the event loop). */
export async function zipOutputs(outputs: SplitOutput[]): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const o of outputs) entries[o.filename] = o.bytes;
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export function buildBaseName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "document";
}

export function buildZipName(baseName: string): string {
  return `${baseName}-split.zip`;
}
