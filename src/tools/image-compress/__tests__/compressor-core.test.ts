import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CodecApi,
  type CodecLoader,
  type DecodedImage,
  compressImageData,
  encodeImageData,
  flattenForJpeg,
  hasAlpha,
  shouldKeepOriginal,
  tightRGBA,
} from "../compressor-core";
import type { CompressOptions } from "../compressor-types";

// upng-js is dynamically imported inside encodeImageData; mock it module-wide.
const upngEncode = vi.fn((..._args: unknown[]) => new ArrayBuffer(8));
vi.mock("upng-js", () => ({ default: { encode: (...args: unknown[]) => upngEncode(...args) } }));

afterEach(() => {
  vi.clearAllMocks();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeImageData(width: number, height: number, fill?: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

const OPTS: CompressOptions = {
  format: "keep",
  quality: 80,
  lossless: false,
  pngMode: "oxipng",
  paletteColors: 64,
  pngLevel: 3,
  avifSpeed: 6,
  webpMethod: 4,
};

// A loader whose codec functions are vi.fn spies returning a fixed-size buffer.
function makeLoader(outSize = 4): {
  load: CodecLoader;
  spies: Record<keyof CodecApi, ReturnType<typeof vi.fn>>;
} {
  const buf = () => new ArrayBuffer(outSize);
  const spies = {
    jpeg: vi.fn(async () => buf()),
    webp: vi.fn(async () => buf()),
    avif: vi.fn(async () => buf()),
    oxipng: vi.fn(async () => buf()),
    pngDecode: vi.fn(async () => makeImageData(1, 1)),
    avifDecode: vi.fn(async () => makeImageData(1, 1)),
  } as Record<keyof CodecApi, ReturnType<typeof vi.fn>>;
  const load: CodecLoader = async (name) => spies[name] as never;
  return { load, spies };
}

// ── encodeImageData dispatch + verified option names ──────────────────────────

describe("encodeImageData", () => {
  it("jpeg → { quality }, image/jpeg / jpg", async () => {
    const { load, spies } = makeLoader();
    const out = await encodeImageData(makeImageData(2, 2, [10, 20, 30, 255]), "jpeg", OPTS, load);
    expect(spies.jpeg).toHaveBeenCalledWith(expect.anything(), { quality: 80 });
    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
  });

  it("webp → { quality, method, lossless } with boolean→0/1 coercion", async () => {
    const { load, spies } = makeLoader();
    await encodeImageData(makeImageData(1, 1), "webp", { ...OPTS, webpMethod: 5 }, load);
    expect(spies.webp).toHaveBeenCalledWith(expect.anything(), {
      quality: 80,
      method: 5,
      lossless: 0,
    });
    await encodeImageData(makeImageData(1, 1), "webp", { ...OPTS, lossless: true }, load);
    expect(spies.webp).toHaveBeenLastCalledWith(expect.anything(), {
      quality: 80,
      method: 4,
      lossless: 1,
    });
  });

  it("avif → { quality, speed } (no cqLevel)", async () => {
    const { load, spies } = makeLoader();
    await encodeImageData(makeImageData(1, 1), "avif", { ...OPTS, avifSpeed: 8 }, load);
    expect(spies.avif).toHaveBeenCalledWith(expect.anything(), { quality: 80, speed: 8 });
    const arg = spies.avif.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("cqLevel");
  });

  it("png + oxipng → optimise(imageData, { level })", async () => {
    const { load, spies } = makeLoader();
    const img = makeImageData(1, 1);
    const out = await encodeImageData(
      img,
      "png",
      { ...OPTS, pngMode: "oxipng", pngLevel: 3 },
      load,
    );
    expect(spies.oxipng).toHaveBeenCalledWith(img, { level: 3 });
    expect(out.mime).toBe("image/png");
    expect(out.ext).toBe("png");
  });

  it("png + palette → UPNG.encode with paletteColors", async () => {
    const { load } = makeLoader();
    const img = makeImageData(2, 3);
    await encodeImageData(img, "png", { ...OPTS, pngMode: "palette", paletteColors: 64 }, load);
    expect(upngEncode).toHaveBeenCalledTimes(1);
    const [buffers, w, h, cnum] = upngEncode.mock.calls[0] as unknown as [
      ArrayBuffer[],
      number,
      number,
      number,
    ];
    expect(w).toBe(2);
    expect(h).toBe(3);
    expect(cnum).toBe(64);
    // Tight buffer: exactly width*height*4 bytes, not an oversized underlying buffer.
    expect(buffers[0]?.byteLength).toBe(2 * 3 * 4);
  });
});

// ── tight buffer / flatten ────────────────────────────────────────────────────

describe("tightRGBA", () => {
  it("copies exactly width*height*4 even from a subarray view", () => {
    const big = new Uint8ClampedArray(1000);
    const view = big.subarray(40, 40 + 16); // 2×2 RGBA window inside a larger buffer
    const img = { data: view, width: 2, height: 2, colorSpace: "srgb" } as ImageData;
    expect(tightRGBA(img).byteLength).toBe(16);
  });
});

describe("flattenForJpeg", () => {
  it("composites a transparent pixel onto white (→ near-white, not black)", () => {
    const img = makeImageData(1, 1, [0, 0, 0, 0]); // fully transparent black
    const flat = flattenForJpeg(img);
    expect(Array.from(flat.data)).toEqual([255, 255, 255, 255]);
  });

  it("half-transparent red blends toward white", () => {
    const img = makeImageData(1, 1, [255, 0, 0, 128]);
    const flat = flattenForJpeg(img);
    expect(flat.data[0]).toBe(255); // R
    expect(flat.data[1]).toBeGreaterThan(120); // G lifted toward white
    expect(flat.data[3]).toBe(255); // opaque
  });

  it("jpeg encode receives a flattened (opaque) ImageData when input has alpha", async () => {
    const { load, spies } = makeLoader();
    await encodeImageData(makeImageData(1, 1, [0, 0, 0, 0]), "jpeg", OPTS, load);
    const passed = spies.jpeg.mock.calls[0]?.[0] as ImageData;
    expect(hasAlpha(passed)).toBe(false);
    expect(passed.data[0]).toBe(255);
  });
});

// ── regression guard ──────────────────────────────────────────────────────────

describe("shouldKeepOriginal", () => {
  const lossy = { lossless: false };
  it("same normalized format, lossy, output ≥ input → keep original", () => {
    expect(shouldKeepOriginal(120, 100, "jpeg", "jpeg", lossy)).toBe(true);
    expect(shouldKeepOriginal(90, 100, "jpeg", "jpeg", lossy)).toBe(false);
  });

  it("png-palette vs png-oxipng are both 'png' → still guarded", () => {
    expect(shouldKeepOriginal(120, 100, "png", "png", lossy)).toBe(true);
  });

  it("deliberate transcode larger → NOT kept (keep the real output)", () => {
    expect(shouldKeepOriginal(120, 100, "webp", "png", lossy)).toBe(false);
  });

  it("webp lossless larger → NOT kept (exempt from auto-revert)", () => {
    expect(shouldKeepOriginal(120, 100, "webp", "webp", { lossless: true })).toBe(false);
  });

  it("lossless leaked into a non-webp target is still guarded (exemption is webp-only)", () => {
    // Toggle Lossless on WebP, then switch to JPEG/Keep: `lossless` stays true but the
    // JPEG encode ignores it — the larger output must still revert to the original.
    expect(shouldKeepOriginal(120, 100, "jpeg", "jpeg", { lossless: true })).toBe(true);
    expect(shouldKeepOriginal(120, 100, "png", "png", { lossless: true })).toBe(true);
  });
});

// ── compressImageData orchestration (injected decode + load) ──────────────────

describe("compressImageData", () => {
  const fakeDecode = (w: number, h: number) => async (): Promise<DecodedImage> => {
    const data = makeImageData(w, h, [1, 2, 3, 255]);
    return { data, width: w, height: h };
  };

  it("geometry invariant: result dims === decoded dims", async () => {
    const { load } = makeLoader(4);
    const input = new Uint8Array(100);
    const res = await compressImageData(
      input,
      "jpeg",
      { ...OPTS, format: "keep" },
      {
        load,
        decode: fakeDecode(40, 30),
      },
    );
    expect(res.width).toBe(40);
    expect(res.height).toBe(30);
    expect(res.outputFormat).toBe("jpeg");
  });

  it("keeps original when same-format lossy output is larger", async () => {
    const { load } = makeLoader(500); // encode bigger than the 100-byte input
    const input = new Uint8Array(100);
    const res = await compressImageData(
      input,
      "jpeg",
      { ...OPTS, format: "keep" },
      {
        load,
        decode: fakeDecode(4, 4),
      },
    );
    expect(res.keptOriginal).toBe(true);
    expect(res.bytes).toBe(input);
    expect(res.ratio).toBe(0);
    expect(res.outputSize).toBe(100);
  });

  it("reports a negative ratio for a larger deliberate transcode (no swap)", async () => {
    const { load } = makeLoader(200);
    const input = new Uint8Array(100);
    const res = await compressImageData(
      input,
      "png",
      { ...OPTS, format: "webp" },
      {
        load,
        decode: fakeDecode(4, 4),
      },
    );
    expect(res.keptOriginal).toBe(false);
    expect(res.outputFormat).toBe("webp");
    expect(res.ratio).toBeLessThan(0);
  });
});
