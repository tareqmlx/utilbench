import { zipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";

// Re-export shared helpers so Route.tsx + tests import/mock ONE module (mirrors image tool).
// NOTE: getPdfMeta is re-exported only for test-mock convenience — Route.tsx must NOT call it at
// analyze time (readPdfMetadata already returns pageCount + encrypted in ONE load).
export { validatePdfFile, readFileBytes, getPdfMeta, downloadBlob } from "@/lib/pdf";
export type { PdfMeta, ValidationResult } from "@/lib/pdf";

export interface PdfMetadataSummary {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  hasXmp: boolean; // catalog has a /Metadata stream
  customKeys: string[]; // Info-dict keys beyond the 8 standard ones
  hasDocumentId: boolean; // trailer /ID present
  fieldCount: number; // count of non-empty standard fields + customKeys + xmp + id
}

// Per-file queue item (mirrors image-metadata-removal/metadata.ts FileItem — no previewUrl).
export type FileItemStatus = "analyzing" | "ready" | "processing" | "done" | "error";
export interface FileItem {
  id: string;
  file: File;
  status: FileItemStatus;
  metadata: PdfMetadataSummary | null;
  encrypted: boolean; // blocked → status "error" with the encrypted message
  cleanedBytes: Uint8Array | null;
  error: string | null;
  enterIndex?: number; // batch-local position, drives the queue enter stagger
}

export const STANDARD_INFO_KEYS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
];

const ENCRYPTED_MESSAGE = "This PDF is password-protected and can't be processed. Unlock it first.";

const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const MAX_BASENAME_LENGTH = 200;

