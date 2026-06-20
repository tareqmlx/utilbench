import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The renderer imports the pdf.js worker via a `?url` query that Vitest cannot
// resolve, and imports the pdf.js engine itself — mock both at module scope.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-url" }));

// ── Fake pdf.js lib (mutable per-test via the factory closures) ────────────

const AnnotationMode = { DISABLE: 1, ENABLE: 2 };
const PasswordResponses = { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };

let getDocumentImpl: (params: unknown) => unknown;
const GlobalWorkerOptions: { workerSrc: string } = { workerSrc: "" };

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions,
  AnnotationMode,
  PasswordResponses,
  getDocument: (params: unknown) => getDocumentImpl(params),
}));

import {
  type RenderOptions,
  type RenderedPage,
  buildBaseName,
  buildImageFilename,
  computeOutputDims,
  probePdf,
  renderPdfToImages,
  resolvePageList,
  zipImages,
} from "../renderer";

// ── pdf-lib mock for probePdf ──────────────────────────────────────────────

let pdfLibPages: Array<{ w: number; h: number; rot: number }>;
let pdfLibEncrypted: boolean;

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: vi.fn(async () => ({
      getPageCount: () => pdfLibPages.length,
      isEncrypted: pdfLibEncrypted,
      getPages: () =>
        pdfLibPages.map((p) => ({
          getSize: () => ({ width: p.w, height: p.h }),
          getRotation: () => ({ angle: p.rot }),
        })),
    })),
  },
}));

// ── Canvas mock that records toBlob(type, quality) per call ────────────────

interface CanvasCall {
  type?: string;
  quality?: number;
  width: number;
  height: number;
}

let canvasCalls: CanvasCall[];
const realCreateElement = document.createElement.bind(document);

function setupRecordingCanvasMock() {
  canvasCalls = [];
  vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const el = realCreateElement(tagName, options);
    if (tagName === "canvas") {
      const canvas = el as HTMLCanvasElement;
      (el as unknown as Record<string, unknown>).getContext = vi.fn(() => ({
        fillStyle: "",
        fillRect: vi.fn(),
      }));
      (el as unknown as Record<string, unknown>).toBlob = vi.fn(
        (cb: BlobCallback, type?: string, quality?: number) => {
          canvasCalls.push({ type, quality, width: canvas.width, height: canvas.height });
          cb(new Blob([new Uint8Array([1, 2, 3])], { type: type ?? "image/png" }));
        },
      );
    }
    return el;
  }) as typeof document.createElement);
}

// ── Fake document/page/loadingTask builders ────────────────────────────────

function makeFakePage(width = 612, height = 792, renderImpl?: () => Promise<void>) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: vi.fn((_params: unknown) => ({
      promise: renderImpl ? renderImpl() : Promise.resolve(),
      cancel: vi.fn(),
    })),
    cleanup: vi.fn(),
  };
}

function makeFakeDoc(numPages: number, getPage: (n: number) => unknown) {
  return { numPages, getPage: vi.fn((n: number) => Promise.resolve(getPage(n))) };
}

interface LoadingTaskOpts {
  doc?: unknown;
  loadError?: { name: string };
  onPasswordReason?: number; // fire onPassword with this reason during load
  passwordResolvesDoc?: unknown;
}

function makeFakeLoadingTask(opts: LoadingTaskOpts) {
  const destroy = vi.fn(() => Promise.resolve());
  const task: Record<string, unknown> = {
    onPassword: undefined,
    destroy,
  };
  task.promise = (async () => {
    // Yield so the renderer can assign loadingTask.onPassword before we read it.
    await Promise.resolve();
    if (opts.onPasswordReason !== undefined) {
      const onPassword = task.onPassword as
        | ((update: (pw: string) => void, reason: number) => void)
        | undefined;
      if (onPassword) {
        await new Promise<void>((resolve) => {
          onPassword((_pw: string) => resolve(), opts.onPasswordReason as number);
        });
      }
      return opts.passwordResolvesDoc ?? opts.doc;
    }
    if (opts.loadError) throw opts.loadError;
    return opts.doc;
  })();
  return task;
}

const baseOpts: RenderOptions = {
  dpi: 150,
  format: "png",
  jpegQuality: 0.9,
  pageRange: "",
};

