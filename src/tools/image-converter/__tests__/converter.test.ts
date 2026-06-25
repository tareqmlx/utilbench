import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupImageMock, setupURLMock } from "../../../test/canvas-mock";
import {
  type ConvertOptions,
  __resetProbeCache,
  buildOutputFilename,
  buildZipName,
  canDecodeAvif,
  canEncode,
  classifyByMimeOrExt,
  convertImage,
  createBatchZip,
  readImageMeta,
  sniffImageFormat,
  validateImageFile,
} from "../converter";

// fflate is dynamically imported inside createBatchZip; intercept that import reliably.
const { zipMock } = vi.hoisted(() => ({ zipMock: vi.fn() }));
vi.mock("fflate", () => ({ zip: zipMock }));

// ── Fixture helpers ──────────────────────────────────────────────────────────

function bytes(...vals: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(vals);
}

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

/**
 * Build a 32-byte ftyp box. boxSize is big-endian at bytes 0–3; "ftyp" at 4–7; major brand at 8–11;
 * minor_version 0 at 12–15; compatible brands from offset 16.
 */
function ftyp(major: string, compatibleBrands: string[]): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(32);
  const brands = compatibleBrands.flatMap((b) => ascii(b));
  const boxSize = 16 + brands.length;
  const view = new DataView(buf.buffer);
  view.setUint32(0, boxSize, false);
  buf.set(ascii("ftyp"), 4);
  buf.set(ascii(major), 8);
  // bytes 12–15 = minor_version (left 0).
  buf.set(brands, 16);
  return buf;
}

function fileFromBytes(data: Uint8Array<ArrayBuffer>, name: string, type = ""): File {
  return new File([data], name, { type });
}

function makeOpts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return { format: "png", quality: 0.92, bgColor: "#ffffff", ...partial };
}

/**
 * Local canvas mock with SHARED spies (the repo's setupCanvasMock attaches per-element instance
 * functions, which prototype spies can't see). Default toBlob mirrors the repo mock: it honors the
 * requested type so the step-7 blob.type backstop passes for normal jpeg/png/webp requests.
 */
function setupCanvas(over?: {
  toBlob?: (cb: BlobCallback, type?: string) => void;
  toDataURL?: (t?: string) => string;
}) {
  const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
  const toBlob = vi.fn(
    over?.toBlob ??
      ((cb: BlobCallback, type?: string) =>
        cb(new Blob([new Uint8Array(8)], { type: type ?? "image/png" }))),
  );
  const toDataURL = vi.fn(
    over?.toDataURL ?? ((t?: string) => `data:${t ?? "image/png"};base64,mock`),
  );
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = real(tag);
    if (tag === "canvas") Object.assign(el, { getContext: () => ctx, toBlob, toDataURL });
    return el;
  }) as typeof document.createElement);
  return { ctx, toBlob, toDataURL };
}

function pngFile(name = "a.png", type = "image/png"): File {
  const data = new Uint8Array(32);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new File([data], name, { type });
}

// ── sniffImageFormat ─────────────────────────────────────────────────────────

