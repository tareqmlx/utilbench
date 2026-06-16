import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupURLMock } from "../../../test/canvas-mock";
import {
  MAX_FILE_SIZE,
  WARN_FILE_SIZE,
  buildBaseName,
  buildZipName,
  downloadBlob,
  getPdfMeta,
  parsePageRanges,
  splitByRanges,
  splitEveryN,
  splitPerPage,
  validatePdfFile,
  zipOutputs,
} from "../splitter";
import type { SplitOutput } from "../splitter";

async function makeDoc(pageCount: number, w = 100, h = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([w, h]);
  }
  return doc.save();
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
    const bytes = await makeDoc(3);
    const meta = await getPdfMeta(bytes);
    expect(meta.pageCount).toBe(3);
    expect(meta.encrypted).toBe(false);
  });
});

describe("parsePageRanges", () => {
  it("parses a single range '1-3'", () => {
    const result = parsePageRanges("1-3", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.indices).toEqual([0, 1, 2]);
    expect(result.ranges[0]?.start).toBe(1);
    expect(result.ranges[0]?.end).toBe(3);
  });

  it("parses multiple groups '1-3, 5, 8-10'", () => {
    const result = parsePageRanges("1-3, 5, 8-10", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(3);
    expect(result.ranges[0]?.indices).toEqual([0, 1, 2]);
    expect(result.ranges[1]?.indices).toEqual([4]);
    expect(result.ranges[2]?.indices).toEqual([7, 8, 9]);
  });

  it("tolerates whitespace ' 2 , 4 , 6 '", () => {
    const result = parsePageRanges(" 2 , 4 , 6 ", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(3);
    expect(result.ranges[0]?.indices).toEqual([1]);
    expect(result.ranges[1]?.indices).toEqual([3]);
    expect(result.ranges[2]?.indices).toEqual([5]);
  });

  it("parses a single page '5'", () => {
    const result = parsePageRanges("5", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]).toEqual({ start: 5, end: 5, indices: [4] });
  });

  it("parses open-ended start '8-'", () => {
    const result = parsePageRanges("8-", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.indices).toEqual([7, 8, 9]);
  });

  it("parses open-ended end '-3'", () => {
    const result = parsePageRanges("-3", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.indices).toEqual([0, 1, 2]);
  });

  it("ignores a trailing comma '1-3,'", () => {
    const result = parsePageRanges("1-3,", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.indices).toEqual([0, 1, 2]);
  });

  it("keeps overlapping ranges '1-3, 2-4' (no dedupe)", () => {
    const result = parsePageRanges("1-3, 2-4", 10);
    expect(result.error).toBeUndefined();
    expect(result.ranges).toHaveLength(2);
    expect(result.ranges[0]?.indices).toEqual([0, 1, 2]);
    expect(result.ranges[1]?.indices).toEqual([1, 2, 3]);
  });

  it("errors on a backwards range '5-3'", () => {
    const result = parsePageRanges("5-3", 10);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("backwards");
    expect(result.ranges).toEqual([]);
  });

  it("errors when out of range '1-99'", () => {
    const result = parsePageRanges("1-99", 10);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("out of range");
    expect(result.ranges).toEqual([]);
  });

  it("errors on page '0' (out of range)", () => {
    const result = parsePageRanges("0", 10);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("out of range");
    expect(result.ranges).toEqual([]);
  });

  it("errors on non-numeric 'abc'", () => {
    const result = parsePageRanges("abc", 10);
    expect(result.error).toBeDefined();
    expect(result.ranges).toEqual([]);
  });

  it("errors on empty input ''", () => {
    const result = parsePageRanges("", 10);
    expect(result.error).toBeDefined();
    expect(result.ranges).toEqual([]);
  });

  it("errors on malformed '1--3' (three parts)", () => {
    const result = parsePageRanges("1--3", 10);
    expect(result.error).toBeDefined();
    expect(result.ranges).toEqual([]);
  });

  it("errors on malformed '1-2-3'", () => {
    const result = parsePageRanges("1-2-3", 10);
    expect(result.error).toBeDefined();
    expect(result.ranges).toEqual([]);
  });

  it("never throws on malformed input", () => {
    const inputs = ["", " ", "-", "--", "1-", "-2", "a-b", "1-2-3", "1,,2", "999", "0", "x"];
    for (const input of inputs) {
      expect(() => parsePageRanges(input, 10)).not.toThrow();
      const result = parsePageRanges(input, 10);
      expect(Array.isArray(result.ranges)).toBe(true);
    }
  });
});

describe("splitByRanges", () => {
  it("produces one output per range with correct page counts and filenames", async () => {
    const bytes = await makeDoc(10);
    const { ranges } = parsePageRanges("1-3, 5", 10);
    const onProgress = vi.fn();
    const outputs = await splitByRanges(bytes, ranges, "doc", { onProgress });

    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.filename).toBe("doc-pages-1-3.pdf");
    expect(outputs[1]?.filename).toBe("doc-page-5.pdf");

    const doc0 = await PDFDocument.load(outputs[0]?.bytes);
    const doc1 = await PDFDocument.load(outputs[1]?.bytes);
    expect(doc0.getPageCount()).toBe(3);
    expect(doc1.getPageCount()).toBe(1);

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });
});