beforeEach(() => {
  getDocumentImpl = () => makeFakeLoadingTask({ doc: makeFakeDoc(1, () => makeFakePage()) });
  // NOTE: do NOT reset GlobalWorkerOptions.workerSrc — getPdfjs() memoizes the
  // pdf.js module after the first call and only assigns workerSrc on that first
  // (uncached) call, so the value persists for the whole suite.
  pdfLibPages = [{ w: 612, h: 792, rot: 0 }];
  pdfLibEncrypted = false;
  setupRecordingCanvasMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── computeOutputDims ──────────────────────────────────────────────────────

describe("computeOutputDims", () => {
  it("612×792 @72 → 612×792 (scale 1.0)", () => {
    const r = computeOutputDims(612, 792, 72);
    expect(r).toMatchObject({ width: 612, height: 792, effectiveDpi: 72, clamped: false });
  });

  it("612×792 @150 → 1275×1650", () => {
    const r = computeOutputDims(612, 792, 150);
    expect(r.width).toBe(1275);
    expect(r.height).toBe(1650);
    expect(r.clamped).toBe(false);
  });

  it("612×792 @300 → 2550×3300", () => {
    const r = computeOutputDims(612, 792, 300);
    expect(r.width).toBe(2550);
    expect(r.height).toBe(3300);
  });

  it("uses scale = dpi/72, NOT dpi/96 (regression guard)", () => {
    // /96 would give 612*96/72 = 816; /72 keeps it at 612.
    expect(computeOutputDims(612, 792, 72).width).toBe(612);
    expect(computeOutputDims(612, 792, 72).width).not.toBe(816);
  });

  it("clamps an oversized page by area, lowers effective DPI, preserves aspect", () => {
    // A huge page at 300 DPI blows past MAX_CANVAS_AREA.
    const r = computeOutputDims(2000, 3000, 300);
    expect(r.clamped).toBe(true);
    expect(r.effectiveDpi).toBeLessThan(300);
    expect(r.width * r.height).toBeLessThanOrEqual(16_777_216);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(8192);
    // aspect preserved within a pixel of rounding
    expect(Math.abs(r.width / r.height - 2000 / 3000)).toBeLessThan(0.01);
  });
});

// ── resolvePageList ────────────────────────────────────────────────────────

describe("resolvePageList", () => {
  it('"" / "all" / "ALL" → 1..N', () => {
    expect(resolvePageList("", 3)).toEqual([1, 2, 3]);
    expect(resolvePageList("all", 3)).toEqual([1, 2, 3]);
    expect(resolvePageList("ALL", 3)).toEqual([1, 2, 3]);
  });

  it('"1-3,5" → [1,2,3,5]', () => {
    expect(resolvePageList("1-3,5", 10)).toEqual([1, 2, 3, 5]);
  });

  it("dedupes and sorts", () => {
    expect(resolvePageList("5,1,1,2,2", 10)).toEqual([1, 2, 5]);
  });

  it('open-ended "3-" expands to the end', () => {
    expect(resolvePageList("3-", 5)).toEqual([3, 4, 5]);
  });

  it("throws on out-of-bounds / parse error", () => {
    expect(() => resolvePageList("99", 5)).toThrow();
    expect(() => resolvePageList("abc", 5)).toThrow();
  });

  it("throws when the result would be empty", () => {
    // A stray comma yields no ranges → parsePageRanges errors → throw.
    expect(() => resolvePageList(",", 5)).toThrow();
  });
});

// ── probePdf ───────────────────────────────────────────────────────────────

describe("probePdf", () => {
  it("returns pageCount, encrypted, and MediaBox sizes for unrotated pages", async () => {
    pdfLibPages = [
      { w: 612, h: 792, rot: 0 },
      { w: 595, h: 842, rot: 180 },
    ];
    pdfLibEncrypted = true;
    const r = await probePdf(new Uint8Array([1]));
    expect(r.pageCount).toBe(2);
    expect(r.encrypted).toBe(true);
    expect(r.pageSizes).toEqual([
      { width: 612, height: 792 },
      { width: 595, height: 842 }, // 180° unchanged
    ]);
  });

  it("swaps w/h for 90° and 270° pages (matches pdf.js viewport)", async () => {
    pdfLibPages = [
      { w: 612, h: 792, rot: 90 },
      { w: 612, h: 792, rot: 270 },
      { w: 612, h: 792, rot: -90 }, // normalizes to 270
    ];
    const r = await probePdf(new Uint8Array([1]));
    expect(r.pageSizes).toEqual([
      { width: 792, height: 612 },
      { width: 792, height: 612 },
      { width: 792, height: 612 },
    ]);
  });
});

// ── buildImageFilename ─────────────────────────────────────────────────────

describe("buildImageFilename", () => {
  it("zero-pads to the given width", () => {
    expect(buildImageFilename("report", 9, 2, "png")).toBe("report-page-09.png");
    expect(buildImageFilename("report", 10, 2, "png")).toBe("report-page-10.png");
    expect(buildImageFilename("report", 9, 1, "png")).toBe("report-page-9.png");
  });

  it("uses png/jpg extensions", () => {
    expect(buildImageFilename("a", 1, 1, "png")).toBe("a-page-1.png");
    expect(buildImageFilename("a", 1, 1, "jpeg")).toBe("a-page-1.jpg");
  });

  it("falls back to 'page' for an empty base", () => {
    expect(buildImageFilename("", 1, 1, "png")).toBe("page-page-1.png");
  });
});

// ── buildBaseName ──────────────────────────────────────────────────────────

describe("buildBaseName", () => {
  it("strips the extension and replaces spaces/illegal chars with dashes", () => {
    expect(buildBaseName("My Report.pdf")).toBe("My-Report");
    expect(buildBaseName("a/b*c.pdf")).toBe("a-b-c");
  });

  it("collapses consecutive dashes and trims edge dashes", () => {
    expect(buildBaseName("a  b.pdf")).toBe("a-b");
    expect(buildBaseName(" leading.pdf")).toBe("leading");
  });

  it("falls back to 'document' when nothing survives", () => {
    expect(buildBaseName("---.pdf")).toBe("document");
    expect(buildBaseName(".pdf")).toBe("document");
  });
});

// ── zipImages ──────────────────────────────────────────────────────────────

describe("zipImages", () => {
  it("produces a ZIP with the expected entry names and count", async () => {
    const pages: RenderedPage[] = [
      {
        pageNumber: 1,
        blob: new Blob([new Uint8Array([10, 11, 12])]),
        filename: "doc-page-1.png",
        width: 1,
        height: 1,
        clamped: false,
      },
      {
        pageNumber: 2,
        blob: new Blob([new Uint8Array([20, 21])]),
        filename: "doc-page-2.png",
        width: 1,
        height: 1,
        clamped: false,
      },
    ];
    const blob = await zipImages(pages, "doc-images.zip");
    expect(blob.type).toBe("application/zip");
    const buf = new Uint8Array(await blob.arrayBuffer());
    const unzipped = unzipSync(buf);
    expect(Object.keys(unzipped).sort()).toEqual(["doc-page-1.png", "doc-page-2.png"]);
    expect(Array.from(unzipped["doc-page-1.png"] ?? [])).toEqual([10, 11, 12]);
    expect(Array.from(unzipped["doc-page-2.png"] ?? [])).toEqual([20, 21]);
  });
});

// ── renderPdfToImages ──────────────────────────────────────────────────────

describe("renderPdfToImages", () => {
  it("renders N pages in order and returns the {pages, failures} shape", async () => {
    const doc = makeFakeDoc(3, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });

    const result = await renderPdfToImages(new Uint8Array([1, 2]), "My Report.pdf", baseOpts);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(result.failures).toEqual([]);
    expect(result.pages[0]?.filename).toBe("My-Report-page-1.png");
  });

  it("reports progress for each page", async () => {
    const doc = makeFakeDoc(2, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    const onProgress = vi.fn();
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it("forwards JPEG quality to toBlob and uses image/jpeg", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", {
      ...baseOpts,
      format: "jpeg",
      jpegQuality: 0.72,
    });
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0]?.type).toBe("image/jpeg");
    expect(canvasCalls[0]?.quality).toBe(0.72);
  });

  it("passes no quality for PNG", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts);
    expect(canvasCalls[0]?.type).toBe("image/png");
    expect(canvasCalls[0]?.quality).toBeUndefined();
  });

  it("passes annotationMode DISABLE to render", async () => {
    const page = makeFakePage();
    const doc = makeFakeDoc(1, () => page);
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts);
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({ annotationMode: AnnotationMode.DISABLE }),
    );
  });

  it("calls loadingTask.destroy()", async () => {
    const task = makeFakeLoadingTask({ doc: makeFakeDoc(1, () => makeFakePage()) });
    getDocumentImpl = () => task;
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts);
    expect(task.destroy).toHaveBeenCalled();
  });

  it("collects a single failing page and continues (collect-and-continue)", async () => {
    const doc = makeFakeDoc(3, (n) =>
      n === 2
        ? makeFakePage(612, 792, () => Promise.reject(new Error("boom on page 2")))
        : makeFakePage(),
    );
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    const result = await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 3]);
    expect(result.failures).toEqual([{ pageNumber: 2, message: "boom on page 2" }]);
  });

  it("throws when no page could be rendered (out.length === 0)", async () => {
    const doc = makeFakeDoc(1, () =>
      makeFakePage(612, 792, () => Promise.reject(new Error("always fails"))),
    );
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await expect(renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts)).rejects.toThrow(
      /No pages could be rendered/,
    );
  });

  it("throws when the page count exceeds the DPI-aware cap", async () => {
    // 200 pages @300 DPI exceeds the 150 cap.
    const doc = makeFakeDoc(200, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await expect(
      renderPdfToImages(new Uint8Array([1]), "f.pdf", { ...baseOpts, dpi: 300 }),
    ).rejects.toThrow(/Too many pages/);
  });

  it("maps a PasswordException by name to a friendly message", async () => {
    getDocumentImpl = () => makeFakeLoadingTask({ loadError: { name: "PasswordException" } });
    await expect(renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts)).rejects.toThrow(
      /password-protected/,
    );
  });

  it("maps an InvalidPDFException by name to a friendly message", async () => {
    getDocumentImpl = () => makeFakeLoadingTask({ loadError: { name: "InvalidPDFException" } });
    await expect(renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts)).rejects.toThrow(
      /not a valid PDF/,
    );
  });

  it("invokes the onPassword hook and renders once unlocked", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () =>
      makeFakeLoadingTask({
        onPasswordReason: PasswordResponses.NEED_PASSWORD,
        doc,
      });
    const onPassword = vi.fn(async () => "secret");
    const result = await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts, { onPassword });
    expect(onPassword).toHaveBeenCalledWith("need");
    expect(result.pages).toHaveLength(1);
  });

  it("reports 'incorrect' to the onPassword hook on a wrong password", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () =>
      makeFakeLoadingTask({
        onPasswordReason: PasswordResponses.INCORRECT_PASSWORD,
        doc,
      });
    const onPassword = vi.fn(async () => "retry");
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts, { onPassword });
    expect(onPassword).toHaveBeenCalledWith("incorrect");
  });

  it("slices the input bytes (detached-buffer copy) — getDocument gets a distinct buffer", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    let receivedData: Uint8Array | undefined;
    getDocumentImpl = (params) => {
      receivedData = (params as { data: Uint8Array }).data;
      return makeFakeLoadingTask({ doc });
    };
    const input = new Uint8Array([1, 2, 3, 4]);
    await renderPdfToImages(input, "f.pdf", baseOpts);
    expect(receivedData).toBeInstanceOf(Uint8Array);
    expect(receivedData).not.toBe(input); // a copy, not the same reference
    expect(Array.from(receivedData ?? [])).toEqual([1, 2, 3, 4]);
    expect(receivedData?.buffer).not.toBe(input.buffer);
  });

  it("sets GlobalWorkerOptions.workerSrc via getPdfjs", async () => {
    const doc = makeFakeDoc(1, () => makeFakePage());
    getDocumentImpl = () => makeFakeLoadingTask({ doc });
    await renderPdfToImages(new Uint8Array([1]), "f.pdf", baseOpts);
    expect(GlobalWorkerOptions.workerSrc).toBe("worker-url");
  });
});
