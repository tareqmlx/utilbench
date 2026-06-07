import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupURLMock } from "../../../test/canvas-mock";
import {
  MAX_FILE_SIZE,
  WARN_FILE_SIZE,
  buildMergedFilename,
  downloadBlob,
  getPdfMeta,
  mergePdfs,
  validatePdfFile,
} from "../merger";

async function makeDoc(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) {
    doc.addPage([w, h]);
  }
  return doc.save();
}

function pageSize(doc: PDFDocument, index: number): { width: number; height: number } {
  const { width, height } = doc.getPage(index).getSize();
  return { width: Math.round(width), height: Math.round(height) };
}

describe("validatePdfFile", () => {
  it("accepts application/pdf files", () => {
    const file = new File(["data"], "test.pdf", { type: "application/pdf" });
    expect(validatePdfFile(file)).toEqual({ valid: true });
  });

  it("accepts .pdf name with empty MIME type", () => {
    const file = new File(["data"], "x.pdf", { type: "" });
    expect(validatePdfFile(file)).toEqual({ valid: true });
  });

  it("rejects 0-byte files", () => {
    const file = new File([], "empty.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Empty file");
  });

  it("rejects oversize files", () => {
    const big = new Uint8Array(MAX_FILE_SIZE + 1);
    const file = new File([big], "big.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("warns when over WARN_FILE_SIZE but within MAX_FILE_SIZE", () => {
    const data = new Uint8Array(WARN_FILE_SIZE + 1);
    const file = new File([data], "large.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("rejects non-pdf files", () => {
    const file = new File(["data"], "notes.txt", { type: "text/plain" });
    const result = validatePdfFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });
});

describe("getPdfMeta", () => {
  it("reports page count and unencrypted state", async () => {
    const bytes = await makeDoc([
      [100, 100],
      [100, 100],
      [100, 100],
    ]);
    const meta = await getPdfMeta(bytes);
    expect(meta.pageCount).toBe(3);
    expect(meta.encrypted).toBe(false);
  });
});

describe("mergePdfs", () => {
  it("merges in order [A, B] preserving page count and sizes", async () => {
    const a = await makeDoc([
      [200, 300],
      [200, 300],
    ]);
    const b = await makeDoc([
      [400, 500],
      [400, 500],
      [400, 500],
    ]);
    const merged = await mergePdfs([
      { name: "a.pdf", bytes: a },
      { name: "b.pdf", bytes: b },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(5);
    for (let i = 0; i < 2; i++) {
      expect(pageSize(doc, i)).toEqual({ width: 200, height: 300 });
    }
    for (let i = 2; i < 5; i++) {
      expect(pageSize(doc, i)).toEqual({ width: 400, height: 500 });
    }
  });

  it("flips order when merging [B, A]", async () => {
    const a = await makeDoc([
      [200, 300],
      [200, 300],
    ]);
    const b = await makeDoc([
      [400, 500],
      [400, 500],
      [400, 500],
    ]);
    const merged = await mergePdfs([
      { name: "b.pdf", bytes: b },
      { name: "a.pdf", bytes: a },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(5);
    for (let i = 0; i < 3; i++) {
      expect(pageSize(doc, i)).toEqual({ width: 400, height: 500 });
    }
    for (let i = 3; i < 5; i++) {
      expect(pageSize(doc, i)).toEqual({ width: 200, height: 300 });
    }
  });

  it("calls onProgress with (1,2) then (2,2)", async () => {
    const a = await makeDoc([[200, 300]]);
    const b = await makeDoc([[400, 500]]);
    const onProgress = vi.fn();
    await mergePdfs(
      [
        { name: "a.pdf", bytes: a },
        { name: "b.pdf", bytes: b },
      ],
      { onProgress },
    );
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it("throws on empty input", async () => {
    await expect(mergePdfs([])).rejects.toThrow("No PDFs to merge.");
  });
});

describe("buildMergedFilename", () => {
  it("returns merged.pdf for empty input", () => {
    expect(buildMergedFilename([])).toBe("merged.pdf");
  });

  it("sanitizes the first filename and ends with .pdf", () => {
    const result = buildMergedFilename([{ name: "Report 2024.pdf" }]);
    expect(result.endsWith(".pdf")).toBe(true);
    expect(result).not.toContain(" ");
    expect(result).toBe("Report-2024-merged.pdf");
  });

  it("always ends with .pdf", () => {
    expect(buildMergedFilename([{ name: "***.pdf" }]).endsWith(".pdf")).toBe(true);
    expect(buildMergedFilename([{ name: "plain" }]).endsWith(".pdf")).toBe(true);
  });
});

describe("downloadBlob", () => {
  beforeEach(() => {
    setupURLMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("completes without throwing", () => {
    const blob = new Blob(["test"], { type: "application/pdf" });
    expect(() => downloadBlob(blob, "test.pdf")).not.toThrow();
  });

  it("creates and revokes the object URL", () => {
    const blob = new Blob(["test"], { type: "application/pdf" });
    downloadBlob(blob, "test.pdf");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("removes the anchor element from document body", () => {
    const blob = new Blob(["test"], { type: "application/pdf" });
    const before = document.body.childNodes.length;
    downloadBlob(blob, "test.pdf");
    expect(document.body.childNodes.length).toBe(before);
  });
});
