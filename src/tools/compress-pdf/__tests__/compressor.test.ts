import { setupCanvasMock, setupURLMock } from "@/test/canvas-mock";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// compressor.ts → @/lib/pdfjs-render, which has an unresolvable `?url` import of
// the pdf.js worker. Mock the URL so the PARTIAL mock below can load the real module.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-url" }));

const PasswordResponses = { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };

// PARTIAL mock of the shared render core: keep buildBaseName / PDFJS_ASSETS /
// computeOutputDims real (compressor + the filename test depend on them); mock
// only the heavy/IO pieces compressStrong drives (getPdfjs/renderPageToBlob) and
// the re-exported probePdf (so we can assert identity + the encrypted no-throw).
let getDocumentImpl: (params: unknown) => unknown;
let renderPageToBlobImpl: (page: unknown, opts: unknown) => unknown;

vi.mock("@/lib/pdfjs-render", async (orig) => {
  const actual = await orig<typeof import("@/lib/pdfjs-render")>();
  return {
    ...actual,
    getPdfjs: vi.fn(async () => ({
      getDocument: (params: unknown) => getDocumentImpl(params),
      PasswordResponses,
    })),
    renderPageToBlob: vi.fn((page: unknown, opts: unknown) => renderPageToBlobImpl(page, opts)),
    probePdf: vi.fn(),
  };
});

import { probePdf as sharedProbePdf } from "@/lib/pdfjs-render";
import * as compressor from "../compressor";
import {
  buildCompressedFilename,
  compressLossless,
  compressPdf,
  compressStrong,
  formatBytes,
} from "../compressor";

// A real 1×1 baseline JPEG. out.embedJpg() parses real JPEG markers, so synthetic
// bytes (e.g. the canvas-mock's fake PNG) would throw — these are genuine.
const JPEG_1x1_B64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k=";
const JPEG_1x1 = Uint8Array.from(atob(JPEG_1x1_B64), (c) => c.charCodeAt(0));

// ── Fake pdf.js page / doc / loadingTask builders ──────────────────────────

function makeFakePage(width = 612, height = 792, getPageImpl?: () => void) {
  return {
    _w: width,
    _h: height,
    getPageImpl,
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    cleanup: vi.fn(),
  };
}

function makeFakeDoc(numPages: number, getPage: (n: number) => unknown) {
  return { numPages, getPage: vi.fn((n: number) => Promise.resolve(getPage(n))) };
}

interface LoadingTaskOpts {
  doc?: unknown;
  loadError?: { name: string };
  onPasswordReason?: number;
  passwordResolvesDoc?: unknown;
}

function makeFakeLoadingTask(opts: LoadingTaskOpts) {
  const destroy = vi.fn(() => Promise.resolve());
  const task: Record<string, unknown> = { onPassword: undefined, destroy };
  task.promise = (async () => {
    await Promise.resolve(); // let compressStrong assign loadingTask.onPassword first
    if (opts.onPasswordReason !== undefined) {
      const onPassword = task.onPassword as
        | ((update: (pw: string) => void, reason: number) => void)
        | undefined;
      if (onPassword) {
        await new Promise<void>((resolve) => {
          onPassword(() => resolve(), opts.onPasswordReason as number);
        });
      }
      return opts.passwordResolvesDoc ?? opts.doc;
    }
    if (opts.loadError) throw opts.loadError;
    return opts.doc;
  })();
  return task;
}

// Default render: emit a real 1×1 JPEG, unclamped, points straight from the page.
function defaultRenderImpl(page: unknown) {
  const p = page as { _w: number; _h: number };
  return Promise.resolve({
    blob: new Blob([JPEG_1x1], { type: "image/jpeg" }),
    clamped: false,
    ptW: p._w,
    ptH: p._h,
    width: p._w,
    height: p._h,
  });
}

const STRONG: compressor.StrongOptions = { dpi: 150, jpegQuality: 0.6 };

