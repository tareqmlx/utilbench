import { setupImageMock, setupURLMock } from "@/test/canvas-mock";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConvertOptions,
  PT_PER_PX,
  buildPdfFilename,
  classifyImageFormat,
  computeImageLayout,
  imagesToPdf,
  prepareImageBytes,
  readImageMeta,
  resolvePageSize,
  sniffRasterFormat,
  validateImageFile,
} from "../converter";

// ── Real, verified byte fixtures (the canvas mock can't emit embeddable bytes) ──

// 1×1 baseline JPEG (verified to embed via PDFDocument.embedJpg).
const JPEG_1x1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xf7, 0xfa, 0x28, 0xa2, 0x8a, 0x00, 0xff, 0xd9,
]);

// 1×1 8-bit RGBA PNG (verified to embed via PDFDocument.embedPng).
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Magic-byte prefixes for sniff-gating (real file content is decoded by the Image mock).
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const WEBP_SIG = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const GIF_SIG = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00];

function makeFile(name: string, type: string, magic: number[], size?: number): File {
  // Pad to the requested size (or keep the magic bytes as the whole body).
  const len = size ?? magic.length;
  const body = new Uint8Array(len);
  body.set(magic.slice(0, len));
  return new File([body], name, { type });
}

const defaultOpts: ConvertOptions = {
  pageSize: "A4",
  orientation: "auto",
  margin: 0,
  fit: "fit",
  jpegQuality: 0.95,
};

// ── computeImageLayout (geometry — highest risk) ──