describe("sniffImageFormat", () => {
  it("detects PNG", () => {
    expect(sniffImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
  });

  it("detects JPEG", () => {
    expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
  });

  it("detects GIF", () => {
    expect(sniffImageFormat(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("gif");
  });

  it("detects BMP", () => {
    expect(sniffImageFormat(bytes(0x42, 0x4d, 0x00, 0x00))).toBe("bmp");
  });

  it("detects WebP (RIFF...WEBP)", () => {
    const data = new Uint8Array(16);
    data.set(ascii("RIFF"), 0);
    data.set(ascii("WEBP"), 8);
    expect(sniffImageFormat(data)).toBe("webp");
  });

  it("rejects RIFF without WEBP", () => {
    const data = new Uint8Array(16);
    data.set(ascii("RIFF"), 0);
    data.set(ascii("WAVE"), 8);
    expect(sniffImageFormat(data)).toBeNull();
  });

  it("detects AVIF with major brand avif", () => {
    expect(sniffImageFormat(ftyp("avif", ["mif1", "miaf"]))).toBe("avif");
  });

  it("detects AVIF with major mif1 and avif in compatible_brands (MIAF case)", () => {
    expect(sniffImageFormat(ftyp("mif1", ["avif", "miaf", "MA1A"]))).toBe("avif");
  });

  it("detects AVIF sequence brand avis", () => {
    expect(sniffImageFormat(ftyp("avis", ["msf1", "iso8"]))).toBe("avif");
  });

  it("rejects HEIC major brand even if avif present in compatible_brands", () => {
    expect(sniffImageFormat(ftyp("heic", ["avif", "mif1"]))).toBeNull();
  });

  it("rejects HEIC variants (heix/hevc/hevx)", () => {
    expect(sniffImageFormat(ftyp("heix", ["mif1"]))).toBeNull();
    expect(sniffImageFormat(ftyp("hevc", ["mif1"]))).toBeNull();
    expect(sniffImageFormat(ftyp("hevx", ["mif1"]))).toBeNull();
  });

  it("rejects generic HEIF (mif1 with no avif compatible brand)", () => {
    expect(sniffImageFormat(ftyp("mif1", ["miaf", "MA1B"]))).toBeNull();
  });

  it("does not read minor_version bytes (12–15) as a brand", () => {
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 16, false); // box covers only the major brand
    buf.set(ascii("ftyp"), 4);
    buf.set(ascii("mif1"), 8);
    buf.set(ascii("avif"), 12); // minor_version region + beyond boxSize
    expect(sniffImageFormat(buf)).toBeNull();
  });

  it("returns null for SVG / xml text", () => {
    expect(sniffImageFormat(new Uint8Array(ascii("<?xml version=")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(ascii("<svg xmlns=")))).toBeNull();
  });

  it("returns null for garbage and short input", () => {
    expect(sniffImageFormat(bytes(0x00, 0x01, 0x02))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
  });
});

// ── classifyByMimeOrExt ──────────────────────────────────────────────────────

describe("classifyByMimeOrExt", () => {
  it("maps standard MIME types", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.png", "image/png"))).toBe("png");
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.jpg", "image/jpeg"))).toBe("jpeg");
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.webp", "image/webp"))).toBe("webp");
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.gif", "image/gif"))).toBe("gif");
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.avif", "image/avif"))).toBe("avif");
  });

  it("maps non-standard image/jpg → jpeg", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.jpg", "image/jpg"))).toBe("jpeg");
  });

  it("maps image/x-ms-bmp → bmp", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.bmp", "image/x-ms-bmp"))).toBe("bmp");
  });

  it("maps image/bmp → bmp", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.bmp", "image/bmp"))).toBe("bmp");
  });

  it("falls back to extension on empty MIME", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "photo.PNG", ""))).toBe("png");
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "photo.jpeg", ""))).toBe("jpeg");
  });

  it("falls back to extension on application/octet-stream", () => {
    expect(
      classifyByMimeOrExt(fileFromBytes(bytes(), "photo.webp", "application/octet-stream")),
    ).toBe("webp");
  });

  it("returns null for unaccepted type/extension", () => {
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.heic", "image/heic"))).toBeNull();
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "noext", ""))).toBeNull();
    expect(classifyByMimeOrExt(fileFromBytes(bytes(), "a.svg", "image/svg+xml"))).toBeNull();
  });
});

// ── validateImageFile ────────────────────────────────────────────────────────

