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
} from "@/lib/pdf";
export type { PdfMeta, ValidationResult } from "@/lib/pdf";

export const MAX_TOTAL_SIZE = 250 * 1024 * 1024; // total footprint guard

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