describe("computeImageLayout", () => {
  // Portrait page, landscape image so axis bugs surface.
  const page: [number, number] = [400, 800]; // portrait
  const landscapeImg = { width: 200, height: 100 }; // aspect 2:1
  const portraitImg = { width: 100, height: 200 }; // aspect 1:2

  it("fit (contain): preserves aspect, fits inside, centered", () => {
    const r = computeImageLayout(landscapeImg, page, 0, "fit");
    expect(r).not.toBeNull();
    if (!r) return;
    // aspect preserved
    expect(r.width / r.height).toBeCloseTo(landscapeImg.width / landscapeImg.height, 5);
    // contained: never exceeds the box, and one dim hits the box
    expect(r.width).toBeLessThanOrEqual(400 + 1e-6);
    expect(r.height).toBeLessThanOrEqual(800 + 1e-6);
    // landscape image on portrait page → width is the binding constraint
    expect(r.width).toBeCloseTo(400, 5);
    expect(r.height).toBeCloseTo(200, 5);
    // centered: x collapses to 0, y is centered in the 800-tall box
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo((800 - 200) / 2, 5);
  });

  it("fill (cover): covers the box, centered, symmetric overflow", () => {
    const r = computeImageLayout(landscapeImg, page, 0, "fill");
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.width / r.height).toBeCloseTo(landscapeImg.width / landscapeImg.height, 5);
    // cover: both dims ≥ box, at least one == box
    expect(r.width).toBeGreaterThanOrEqual(400 - 1e-6);
    expect(r.height).toBeGreaterThanOrEqual(800 - 1e-6);
    // height is the binding cover constraint here → height == 800, width overflows
    expect(r.height).toBeCloseTo(800, 5);
    expect(r.width).toBeCloseTo(1600, 5);
    // centered with symmetric (negative) overflow
    expect(r.x).toBeCloseTo((400 - 1600) / 2, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it("stretch: rect equals the content box exactly", () => {
    const r = computeImageLayout(landscapeImg, page, 0, "stretch");
    expect(r).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });

  it("actual: rect equals iw·PT_PER_PX × ih·PT_PER_PX, centered", () => {
    const r = computeImageLayout(landscapeImg, page, 0, "actual");
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.width).toBeCloseTo(200 * PT_PER_PX, 5);
    expect(r.height).toBeCloseTo(100 * PT_PER_PX, 5);
    expect(r.x).toBeCloseTo((400 - 200 * PT_PER_PX) / 2, 5);
    expect(r.y).toBeCloseTo((800 - 100 * PT_PER_PX) / 2, 5);
  });

  it("margin > 0 with non-matching aspect on BOTH axes: x and y center independently", () => {
    // Portrait image on a portrait page with a different aspect → after fit,
    // height binds (dh == ch) so y collapses to margin, and width < cw so x > margin.
    const margin = 50;
    const r = computeImageLayout(portraitImg, page, margin, "fit");
    expect(r).not.toBeNull();
    if (!r) return;
    const cw = 400 - 2 * margin; // 300
    const ch = 800 - 2 * margin; // 700
    const s = Math.min(cw / 100, ch / 200); // min(3, 3.5) = 3
    const dw = 100 * s; // 300
    const dh = 200 * s; // 600
    expect(r.width).toBeCloseTo(dw, 5);
    expect(r.height).toBeCloseTo(dh, 5);
    // x: width binds (dw == cw) → x collapses to margin
    expect(r.x).toBeCloseTo(margin, 5);
    // y: height does not fill the box → strictly greater than margin
    expect(r.y).toBeCloseTo(margin + (ch - dh) / 2, 5);
    expect(r.y).toBeGreaterThan(margin);
  });

  it("degenerate margin (≥ ½ a page dim) → null", () => {
    expect(computeImageLayout(landscapeImg, page, 200, "fit")).toBeNull(); // 400 - 400 = 0
    expect(computeImageLayout(landscapeImg, page, 250, "fit")).toBeNull(); // negative
  });

  it("0×0 image → null", () => {
    expect(computeImageLayout({ width: 0, height: 0 }, page, 0, "fit")).toBeNull();
    expect(computeImageLayout({ width: 100, height: 0 }, page, 0, "fit")).toBeNull();
  });
});

// ── resolvePageSize ──

describe("resolvePageSize", () => {
  const square = { width: 100, height: 100 };

  it("match → image dims × PT_PER_PX (orientation ignored)", () => {
    const img = { width: 640, height: 480 };
    const r = resolvePageSize({ ...defaultOpts, pageSize: "match", orientation: "portrait" }, img);
    expect(r[0]).toBeCloseTo(640 * PT_PER_PX, 5);
    expect(r[1]).toBeCloseTo(480 * PT_PER_PX, 5);
  });

  it("each preset key resolves to its fixed size (auto + square keeps native)", () => {
    // square image, auto → portrait branch (h >= w), so presets stay portrait (W <= H).
    expect(resolvePageSize({ ...defaultOpts, pageSize: "A4" }, square)).toEqual([595.28, 841.89]);
    expect(resolvePageSize({ ...defaultOpts, pageSize: "Letter" }, square)).toEqual([612, 792]);
    expect(resolvePageSize({ ...defaultOpts, pageSize: "Legal" }, square)).toEqual([612, 1008]);
    expect(resolvePageSize({ ...defaultOpts, pageSize: "A3" }, square)).toEqual([841.89, 1190.55]);
    expect(resolvePageSize({ ...defaultOpts, pageSize: "A5" }, square)).toEqual([419.53, 595.28]);
  });

  it("auto: landscape input → landscape page (W ≥ H); portrait input → portrait page", () => {
    const land = resolvePageSize(
      { ...defaultOpts, pageSize: "A4", orientation: "auto" },
      { width: 200, height: 100 },
    );
    expect(land[0]).toBeGreaterThan(land[1]); // swapped to landscape
    expect(land).toEqual([841.89, 595.28]);

    const port = resolvePageSize(
      { ...defaultOpts, pageSize: "A4", orientation: "auto" },
      { width: 100, height: 200 },
    );
    expect(port[0]).toBeLessThan(port[1]); // stays portrait
    expect(port).toEqual([595.28, 841.89]);
  });

  it("portrait forces W ≤ H; landscape forces W ≥ H (regardless of image)", () => {
    const port = resolvePageSize(
      { ...defaultOpts, pageSize: "A4", orientation: "portrait" },
      { width: 200, height: 100 },
    );
    expect(port).toEqual([595.28, 841.89]); // W ≤ H

    const land = resolvePageSize(
      { ...defaultOpts, pageSize: "A4", orientation: "landscape" },
      { width: 100, height: 200 },
    );
    expect(land).toEqual([841.89, 595.28]); // W ≥ H (swapped)
  });
});

// ── classifyImageFormat / sniffRasterFormat ──

describe("classifyImageFormat", () => {
  it("maps standard + non-standard MIME types", () => {
    expect(classifyImageFormat(new File([], "a.png", { type: "image/png" }))).toBe("png");
    expect(classifyImageFormat(new File([], "a.jpg", { type: "image/jpeg" }))).toBe("jpeg");
    expect(classifyImageFormat(new File([], "a.jpg", { type: "image/jpg" }))).toBe("jpeg");
    expect(classifyImageFormat(new File([], "a.webp", { type: "image/webp" }))).toBe("webp");
  });

  it("falls back to extension for empty / octet-stream MIME", () => {
    expect(classifyImageFormat(new File([], "a.png", { type: "" }))).toBe("png");
    expect(classifyImageFormat(new File([], "a.JPEG", { type: "" }))).toBe("jpeg");
    expect(classifyImageFormat(new File([], "a.webp", { type: "application/octet-stream" }))).toBe(
      "webp",
    );
  });

  it("rejects unsupported MIME and unknown extensions", () => {
    expect(classifyImageFormat(new File([], "a.gif", { type: "image/gif" }))).toBeNull();
    expect(classifyImageFormat(new File([], "a.svg", { type: "image/svg+xml" }))).toBeNull();
    expect(classifyImageFormat(new File([], "a.gif", { type: "" }))).toBeNull();
  });
});

describe("sniffRasterFormat", () => {
  it("detects png/jpeg/webp from magic bytes", () => {
    expect(sniffRasterFormat(new Uint8Array(PNG_SIG))).toBe("png");
    expect(sniffRasterFormat(new Uint8Array(JPEG_SIG))).toBe("jpeg");
    expect(sniffRasterFormat(new Uint8Array(WEBP_SIG))).toBe("webp");
  });

  it("returns null for GIF and garbage", () => {
    expect(sniffRasterFormat(new Uint8Array(GIF_SIG))).toBeNull();
    expect(sniffRasterFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    expect(sniffRasterFormat(new Uint8Array([]))).toBeNull();
  });
});

// ── validateImageFile ──

describe("validateImageFile", () => {
  it("accepts supported types", () => {
    expect(validateImageFile(makeFile("a.png", "image/png", PNG_SIG)).valid).toBe(true);
    expect(validateImageFile(makeFile("a.jpg", "image/jpeg", JPEG_SIG)).valid).toBe(true);
    expect(validateImageFile(makeFile("a.webp", "image/webp", WEBP_SIG)).valid).toBe(true);
  });

  it("accepts image/jpg and extension fallback for empty MIME", () => {
    expect(validateImageFile(makeFile("a.jpg", "image/jpg", JPEG_SIG)).valid).toBe(true);
    expect(validateImageFile(makeFile("a.png", "", PNG_SIG)).valid).toBe(true);
  });

  it("rejects bad types", () => {
    const r = validateImageFile(makeFile("a.gif", "image/gif", GIF_SIG));
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("rejects 0-byte files", () => {
    const r = validateImageFile(new File([], "a.png", { type: "image/png" }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Empty");
  });

  it("rejects files over MAX_IMAGE_SIZE", () => {
    const big = makeFile("a.png", "image/png", PNG_SIG, 51 * 1024 * 1024);
    const r = validateImageFile(big);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("too large");
  });

  it("warns (but accepts) files over WARN_IMAGE_SIZE", () => {
    const warn = makeFile("a.png", "image/png", PNG_SIG, 26 * 1024 * 1024);
    const r = validateImageFile(warn);
    expect(r.valid).toBe(true);
    expect(r.warning).toBeTruthy();
  });
});

// ── buildPdfFilename ──

describe("buildPdfFilename", () => {
  it("derives a sanitized base + .pdf from the first image", () => {
    expect(buildPdfFilename([{ name: "My Photo (1).jpg" }])).toBe("My-Photo-1.pdf");
    expect(buildPdfFilename([{ name: "scan_001.png" }])).toBe("scan_001.pdf");
  });

  it("falls back to images.pdf for non-ASCII / empty bases", () => {
    expect(buildPdfFilename([{ name: "照片.jpg" }])).toBe("images.pdf");
    expect(buildPdfFilename([{ name: "---.png" }])).toBe("images.pdf");
    expect(buildPdfFilename([])).toBe("images.pdf");
  });
});

// ── prepareImageBytes (real pipeline; canvas mock overridden to emit real bytes) ──

/**
 * Override document.createElement so the canvas `toBlob` emits genuine,
 * embeddable bytes keyed off the requested type. Mirrors the canvas-mock
 * approach (image-resizer/resizer.test.ts) but returns parseable bytes.
 */
function setupRealBytesCanvas() {
  const realCreateElement = document.createElement.bind(document);
  const ctx = { drawImage: vi.fn() };
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreateElement(tag);
    if (tag === "canvas") {
      (el as unknown as Record<string, unknown>).getContext = vi.fn(() => ctx);
      (el as unknown as Record<string, unknown>).toBlob = vi.fn(
        (cb: BlobCallback, type?: string) => {
          const bytes = type === "image/jpeg" ? JPEG_1x1 : PNG_1x1;
          cb(new Blob([bytes], { type: type ?? "image/png" }));
        },
      );
    }
    return el;
  }) as typeof document.createElement);
  return { ctx };
}

describe("prepareImageBytes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("JPEG bytes → type image/jpeg, dims from the decoded image", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 120, height: 80 });
    setupURLMock();
    const out = await prepareImageBytes(makeFile("a.jpg", "image/jpeg", JPEG_SIG));
    expect(out.type).toBe("image/jpeg");
    expect(out.width).toBe(120);
    expect(out.height).toBe(80);
    expect(out.downscaled).toBe(false);
  });

  it("PNG bytes → type image/png", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 64, height: 64 });
    setupURLMock();
    const out = await prepareImageBytes(makeFile("a.png", "image/png", PNG_SIG));
    expect(out.type).toBe("image/png");
  });

  it("WebP bytes → transcoded to image/png", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 64, height: 64 });
    setupURLMock();
    const out = await prepareImageBytes(makeFile("a.webp", "image/webp", WEBP_SIG));
    expect(out.type).toBe("image/png");
  });

  it("image/jpg MIME + JPEG bytes → image/jpeg (uses sniffed format)", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    const out = await prepareImageBytes(makeFile("a.jpg", "image/jpg", JPEG_SIG));
    expect(out.type).toBe("image/jpeg");
  });

  it("oversize dims (> caps) → downscaled true + reduced dims preserving aspect", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 16384, height: 8192 }); // side and area both over cap
    setupURLMock();
    const out = await prepareImageBytes(makeFile("a.png", "image/png", PNG_SIG));
    expect(out.downscaled).toBe(true);
    expect(out.width).toBeLessThanOrEqual(8192);
    expect(out.height).toBeLessThanOrEqual(8192);
    expect(out.width * out.height).toBeLessThanOrEqual(16_777_216);
    // aspect roughly preserved (2:1)
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });

  it("decode failure → throws", async () => {
    setupRealBytesCanvas();
    setupImageMock({ fail: true });
    setupURLMock();
    await expect(prepareImageBytes(makeFile("a.png", "image/png", PNG_SIG))).rejects.toThrow();
  });

  it("mislabeled file (PNG name, GIF bytes) → throws (sniff gate)", async () => {
    setupRealBytesCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    await expect(prepareImageBytes(makeFile("a.png", "image/png", GIF_SIG))).rejects.toThrow(
      /Unsupported/,
    );
  });
});