describe("validateImageFile", () => {
  it("accepts a valid PNG", () => {
    expect(validateImageFile(new File(["data"], "a.png", { type: "image/png" }))).toEqual({
      valid: true,
    });
  });

  it("accepts a file with empty MIME but valid extension", () => {
    expect(validateImageFile(new File(["data"], "a.png", { type: "" }))).toEqual({ valid: true });
  });

  it("rejects an unaccepted type", () => {
    const r = validateImageFile(new File(["data"], "a.heic", { type: "image/heic" }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Unsupported");
  });

  it("rejects a 0-byte file", () => {
    const r = validateImageFile(new File([], "a.png", { type: "image/png" }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("empty");
  });

  it("rejects a file over MAX_IMAGE_SIZE", () => {
    const f = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(f, "size", { value: 60 * 1024 * 1024 });
    const r = validateImageFile(f);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("too large");
  });

  it("warns over WARN_IMAGE_SIZE but stays valid", () => {
    const f = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(f, "size", { value: 30 * 1024 * 1024 });
    const r = validateImageFile(f);
    expect(r.valid).toBe(true);
    expect(r.warning).toBeTruthy();
  });
});

// ── canEncode ────────────────────────────────────────────────────────────────

describe("canEncode", () => {
  beforeEach(() => {
    __resetProbeCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for PNG/JPEG without touching the canvas", () => {
    const spy = vi.spyOn(document, "createElement");
    expect(canEncode("image/png")).toBe(true);
    expect(canEncode("image/jpeg")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reflects the mocked toDataURL result for webp (supported)", () => {
    setupCanvas();
    expect(canEncode("image/webp")).toBe(true);
  });

  it("returns false for webp when toDataURL falls back to png", () => {
    setupCanvas({ toDataURL: () => "data:image/png;base64,mock" });
    expect(canEncode("image/webp")).toBe(false);
  });

  it("caches the webp probe (second call does not re-probe)", () => {
    const { toDataURL } = setupCanvas();
    expect(canEncode("image/webp")).toBe(true);
    expect(canEncode("image/webp")).toBe(true);
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });
});

// ── canDecodeAvif ────────────────────────────────────────────────────────────

describe("canDecodeAvif", () => {
  beforeEach(() => {
    __resetProbeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves true when the probe <img> loads", async () => {
    setupImageMock({ width: 1, height: 1 });
    await expect(canDecodeAvif()).resolves.toBe(true);
  });

  it("resolves false when the probe <img> errors", async () => {
    setupImageMock({ fail: true });
    await expect(canDecodeAvif()).resolves.toBe(false);
  });

  it("memoizes the Promise (second call returns the same instance)", async () => {
    setupImageMock({ width: 1, height: 1 });
    const p1 = canDecodeAvif();
    const p2 = canDecodeAvif();
    expect(p1).toBe(p2);
    await p1;
  });
});

// ── convertImage ─────────────────────────────────────────────────────────────

describe("convertImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes the requested type and quality to toBlob (jpeg)", async () => {
    const { toBlob } = setupCanvas();
    setupImageMock({ width: 50, height: 40 });
    setupURLMock();

    const r = await convertImage(pngFile(), makeOpts({ format: "jpeg", quality: 0.8 }));
    expect(r.type).toBe("image/jpeg");
    expect(r.width).toBe(50);
    expect(r.height).toBe(40);
    expect(r.downscaled).toBe(false);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
  });

  it("passes undefined quality for PNG", async () => {
    const { toBlob } = setupCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();

    await convertImage(pngFile(), makeOpts({ format: "png" }));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
  });

  it("fills the background BEFORE drawImage for jpeg (alpha flatten)", async () => {
    const { ctx } = setupCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();

    await convertImage(pngFile(), makeOpts({ format: "jpeg", bgColor: "#abcdef" }));

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
    const fillOrder = ctx.fillRect.mock.invocationCallOrder[0] as number;
    const drawOrder = ctx.drawImage.mock.invocationCallOrder[0] as number;
    expect(fillOrder).toBeLessThan(drawOrder);
    expect(ctx.fillStyle).toBe("#abcdef");
  });

  it("does NOT fill the background for png output", async () => {
    const { ctx } = setupCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();

    await convertImage(pngFile(), makeOpts({ format: "png" }));
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("downscales sources exceeding canvas limits", async () => {
    setupCanvas();
    setupImageMock({ width: 20000, height: 20000 });
    setupURLMock();

    const r = await convertImage(pngFile(), makeOpts({ format: "png" }));
    expect(r.downscaled).toBe(true);
    expect(r.width).toBeLessThanOrEqual(8192);
    expect(r.height).toBeLessThanOrEqual(8192);
    expect(r.width * r.height).toBeLessThanOrEqual(16_777_216);
  });

  it("throws when the image fails to decode", async () => {
    setupCanvas();
    setupImageMock({ fail: true });
    setupURLMock();
    await expect(convertImage(pngFile(), makeOpts())).rejects.toThrow();
  });

  it("throws for a mislabeled file (PNG name, non-image/HEIC bytes)", async () => {
    setupCanvas();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    // HEIC ftyp bytes sniff to null (rejected) but the file claims to be a PNG.
    const heicData = ftyp("heic", ["mif1"]);
    const file = new File([heicData], "logo.png", { type: "image/png" });
    await expect(convertImage(file, makeOpts())).rejects.toThrow(/unrecognized|Unsupported/i);
  });

  it("throws when blob.type does not match the requested mime (silent-fallback backstop)", async () => {
    // toBlob ignores the requested type and always returns image/png.
    setupCanvas({ toBlob: (cb) => cb(new Blob([new Uint8Array(8)], { type: "image/png" })) });
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    await expect(convertImage(pngFile(), makeOpts({ format: "webp" }))).rejects.toThrow(
      /can't encode/i,
    );
  });

  it("throws when toBlob returns null", async () => {
    setupCanvas({ toBlob: (cb) => cb(null) });
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    await expect(convertImage(pngFile(), makeOpts())).rejects.toThrow(/encode/i);
  });
});

// ── buildOutputFilename / buildZipName ───────────────────────────────────────

describe("buildOutputFilename", () => {
  it("replaces the extension (case-insensitive source ext)", () => {
    expect(buildOutputFilename("shot.PNG", "jpeg")).toBe("shot.jpg");
    expect(buildOutputFilename("photo.webp", "png")).toBe("photo.png");
    expect(buildOutputFilename("a.gif", "webp")).toBe("a.webp");
  });

  it("appends an extension when the name has none", () => {
    expect(buildOutputFilename("photo", "png")).toBe("photo.png");
  });

  it("guards an empty base", () => {
    expect(buildOutputFilename(".png", "jpeg")).toBe("image.jpg");
  });
});

describe("buildZipName", () => {
  it("includes the count", () => {
    expect(buildZipName(3)).toBe("images-converted-3.zip");
  });
});

// ── createBatchZip ───────────────────────────────────────────────────────────

describe("createBatchZip", () => {
  beforeEach(() => {
    zipMock.mockReset();
  });

  it("de-dupes colliding filenames, passes level:0, and emits an application/zip blob", async () => {
    zipMock.mockImplementation(
      (
        _entries: Record<string, Uint8Array>,
        _opts: { level: number },
        cb: (err: Error | null, data: Uint8Array) => void,
      ) => cb(null, new Uint8Array([1, 2, 3])),
    );

    const items = [
      { blob: new Blob([new Uint8Array([1])]), filename: "a.png" },
      { blob: new Blob([new Uint8Array([2])]), filename: "a.png" },
      { blob: new Blob([new Uint8Array([3])]), filename: "b" },
      { blob: new Blob([new Uint8Array([4])]), filename: "b" },
    ];
    const out = await createBatchZip(items);

    expect(out.type).toBe("application/zip");
    expect(zipMock).toHaveBeenCalledWith(expect.anything(), { level: 0 }, expect.any(Function));
    const firstCall = zipMock.mock.calls[0] as [Record<string, Uint8Array>, unknown, unknown];
    expect(Object.keys(firstCall[0])).toEqual(["a.png", "a (2).png", "b", "b (2)"]);
  });
});

// ── readImageMeta ────────────────────────────────────────────────────────────

describe("readImageMeta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns sniffed format + oriented dims, without calling toBlob", async () => {
    const { toBlob } = setupCanvas();
    setupImageMock({ width: 120, height: 80 });
    setupURLMock();

    // JPEG bytes with EMPTY MIME → format must come from the bytes.
    const jpegData = new Uint8Array(32);
    jpegData.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const file = new File([jpegData], "photo", { type: "" });

    const meta = await readImageMeta(file);
    expect(meta).toEqual({ format: "jpeg", width: 120, height: 80 });
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("throws for a mislabeled file (HEIC bytes named .png)", async () => {
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    // HEIC ftyp sniffs to null even though the file claims to be a PNG.
    const heicData = ftyp("heic", ["mif1"]);
    const file = new File([heicData], "logo.png", { type: "image/png" });
    await expect(readImageMeta(file)).rejects.toThrow(/unrecognized|Unsupported/i);
  });
});
