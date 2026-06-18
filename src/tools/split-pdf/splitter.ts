import type { ParsedRange } from "@/lib/pdf";
import { zip } from "fflate";
import { PDFDocument } from "pdf-lib";

export {
  ACCEPTED_TYPES,
  ACCEPTED_EXT,
  MAX_FILE_SIZE,
  WARN_FILE_SIZE,
  validatePdfFile,
  readFileBytes,
  getPdfMeta,
  downloadBlob,
  parsePageRanges,
} from "@/lib/pdf";
export type { PdfMeta, ValidationResult, ParsedRange, ParseResult } from "@/lib/pdf";

export const MAX_OUTPUT_FILES = 500; // guard "one file per page" on huge PDFs

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
  // Duplicate range groups (e.g. "5, 5") yield identical filenames; suffix
  // collisions so every output survives the zip instead of silently overwriting.
  const seen = new Map<string, number>();
  for (const o of outputs) {
    const count = seen.get(o.filename) ?? 0;
    seen.set(o.filename, count + 1);
    let name = o.filename;
    if (count > 0) {
      const dot = name.lastIndexOf(".");
      name =
        dot === -1
          ? `${name}-${count + 1}`
          : `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
    }
    entries[name] = o.bytes;
  }
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