// ── readImageMeta (light upload path) ──

describe("readImageMeta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns sniffed format + oriented dims; no canvas toBlob", async () => {
    const toBlob = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "canvas") {
        (el as unknown as Record<string, unknown>).toBlob = toBlob;
      }
      return el;
    }) as typeof document.createElement);
    setupImageMock({ width: 300, height: 200 });
    setupURLMock();

    const meta = await readImageMeta(makeFile("a.png", "image/png", PNG_SIG));
    expect(meta).toEqual({ format: "png", width: 300, height: 200 });
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("format comes from bytes even with empty MIME (JPEG)", async () => {
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    const meta = await readImageMeta(makeFile("a.jpg", "", JPEG_SIG));
    expect(meta.format).toBe("jpeg");
  });

  it("rejects mislabeled bytes (GIF-as-PNG)", async () => {
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    await expect(readImageMeta(makeFile("a.png", "image/png", GIF_SIG))).rejects.toThrow(
      /Unsupported/,
    );
  });
});

// ── imagesToPdf (real prepare pipeline via overridden canvas) ──

describe("imagesToPdf", () => {
  beforeEach(() => {
    setupRealBytesCanvas();
    setupURLMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("empty input throws", async () => {
    setupImageMock({ width: 10, height: 10 });
    await expect(imagesToPdf([], defaultOpts)).rejects.toThrow("No images to convert.");
  });

  it("produces a loadable PDF with one page per image (JPEG path)", async () => {
    setupImageMock({ width: 100, height: 100 });
    const files = [
      { name: "a.jpg", file: makeFile("a.jpg", "image/jpeg", JPEG_SIG) },
      { name: "b.jpg", file: makeFile("b.jpg", "image/jpeg", JPEG_SIG) },
    ];
    const { bytes, downscaledNames } = await imagesToPdf(files, defaultOpts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(downscaledNames).toEqual([]);
    // Creator is normalized to empty; pdf-lib always re-stamps its own Producer
    // on save() (the setProducer("") is overwritten), so only Creator is assertable.
    expect(doc.getCreator()).toBe("");
  });

  it("PNG path also produces a loadable PDF", async () => {
    setupImageMock({ width: 50, height: 50 });
    const files = [{ name: "a.png", file: makeFile("a.png", "image/png", PNG_SIG) }];
    const { bytes } = await imagesToPdf(files, defaultOpts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("per-page size matches resolvePageSize", async () => {
    setupImageMock({ width: 200, height: 100 }); // landscape image
    const opts: ConvertOptions = { ...defaultOpts, pageSize: "A4", orientation: "auto" };
    const files = [{ name: "a.jpg", file: makeFile("a.jpg", "image/jpeg", JPEG_SIG) }];
    const { bytes } = await imagesToPdf(files, opts);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const expected = resolvePageSize(opts, { width: 200, height: 100 });
    expect(page.getWidth()).toBeCloseTo(expected[0], 2);
    expect(page.getHeight()).toBeCloseTo(expected[1], 2);
  });

  it("match page size yields per-image page dims", async () => {
    setupImageMock({ width: 320, height: 240 });
    const opts: ConvertOptions = { ...defaultOpts, pageSize: "match" };
    const files = [{ name: "a.png", file: makeFile("a.png", "image/png", PNG_SIG) }];
    const { bytes } = await imagesToPdf(files, opts);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(320 * PT_PER_PX, 2);
    expect(page.getHeight()).toBeCloseTo(240 * PT_PER_PX, 2);
  });

  it("calls onProgress once per page, in order", async () => {
    setupImageMock({ width: 100, height: 100 });
    const onProgress = vi.fn();
    const files = [
      { name: "a.jpg", file: makeFile("a.jpg", "image/jpeg", JPEG_SIG) },
      { name: "b.jpg", file: makeFile("b.jpg", "image/jpeg", JPEG_SIG) },
      { name: "c.jpg", file: makeFile("c.jpg", "image/jpeg", JPEG_SIG) },
    ];
    await imagesToPdf(files, defaultOpts, { onProgress });
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("populates downscaledNames when a prepared image is downscaled", async () => {
    setupImageMock({ width: 16384, height: 16384 }); // over both caps
    const files = [{ name: "big.png", file: makeFile("big.png", "image/png", PNG_SIG) }];
    const { downscaledNames } = await imagesToPdf(files, { ...defaultOpts, pageSize: "match" }, {});
    expect(downscaledNames).toEqual(["big.png"]);
  });

  it("throws a named error when a margin is too large", async () => {
    setupImageMock({ width: 100, height: 100 });
    const opts: ConvertOptions = { ...defaultOpts, pageSize: "A5", margin: 1000 };
    const files = [{ name: "a.jpg", file: makeFile("a.jpg", "image/jpeg", JPEG_SIG) }];
    await expect(imagesToPdf(files, opts)).rejects.toThrow(/Margin is too large for "a\.jpg"/);
  });

  it("wraps prepare failures with the offending file name", async () => {
    setupImageMock({ fail: true });
    const files = [{ name: "bad.png", file: makeFile("bad.png", "image/png", PNG_SIG) }];
    await expect(imagesToPdf(files, defaultOpts)).rejects.toThrow(/Could not process "bad\.png"/);
  });
});