describe("splitEveryN", () => {
  it("splits into ceil(total/n) chunks with a short last chunk (n=3)", async () => {
    const bytes = await makeDoc(10);
    const outputs = await splitEveryN(bytes, 3, "doc");

    expect(outputs).toHaveLength(4);
    expect(outputs[0]?.filename).toBe("doc-part-1.pdf");
    expect(outputs[3]?.filename).toBe("doc-part-4.pdf");

    const first = await PDFDocument.load(outputs[0]?.bytes);
    const last = await PDFDocument.load(outputs[3]?.bytes);
    expect(first.getPageCount()).toBe(3);
    expect(last.getPageCount()).toBe(1);
  });

  it("splits 10 pages into [4,4,2] when n=4", async () => {
    const bytes = await makeDoc(10);
    const outputs = await splitEveryN(bytes, 4, "doc");
    expect(outputs).toHaveLength(3);

    const counts: number[] = [];
    for (const o of outputs) {
      const doc = await PDFDocument.load(o.bytes);
      counts.push(doc.getPageCount());
    }
    expect(counts).toEqual([4, 4, 2]);
  });

  it("throws when n < 1", async () => {
    const bytes = await makeDoc(10);
    await expect(splitEveryN(bytes, 0, "x")).rejects.toThrow();
  });
});

describe("splitPerPage", () => {
  it("produces one zero-padded output per page (12 pages → width 2)", async () => {
    const bytes = await makeDoc(12);
    const outputs = await splitPerPage(bytes, "doc");

    expect(outputs).toHaveLength(12);
    expect(outputs[0]?.filename).toBe("doc-page-01.pdf");
    expect(outputs[11]?.filename).toBe("doc-page-12.pdf");

    const doc0 = await PDFDocument.load(outputs[0]?.bytes);
    expect(doc0.getPageCount()).toBe(1);
  });

  it("uses width 1 for a 5-page doc", async () => {
    const bytes = await makeDoc(5);
    const outputs = await splitPerPage(bytes, "doc");

    expect(outputs).toHaveLength(5);
    expect(outputs[0]?.filename).toBe("doc-page-1.pdf");
    expect(outputs[4]?.filename).toBe("doc-page-5.pdf");
  });
});

describe("zipOutputs", () => {
  it("zips outputs into a non-empty archive with matching entries", async () => {
    const outputs: SplitOutput[] = [
      { filename: "a.pdf", bytes: new Uint8Array([1, 2, 3]) },
      { filename: "b.pdf", bytes: new Uint8Array([4, 5, 6, 7]) },
      { filename: "c.pdf", bytes: new Uint8Array([8]) },
    ];
    const zipped = await zipOutputs(outputs);
    expect(zipped).toBeInstanceOf(Uint8Array);
    expect(zipped.length).toBeGreaterThan(0);

    const unzipped = unzipSync(zipped);
    const names = Object.keys(unzipped).sort();
    expect(names).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(unzipped["a.pdf"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(unzipped["b.pdf"]).toEqual(new Uint8Array([4, 5, 6, 7]));
  });

  it("suffixes duplicate filenames instead of overwriting", async () => {
    const outputs: SplitOutput[] = [
      { filename: "doc-page-5.pdf", bytes: new Uint8Array([1]) },
      { filename: "doc-page-5.pdf", bytes: new Uint8Array([2]) },
      { filename: "doc-page-5.pdf", bytes: new Uint8Array([3]) },
    ];
    const unzipped = unzipSync(await zipOutputs(outputs));
    const names = Object.keys(unzipped).sort();
    expect(names).toEqual(["doc-page-5-2.pdf", "doc-page-5-3.pdf", "doc-page-5.pdf"]);
    expect(unzipped["doc-page-5.pdf"]).toEqual(new Uint8Array([1]));
    expect(unzipped["doc-page-5-2.pdf"]).toEqual(new Uint8Array([2]));
    expect(unzipped["doc-page-5-3.pdf"]).toEqual(new Uint8Array([3]));
  });
});

describe("buildBaseName", () => {
  it("sanitizes a name with spaces", () => {
    expect(buildBaseName("Report 2024.pdf")).toBe("Report-2024");
  });

  it("falls back to 'document' for an all-symbol name", () => {
    expect(buildBaseName("***.pdf")).toBe("document");
  });

  it("keeps a plain name without extension", () => {
    expect(buildBaseName("plain")).toBe("plain");
  });
});

describe("buildZipName", () => {
  it("appends -split.zip", () => {
    expect(buildZipName("doc")).toBe("doc-split.zip");
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