/** Run a getter defensively — a throwing getter (pdf-lib #1571) must not abort the read. */
function safeGet<T>(fn: () => T | undefined): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** Treat empty AND whitespace-only strings as absent. */
function presentString(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

const EMPTY_SUMMARY: Omit<PdfMetadataSummary, "fieldCount"> = {
  title: null,
  author: null,
  subject: null,
  keywords: null,
  creator: null,
  producer: null,
  creationDate: null,
  modificationDate: null,
  hasXmp: false,
  customKeys: [],
  hasDocumentId: false,
};

/**
 * Inspect a PDF's existing metadata for the before/after display. Read-only.
 * Loads with { ignoreEncryption: true, updateMetadata: false } so reading does not stamp anything.
 * Returns pageCount + encrypted ALONGSIDE the summary so the analyze step does ONE load.
 *
 * GETTER FOOTGUN: the 8 getters internally call the private getInfoDict(), which CREATES + registers
 * an empty Info dict if none exists, mutating the in-memory doc. Harmless here because this never
 * saves the instance — but a stripped doc must never be inspected-then-saved on the same instance.
 */
export async function readPdfMetadata(
  bytes: Uint8Array,
): Promise<PdfMetadataSummary & { pageCount: number; encrypted: boolean }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pageCount = doc.getPageCount();

  // Encrypted gate first — skip all getter work and return an empty summary.
  if (doc.isEncrypted) {
    return { ...EMPTY_SUMMARY, fieldCount: 0, pageCount, encrypted: true };
  }

  const title = safeGet(() => doc.getTitle());
  const author = safeGet(() => doc.getAuthor());
  const subject = safeGet(() => doc.getSubject());
  const keywords = safeGet(() => doc.getKeywords());
  const creator = safeGet(() => doc.getCreator());
  const producer = safeGet(() => doc.getProducer());
  const creationDate = safeGet(() => doc.getCreationDate());
  const modificationDate = safeGet(() => doc.getModificationDate());

  const hasXmp = doc.catalog.get(PDFName.of("Metadata")) !== undefined;

  // Enumerate custom Info keys. An /Info ref pointing at a missing object can throw → degrade to [].
  let customKeys: string[] = [];
  try {
    const infoDict = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    const names = infoDict?.keys();
    if (names) {
      for (const name of names) {
        const decoded = name.decodeText().replace(/^\//, "");
        if (!STANDARD_INFO_KEYS.includes(decoded)) {
          customKeys.push(decoded);
        }
      }
    }
  } catch {
    customKeys = [];
  }

  const hasDocumentId = doc.context.trailerInfo.ID !== undefined;

  const fieldCount =
    (presentString(title) ? 1 : 0) +
    (presentString(author) ? 1 : 0) +
    (presentString(subject) ? 1 : 0) +
    (presentString(keywords) ? 1 : 0) +
    (presentString(creator) ? 1 : 0) +
    (presentString(producer) ? 1 : 0) +
    (creationDate !== null ? 1 : 0) +
    (modificationDate !== null ? 1 : 0) +
    customKeys.length +
    (hasXmp ? 1 : 0) +
    (hasDocumentId ? 1 : 0);

  return {
    title,
    author,
    subject,
    keywords,
    creator,
    producer,
    creationDate,
    modificationDate,
    hasXmp,
    customKeys,
    hasDocumentId,
    fieldCount,
    pageCount,
    encrypted: false,
  };
}

/**
 * The core strip — the privacy promise.
 *  - load { ignoreEncryption: true, updateMetadata: false } (no re-stamp of Producer/ModDate)
 *  - if doc.isEncrypted → throw (defense-in-depth; caller blocks earlier)
 *  - delete XMP stream object + ref, Info dict object + ref, trailer /ID
 *  - return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
 *
 * CRITICAL: NEVER call a getter between load and save — every getter recreates an empty Info dict
 * via the private getInfoDict() footgun. pdf-lib has NO garbage collection on save, so unlinking a
 * reference is not enough: we must ctx.delete() the underlying indirect object too, or it stays in
 * the output and remains recoverable.
 */
export async function stripPdfMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) {
    throw new Error(ENCRYPTED_MESSAGE);
  }
  const ctx = doc.context;

  // 1. XMP metadata stream (DocumentID/InstanceID, xmpMM:History) — unlink AND delete the object.
  const metaKey = PDFName.of("Metadata");
  const xmpRef = doc.catalog.get(metaKey); // PDFRef | PDFStream | undefined
  // Belt-and-suspenders: resolve the stream before unlink; only ctx.delete a real indirect ref.
  if (xmpRef instanceof PDFRef) {
    doc.catalog.delete(metaKey);
    ctx.delete(xmpRef); // remove the actual stream object (no GC!)
  } else if (xmpRef instanceof PDFStream) {
    // Direct inline stream (no ref): unlinking the catalog key is sufficient; ctx.delete is N/A.
    doc.catalog.delete(metaKey);
  }

  // 2. Document Info dictionary (Title/Author/.../custom keys) — unlink AND delete the object.
  const infoRef = ctx.trailerInfo.Info; // PDFRef when present (may be a direct PDFDict)
  if (infoRef instanceof PDFRef) {
    // Resolve + clear keys in place (harmless redundancy) before unlinking.
    const infoDict = ctx.lookup(infoRef, PDFDict);
    if (infoDict) {
      for (const key of [...infoDict.keys()]) {
        infoDict.delete(key);
      }
    }
    ctx.trailerInfo.Info = undefined; // unlink from trailer
    ctx.delete(infoRef); // remove the actual dict object (no GC!)
  } else if (infoRef instanceof PDFDict) {
    // Direct inline dict (no ref): the trailer unlink alone drops it from output; ctx.delete N/A.
    for (const key of [...infoRef.keys()]) {
      infoRef.delete(key);
    }
    ctx.trailerInfo.Info = undefined;
  } else {
    ctx.trailerInfo.Info = undefined;
  }

  // 3. Document /ID fingerprint (unique UUID pair in the trailer).
  ctx.trailerInfo.ID = undefined;

  // 4. Serialize. useObjectStreams matches the rest of the suite. updateFieldAppearances:false so a
  //    metadata strip never re-renders AcroForm field appearances.
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

/** fflate zip of cleaned files, de-duping identical names by appending _2, _3 (verbatim image tool). */
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
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

/**
 * `${base}-no-metadata.pdf`, hard-sanitized, fallback "document".
 * The output becomes a zip-entry name and fflate does NOT sanitize, so we strip path separators,
 * `..` segments, null bytes / control chars, cap length, and reject Windows-reserved names.
 * Output is always a single safe filename, never a path.
 */
export function buildCleanedFilename(originalName: string): string {
  // Drop any directory component an adversarial name might carry.
  const lastSep = Math.max(originalName.lastIndexOf("/"), originalName.lastIndexOf("\\"));
  const leaf = lastSep >= 0 ? originalName.slice(lastSep + 1) : originalName;

  // Strip the extension.
  let base = leaf.replace(/\.[^.]+$/, "");

  // Remove null bytes / control chars, path separators, and `.` segments (defangs `..`).
  base = base
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point.
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\]/g, "")
    .replace(/\.+/g, "");

  // Collapse remaining unsafe chars to hyphens; trim hyphens.
  base = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Cap length to keep zip entries well under filesystem limits.
  if (base.length > MAX_BASENAME_LENGTH) {
    base = base.slice(0, MAX_BASENAME_LENGTH).replace(/-+$/g, "");
  }

  // Reject Windows-reserved device names (case-insensitive).
  if (base === "" || WINDOWS_RESERVED.has(base.toUpperCase())) {
    base = "document";
  }

  return `${base}-no-metadata.pdf`;
}
