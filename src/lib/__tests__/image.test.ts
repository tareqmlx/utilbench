import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIM,
  clampToCanvasLimits,
  classifyImageFormat,
  normalizeFormat,
  readImageDims,
  sniffImageMeta,
  validateImageFile,
} from "../image";

describe("clampToCanvasLimits", () => {
  it("returns dims unchanged when within both caps", () => {
    const r = clampToCanvasLimits(1024, 768);
    expect(r).toEqual({ width: 1024, height: 768, downscaled: false });
  });

  it("leaves a dimension exactly at MAX_CANVAS_DIM untouched", () => {
    const r = clampToCanvasLimits(MAX_CANVAS_DIM, 1);
    expect(r).toEqual({ width: MAX_CANVAS_DIM, height: 1, downscaled: false });
  });

  it("downscales when one side exceeds MAX_CANVAS_DIM, preserving aspect", () => {
    const w = MAX_CANVAS_DIM * 2; // 16384
    const h = 1000;
    const r = clampToCanvasLimits(w, h);
    expect(r.downscaled).toBe(true);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    // aspect ratio preserved within rounding tolerance
    expect(r.width / r.height).toBeCloseTo(w / h, 1);
    // side-cap dominated: scale by 2 → 8192 × 500
    expect(r.width).toBe(MAX_CANVAS_DIM);
    expect(r.height).toBe(500);
  });

  it("area-cap regression: 9000×3000 stays within BOTH caps via floor (not round)", () => {
    // 9000×3000 = 27,000,000 px² > MAX_CANVAS_AREA. Rounding each side up
    // independently yields 7094×2365 = 16,777,310 > 16,777,216. Floor must win.
    const r = clampToCanvasLimits(9000, 3000);
    expect(r.downscaled).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width / r.height).toBeCloseTo(9000 / 3000, 1);
    // floored result: 7094 × 2364 = 16,770,216 ≤ cap (height floored down from
    // the 2365 that rounding would have produced, which is what kept it under).
    expect(r.width).toBe(7094);
    expect(r.height).toBe(2364);
  });

  it("downscales a huge square input by area", () => {
    const r = clampToCanvasLimits(5000, 5000); // 25 MP > area cap
    expect(r.downscaled).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
    expect(r.width).toBe(r.height); // square stays square (with floor)
  });

  it("leaves a tiny 1×1 input unchanged", () => {
    const r = clampToCanvasLimits(1, 1);
    expect(r).toEqual({ width: 1, height: 1, downscaled: false });
  });
});

// ── Byte-fixture builders (hand-authored headers — just enough for the parsers) ──

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Build a PNG chunk: [len(4 be)][type(4)][zero data][zero crc(4)]. */
function pngChunk(type: string, dataLen: number): number[] {
  return [...u32be(dataLen), ...ascii(type), ...new Array(dataLen).fill(0), 0, 0, 0, 0];
}

/** PNG header through IHDR (24 bytes) with the given dims. */
function makePng(width: number, height: number): Uint8Array {
  return new Uint8Array([
    ...PNG_SIG,
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(width),
    ...u32be(height),
  ]);
}

/** A minimal baseline JPEG (SOF0) with optional EXIF orientation in an APP1 segment. */
function makeJpeg(width: number, height: number, orientation?: number): Uint8Array {
  const sof = [
    0xff,
    0xc0, // SOF0
    0x00,
    0x0b, // segment length = 11
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01, // 1 component
    0x00,
    0x00,
    0x00,
  ];
  let app1: number[] = [];
  if (orientation !== undefined) {
    // "Exif\0\0" + little-endian TIFF with a single IFD entry (tag 0x0112).
    const tiff = [
      ...ascii("II"),
      0x2a,
      0x00, // 0x002A (little-endian)
      0x08,
      0x00,
      0x00,
      0x00, // IFD offset = 8
      0x01,
      0x00, // entry count = 1
      0x12,
      0x01, // tag 0x0112 (orientation)
      0x03,
      0x00, // type SHORT
      0x01,
      0x00,
      0x00,
      0x00, // count 1
      orientation & 0xff,
      0x00,
      0x00,
      0x00, // value
      0x00,
      0x00,
      0x00,
      0x00, // next IFD = 0
    ];
    const data = [...ascii("Exif"), 0x00, 0x00, ...tiff];
    const segLen = data.length + 2;
    app1 = [0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, ...data];
  }
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
}

/** A VP8X (extended) WebP header with the given canvas dims; optionally animated. */
function makeWebpVp8x(width: number, height: number, animated = false): Uint8Array {
  const w1 = width - 1;
  const h1 = height - 1;
  return new Uint8Array([
    ...ascii("RIFF"),
    ...u32be(0), // file size (ignored by the parser)
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    0x0a,
    0x00,
    0x00,
    0x00, // chunk size = 10 (little-endian)
    animated ? 0x02 : 0x00, // flags (ANIM bit)
    0x00,
    0x00,
    0x00, // reserved
    w1 & 0xff,
    (w1 >> 8) & 0xff,
    (w1 >> 16) & 0xff,
    h1 & 0xff,
    (h1 >> 8) & 0xff,
    (h1 >> 16) & 0xff,
  ]);
}

/** Bare 12-byte RIFF/WEBP header (no sub-chunk) — the existing converter fixture shape. */
const WEBP_BARE = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);

/** ISOBMFF ftyp header with the given major brand. */
function makeAvif(brand: string): Uint8Array {
  return new Uint8Array([...u32be(brand.length + 8), ...ascii("ftyp"), ...ascii(brand)]);
}

const JPEG_SIG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF_SIG = new Uint8Array([0x47, 0x49, 0x46, 0x38]);