beforeEach(() => {
  getDocumentImpl = () => makeFakeLoadingTask({ doc: makeFakeDoc(1, () => makeFakePage()) });
  renderPageToBlobImpl = (page) => defaultRenderImpl(page);
  setupCanvasMock();
  setupURLMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Crit#2: probePdf re-export wiring ───────────────────────────────────────

describe("probePdf re-export (Crit#2)", () => {
  it("re-exports the SHARED probePdf (not getPdfMeta)", () => {
    expect(compressor.probePdf).toBe(sharedProbePdf);
  });

  it("a strongly-encrypted probe (pageCount:0, dimsKnown:false) does NOT throw", async () => {
    vi.mocked(sharedProbePdf).mockResolvedValueOnce({
      pageCount: 0,
      encrypted: true,
      pageSizes: [],
      dimsKnown: false,
    });
    await expect(compressor.probePdf(new Uint8Array([1]))).resolves.toEqual({
      pageCount: 0,
      encrypted: true,
      pageSizes: [],
      dimsKnown: false,
    });
  });
});

// ── compressLossless ────────────────────────────────────────────────────────

async function makeRealPdf(pages: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pages) doc.addPage([w, h]);
  return doc.save();
}

describe("compressLossless", () => {
  it("produces a valid PDF with the page count unchanged", async () => {
    const input = await makeRealPdf([
      [612, 792],
      [595, 842],
    ]);
    const { bytes, pageCount } = await compressLossless(input);
    expect(pageCount).toBe(2);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("nulls Producer and Creator", async () => {
    // pdf-lib re-stamps its OWN Producer string into the bytes at save() time, so
    // asserting getProducer() === "" on the reloaded PDF is impossible. Instead
    // prove the compressor calls setProducer("")/setCreator("") (the metadata-strip
    // contract) by spying on the live doc.
    const setProducer = vi.fn();
    const setCreator = vi.fn();
    const realLoad = PDFDocument.load.bind(PDFDocument);
    vi.spyOn(PDFDocument, "load").mockImplementationOnce(async (...args) => {
      const doc = await realLoad(args[0] as Parameters<typeof realLoad>[0], args[1]);
      vi.spyOn(doc, "setProducer").mockImplementation(setProducer);
      vi.spyOn(doc, "setCreator").mockImplementation(setCreator);
      return doc;
    });

    const src = await PDFDocument.create();
    src.addPage([612, 792]);
    const input = await src.save();
    await compressLossless(input);
    expect(setProducer).toHaveBeenCalledWith("");
    expect(setCreator).toHaveBeenCalledWith("");
  });

  it("maps a corrupt input to a friendly message (no raw pdf-lib parse error)", async () => {
    vi.spyOn(PDFDocument, "load").mockRejectedValueOnce(
      new Error('Failed to parse number (line:0 col:5 offset=5): ""'),
    );
    await expect(compressLossless(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /not a valid PDF or is corrupt/,
    );
  });

  it("maps a load-ok-but-broken-catalog PDF to the friendly message", async () => {
    // A PDF can load yet throw later (e.g. catalog missing /Pages → getPageCount
    // throws "Expected instance of PDFDict…"). That raw error must not leak.
    vi.spyOn(PDFDocument, "load").mockResolvedValueOnce({
      isEncrypted: false,
      getPageCount: () => {
        throw new Error("Expected instance of PDFDict, but got instance of undefined");
      },
    } as unknown as PDFDocument);
    await expect(compressLossless(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /not a valid PDF or is corrupt/,
    );
  });

  it("throws when the input is encrypted", async () => {
    vi.spyOn(PDFDocument, "load").mockResolvedValueOnce({
      isEncrypted: true,
      getPageCount: () => 1,
    } as unknown as PDFDocument);
    await expect(compressLossless(new Uint8Array([1]))).rejects.toThrow(/encrypted/i);
  });
});

// ── compressStrong ──────────────────────────────────────────────────────────

describe("compressStrong", () => {
  it("rasterizes every page; output loads and page count === input numPages", async () => {
    const doc = makeFakeDoc(3, () => makeFakePage(612, 792));
    getDocumentImpl = () => makeFakeLoadingTask({ doc });

    const { bytes, pageCount } = await compressStrong(new Uint8Array([1, 2]), STRONG);
    expect(pageCount).toBe(3);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it("sizes each output page in SOURCE POINTS (not pixel-scaled)", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage(612, 792));
    getDocumentImpl = () => makeFakeLoadingTask({ doc });

    const { bytes } = await compressStrong(new Uint8Array([1]), STRONG);
    const reloaded = await PDFDocument.load(bytes);
    const { width, height } = reloaded.getPage(0).getSize();
    // Points come straight from the viewport (612×792), NOT 612×(150/72) etc.
    expect(width).toBeCloseTo(612, 1);
    expect(height).toBeCloseTo(792, 1);
  });

  it("embeds the JPEG and paints a white rectangle on each page", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage(612, 792));
    getDocumentImpl = () => makeFakeLoadingTask({ doc });

    // The content stream is compressed in the saved bytes, so the white-rect draw
    // op can't be grepped reliably — spy the call instead (keeps the real impl, so
    // the JPEG still embeds). Source points (612×792), full-page, opaque white.
    const drawRect = vi.spyOn(PDFPage.prototype, "drawRectangle");

    const { bytes } = await compressStrong(new Uint8Array([1]), STRONG);

    expect(drawRect).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) }),
    );
    // And the JPEG actually embedded: the saved PDF carries a DCTDecode image XObject.
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toMatch(/\/Subtype\s*\/Image/);
    expect(text).toMatch(/DCTDecode/); // JPEG filter ⇒ embedJpg ran
  });

  it("forwards dpi + jpegQuality to renderPageToBlob", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    const seen: Array<{ dpi: number; format: string; jpegQuality?: number }> = [];
    renderPageToBlobImpl = (page, opts) => {
      seen.push(opts as { dpi: number; format: string; jpegQuality?: number });
      return defaultRenderImpl(page);
    };
    await compressStrong(new Uint8Array([1]), { dpi: 96, jpegQuality: 0.42 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ dpi: 96, format: "jpeg", jpegQuality: 0.42 });
  });

  it("counts clamped pages", async () => {
    const doc = makeFakeDoc(2, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    let call = 0;
    renderPageToBlobImpl = (page) => {
      call++;
      const p = page as { _w: number; _h: number };
      return Promise.resolve({
        blob: new Blob([JPEG_1x1], { type: "image/jpeg" }),
        clamped: call === 1, // only the first page is clamped
        ptW: p._w,
        ptH: p._h,
        width: p._w,
        height: p._h,
      });
    };
    const { clampedPages } = await compressStrong(new Uint8Array([1]), STRONG);
    expect(clampedPages).toBe(1);
  });

  it("Crit#1: a single page render failure is FATAL — throws and produces NO bytes", async () => {
    // 10 pages, page 3 (1-indexed) fails to render.
    const doc = makeFakeDoc(10, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    let rendered = 0;
    renderPageToBlobImpl = (page) => {
      rendered++;
      if (rendered === 3) return Promise.reject(new Error("boom on page 3"));
      return defaultRenderImpl(page);
    };
    // The raw "boom" is wrapped with plan-mandated page context (§11.3).
    await expect(compressStrong(new Uint8Array([1]), STRONG)).rejects.toThrow(
      /Couldn't compress page 3/,
    );
    // No "collect-and-continue": it stopped at the failing page, didn't finish all 10.
    expect(rendered).toBe(3);
  });

  it("cancels via AbortSignal → rejects AbortError", async () => {
    const ac = new AbortController();
    const doc = makeFakeDoc(3, () => {
      ac.abort(); // abort lands during getPage / before the next top-of-loop check
      return makeFakePage();
    });
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await expect(
      compressStrong(new Uint8Array([1]), STRONG, { signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("normalizes a RenderingCancelledException to AbortError", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    renderPageToBlobImpl = () =>
      Promise.reject(
        Object.assign(new Error("Rendering cancelled, page 1"), {
          name: "RenderingCancelledException",
        }),
      );
    await expect(compressStrong(new Uint8Array([1]), STRONG)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("throws over the post-unlock page cap", async () => {
    // 201 pages @150 exceeds the 200 cap.
    const doc = makeFakeDoc(201, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await expect(compressStrong(new Uint8Array([1]), STRONG)).rejects.toThrow(/Too many pages/);
  });

  it("copies the input bytes before getDocument (PIN 3 — detached buffer)", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    let receivedData: Uint8Array | undefined;
    getDocumentImpl = (params) => {
      receivedData = (params as { data: Uint8Array }).data;
      return makeFakeLoadingTask({ doc });
    };
    const input = new Uint8Array([1, 2, 3, 4]);
    await compressStrong(input, STRONG);
    expect(receivedData).not.toBe(input);
    expect(receivedData?.buffer).not.toBe(input.buffer);
    expect(Array.from(receivedData ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("destroys the loading task", async () => {
    const task = makeFakeLoadingTask({ doc: makeFakeDoc(1, () => makeFakePage()) });
    getDocumentImpl = () => task;
    await compressStrong(new Uint8Array([1]), STRONG);
    expect(task.destroy).toHaveBeenCalled();
  });

  it("maps a PasswordException by name to a friendly message", async () => {
    getDocumentImpl = () => makeFakeLoadingTask({ loadError: { name: "PasswordException" } });
    await expect(compressStrong(new Uint8Array([1]), STRONG)).rejects.toThrow(/password-protected/);
  });

  it("invokes onPassword and rasterizes once unlocked", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () =>
      makeFakeLoadingTask({ onPasswordReason: PasswordResponses.NEED_PASSWORD, doc });
    const onPassword = vi.fn(async () => "secret");
    const { pageCount } = await compressStrong(new Uint8Array([1]), STRONG, { onPassword });
    expect(onPassword).toHaveBeenCalledWith("need");
    expect(pageCount).toBe(1);
  });
});

// ── compressPdf dispatcher + regression guard ───────────────────────────────

describe("compressPdf regression guard", () => {
  it("keeps the original when the produced PDF is NOT smaller (keptOriginal)", async () => {
    // A tiny opaque input — the rasterized PDF (~1KB) is larger, so the guard fires.
    const input = new Uint8Array(50);
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    const r = await compressPdf(input, "strong", STRONG);
    expect(r.keptOriginal).toBe(true);
    expect(r.bytes).toBe(input);
    expect(r.ratio).toBe(0);
    expect(r.outputSize).toBe(50);
    expect(r.inputSize).toBe(50);
    expect(r.rasterized).toBe(true);
  });

  it("reports a real ratio when the produced PDF IS smaller", async () => {
    // A large opaque input — the rasterized PDF is far smaller, so the guard skips.
    const input = new Uint8Array(100_000);
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    const r = await compressPdf(input, "strong", STRONG);
    expect(r.keptOriginal).toBe(false);
    expect(r.bytes).not.toBe(input);
    expect(r.outputSize).toBeLessThan(100_000);
    expect(r.ratio).toBeCloseTo(1 - r.outputSize / 100_000, 5);
    expect(r.ratio).toBeGreaterThan(0);
  });

  it("carries lossless metadata through (rasterized:false, clampedPages:0)", async () => {
    // A real multi-page PDF with bloated metadata compresses losslessly.
    const src = await PDFDocument.create();
    for (let i = 0; i < 5; i++) src.addPage([612, 792]);
    src.setProducer("x".repeat(5000));
    const input = await src.save();
    const r = await compressPdf(input, "lossless", STRONG);
    expect(r.mode).toBe("lossless");
    expect(r.rasterized).toBe(false);
    expect(r.clampedPages).toBe(0);
    expect(r.pageCount).toBe(5);
  });
});

// ── buildCompressedFilename ─────────────────────────────────────────────────

describe("buildCompressedFilename", () => {
  it("sanitizes and appends -compressed.pdf", () => {
    expect(buildCompressedFilename("My Report.pdf")).toBe("My-Report-compressed.pdf");
    expect(buildCompressedFilename("a/b*c.pdf")).toBe("a-b-c-compressed.pdf");
  });

  it("falls back to 'document' when nothing survives", () => {
    expect(buildCompressedFilename("---.pdf")).toBe("document-compressed.pdf");
    expect(buildCompressedFilename(".pdf")).toBe("document-compressed.pdf");
  });
});

// ── formatBytes ──────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("renders B / KB / MB across the boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2150)).toBe("2.1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.1 * 1024 * 1024)).toBe("2.1 MB");
  });
});
