import { PDFDocument } from "pdf-lib";

export const ACCEPTED_TYPES = ["application/pdf"];
export const ACCEPTED_EXT = [".pdf"];
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB hard cap per file
export const WARN_FILE_SIZE = 25 * 1024 * 1024; // soft warning threshold
export const MAX_TOTAL_SIZE = 250 * 1024 * 1024; // total footprint guard

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

export async function mergePdfs(
  inputs: Array<{ name: string; bytes: Uint8Array }>,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error("No PDFs to merge.");
  }
  const out = await PDFDocument.create();
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) continue;
    const src = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) {
      out.addPage(p);
    }
    opts?.onProgress?.(i + 1, inputs.length);
  }
  out.setProducer("");
  out.setCreator("");
  return out.save({ useObjectStreams: true });
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

export function buildMergedFilename(items: { name: string }[]): string {
  const first = items[0];
  if (!first) {
    return "merged.pdf";
  }
  const base = first.name.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = sanitized || "merged";
  return `${safe}-merged.pdf`;
}