function makeFile(name: string, type: string, bytes: Uint8Array): File {
  // Copy into a fresh ArrayBuffer-backed view so the body is a valid BlobPart
  // (a generic Uint8Array<ArrayBufferLike> is not assignable to BlobPart).
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("normalizeFormat", () => {
  it("maps every jpeg spelling to jpeg (case-insensitive)", () => {
    for (const s of ["jpg", "jpeg", "JPG", "JPEG", "image/jpg", "image/jpeg", "IMAGE/JPEG"]) {
      expect(normalizeFormat(s)).toBe("jpeg");
    }
  });

  it("maps png/webp spellings", () => {
    expect(normalizeFormat("png")).toBe("png");
    expect(normalizeFormat("image/png")).toBe("png");
    expect(normalizeFormat("WebP")).toBe("webp");
    expect(normalizeFormat("image/webp")).toBe("webp");
  });

  it("maps every avif brand/spelling to avif", () => {
    for (const s of ["avif", "avis", "AVIF", "image/avif"]) {
      expect(normalizeFormat(s)).toBe("avif");
    }
  });

  it("returns null for unknown formats", () => {
    expect(normalizeFormat("gif")).toBeNull();
    expect(normalizeFormat("image/svg+xml")).toBeNull();
    expect(normalizeFormat("")).toBeNull();
  });
});

describe("sniffImageMeta", () => {
  it("detects formats via magic bytes", () => {
    expect(sniffImageMeta(makePng(1, 1)).format).toBe("png");
    expect(sniffImageMeta(JPEG_SIG).format).toBe("jpeg");
    expect(sniffImageMeta(makeWebpVp8x(1, 1)).format).toBe("webp");
    expect(sniffImageMeta(makeAvif("avif")).format).toBe("avif");
    expect(sniffImageMeta(makeAvif("mif1")).format).toBe("avif");
  });

  it("returns null for unrecognized bytes", () => {
    expect(sniffImageMeta(GIF_SIG).format).toBeNull();
    expect(sniffImageMeta(new Uint8Array([])).format).toBeNull();
  });

  it("flags animated WebP (VP8X ANIM bit) but not a still WebP", () => {
    expect(sniffImageMeta(makeWebpVp8x(4, 4, true)).animated).toBe(true);
    expect(sniffImageMeta(makeWebpVp8x(4, 4, false)).animated).toBe(false);
  });

  it("does not throw on bare/short headers (returns animated:false)", () => {
    expect(sniffImageMeta(WEBP_BARE)).toEqual({ format: "webp", animated: false });
    // PNG signature only (no chunks) must not crash the APNG scan.
    expect(sniffImageMeta(new Uint8Array(PNG_SIG))).toEqual({ format: "png", animated: false });
  });

  it("flags APNG (acTL chunk before IDAT) but not a plain PNG", () => {
    const apng = new Uint8Array([
      ...PNG_SIG,
      ...pngChunk("IHDR", 13),
      ...pngChunk("acTL", 8),
      ...pngChunk("IDAT", 0),
    ]);
    const plain = new Uint8Array([...PNG_SIG, ...pngChunk("IHDR", 13), ...pngChunk("IDAT", 0)]);
    expect(sniffImageMeta(apng).animated).toBe(true);
    expect(sniffImageMeta(plain).animated).toBe(false);
  });
});

describe("readImageDims", () => {
  it("reads PNG dims from IHDR", () => {
    expect(readImageDims(makePng(640, 480), "png")).toEqual({ width: 640, height: 480 });
  });

  it("reads JPEG dims from SOF0 (no orientation → no swap)", () => {
    expect(readImageDims(makeJpeg(100, 50), "jpeg")).toEqual({ width: 100, height: 50 });
  });

  it("swaps JPEG dims for EXIF orientation 6 and 8 (90°/270°)", () => {
    expect(readImageDims(makeJpeg(100, 50, 6), "jpeg")).toEqual({ width: 50, height: 100 });
    expect(readImageDims(makeJpeg(100, 50, 8), "jpeg")).toEqual({ width: 50, height: 100 });
  });

  it("does NOT swap JPEG dims for non-rotating orientations (1, 2)", () => {
    expect(readImageDims(makeJpeg(100, 50, 1), "jpeg")).toEqual({ width: 100, height: 50 });
    expect(readImageDims(makeJpeg(100, 50, 2), "jpeg")).toEqual({ width: 100, height: 50 });
  });

  it("reads WebP dims and treats them as non-oriented (contract §11.4 P2-8)", () => {
    // A landscape VP8X is reported landscape — WebP EXIF orientation is never applied.
    expect(readImageDims(makeWebpVp8x(300, 200), "webp")).toEqual({ width: 300, height: 200 });
  });
});

describe("classifyImageFormat", () => {
  it("recognizes AVIF by MIME and extension", () => {
    expect(classifyImageFormat(makeFile("a.avif", "image/avif", makeAvif("avif")))).toBe("avif");
    expect(classifyImageFormat(makeFile("a.avif", "", makeAvif("avif")))).toBe("avif");
  });
});

describe("validateImageFile — accept gate (recognition ≠ acceptance)", () => {
  it("rejects a recognized AVIF when accept excludes avif", () => {
    const file = makeFile("a.avif", "image/avif", makeAvif("avif"));
    const r = validateImageFile(file, ["png", "jpeg", "webp"]);
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("accepts the same AVIF when accept includes avif", () => {
    const file = makeFile("a.avif", "image/avif", makeAvif("avif"));
    expect(validateImageFile(file, ["png", "jpeg", "webp", "avif"]).valid).toBe(true);
  });
});
