import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compositeFromMask,
  postprocessMask,
  preprocess,
  removeBackgroundFromBytes,
} from "../remover-core";
import { ACTIVE_VARIANT, DEFAULT_PREFS, MODELS, type RemoveOptions } from "../remover-types";

// ── Environment obstacle A: onnxruntime-web top-level import ─────────────────
// remover-core does `import * as ort from "onnxruntime-web/wasm"` at module scope. Importing
// the real module under jsdom would execute ORT/WASM init. preprocess/postprocess/composite never
// touch ORT; only removeBackgroundFromBytes constructs `new ort.Tensor`, which this mock covers.
vi.mock("onnxruntime-web/wasm", () => ({
  env: { wasm: {} },
  Tensor: class {
    type: string;
    data: unknown;
    dims: number[];
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
  InferenceSession: { create: vi.fn() },
}));

// @/lib/image: readImageDims is the geometry preflight (header peek) — return a benign size under
// MAX_CANVAS_AREA. The TRUE output geometry flows from createImageBitmap dims (stubbed below), not
// from here. Keep MAX_CANVAS_AREA at the real ceiling so the area guard behaves.
vi.mock("@/lib/image", () => ({
  MAX_CANVAS_AREA: 16_777_216,
  readImageDims: vi.fn(() => ({ width: 12, height: 8 })),
}));

// @jsquash/oxipng/optimise: return the composite's RAW RGBA buffer (NOT a real PNG) so the
// download-path bytes are inspectable pixel-for-pixel.
vi.mock("@jsquash/oxipng/optimise", () => ({
  default: vi.fn(async (img: { data: Uint8ClampedArray }) => img.data.buffer.slice(0)),
}));

// ── Environment obstacle B: OffscreenCanvas / ImageData (absent in jsdom) ────
// A faithful-ENOUGH 2D mock: stores an RGBA buffer, copies on putImageData, NEAREST-NEIGHBOR
// resamples on the 9-arg drawImage (real code uses high-quality smoothing — irrelevant for these
// assertions, and identity-size calls are exact copies either way), and exposes the buffer bytes
// through getImageData / convertToBlob so encoded output is readable back as pixels.
interface CanvasLike {
  width: number;
  height: number;
  _buffer?: Uint8ClampedArray;
}

class MockCtx {
  canvas: MockOffscreenCanvas;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  constructor(canvas: MockOffscreenCanvas) {
    this.canvas = canvas;
  }
  putImageData(img: { data: Uint8ClampedArray }): void {
    // All call sites size the canvas to match the ImageData dims.
    this.canvas._buffer.set(img.data);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return {
      data: new Uint8ClampedArray(this.canvas._buffer),
      width: w,
      height: h,
      colorSpace: "srgb" as const,
    };
  }
  drawImage(src: CanvasLike, ...rest: number[]): void {
    const db = this.canvas._buffer;
    const dW = this.canvas.width;
    const sb = src._buffer;
    if (rest.length === 8) {
      // 9-arg form: drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh) — nearest-neighbor resample.
      const [sx, sy, sw, sh, dx, dy, dw, dh] = rest as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      if (!sb) return;
      const sW = src.width;
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const srcX = sx + Math.min(sw - 1, Math.floor((x / dw) * sw));
          const srcY = sy + Math.min(sh - 1, Math.floor((y / dh) * sh));
          const si = (srcY * sW + srcX) * 4;
          const di = ((dy + y) * dW + (dx + x)) * 4;
          db[di] = sb[si] ?? 0;
          db[di + 1] = sb[si + 1] ?? 0;
          db[di + 2] = sb[si + 2] ?? 0;
          db[di + 3] = sb[si + 3] ?? 0;
        }
      }
      return;
    }
    // 3-arg form: drawImage(src, dx, dy). Used with a decoded bitmap (no _buffer) — no-op leaves
    // zeros, which is fine: the geometry test only asserts dims/length, not pixel content.
    if (!sb) return;
    const [dx, dy] = rest as [number, number];
    const sW = src.width;
    const sH = src.height;
    for (let y = 0; y < sH; y++) {
      for (let x = 0; x < sW; x++) {
        const si = (y * sW + x) * 4;
        const di = ((dy + y) * dW + (dx + x)) * 4;
        db[di] = sb[si] ?? 0;
        db[di + 1] = sb[si + 1] ?? 0;
        db[di + 2] = sb[si + 2] ?? 0;
        db[di + 3] = sb[si + 3] ?? 0;
      }
    }
  }
}

class MockOffscreenCanvas {
  _w: number;
  _h: number;
  _buffer: Uint8ClampedArray;
  _ctx?: MockCtx;
  constructor(w: number, h: number) {
    this._w = w;
    this._h = h;
    this._buffer = new Uint8ClampedArray(w * h * 4);
  }
  get width() {
    return this._w;
  }
  set width(v: number) {
    this._w = v;
    this._buffer = new Uint8ClampedArray(v * this._h * 4);
  }
  get height() {
    return this._h;
  }
  set height(v: number) {
    this._h = v;
    this._buffer = new Uint8ClampedArray(this._w * v * 4);
  }
  getContext(): MockCtx {
    if (!this._ctx) this._ctx = new MockCtx(this);
    return this._ctx;
  }
  async convertToBlob({ type }: { type: string }): Promise<Blob> {
    // Bytes ARE the raw RGBA buffer (NOT a real PNG), so a test can read pixels back.
    return new Blob([this._buffer.buffer as ArrayBuffer], { type });
  }
}

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = "srgb";
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (a instanceof Uint8ClampedArray) {
      this.data = a;
      this.width = b;
      this.height = c as number;
    } else {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    }
  }
}

vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
// jsdom provides no ImageData (verified) — stub it.
vi.stubGlobal("ImageData", MockImageData);

afterEach(() => {
  vi.clearAllMocks();
});

// ── fixtures ─────────────────────────────────────────────────────────────────
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
  return { data, width, height, colorSpace: "srgb" } as unknown as ImageData;
}

// ACTIVE_VARIANT === "fast"; the single registered model (MODELS is a Partial map).
const SPEC =
  MODELS.fast ??
  (() => {
    throw new Error("MODELS.fast unregistered");
  })();

// ── preprocess ────────────────────────────────────────────────────────────────
describe("preprocess", () => {
  it("NCHW shape [1,3,320,320] and tensor length 3·n; rembg normalization with max=255 ⇒ /max≡/255", () => {
    // 320×320 ⇒ resize is identity (nearest-neighbor exact). One pixel hits 255 ⇒ max-over-samples
    // = 1.0 ⇒ divide-by-max collapses to plain /255 at that pixel.
    const img = makeImageData(SPEC.inputSize, SPEC.inputSize);
    img.data[0] = 255;
    img.data[1] = 128;
    img.data[2] = 64;
    img.data[3] = 255;

    const { tensorData, dims } = preprocess(img, SPEC);
    const n = SPEC.inputSize * SPEC.inputSize;

    expect(dims).toEqual([1, 3, SPEC.inputSize, SPEC.inputSize]);
    expect(tensorData.length).toBe(3 * n);

    const [mr, mg, mb] = SPEC.mean;
    const [sr, sg, sb] = SPEC.std;
    const mx = 1.0; // 255/255 present ⇒ divide-by-max == /255
    // NCHW planes at offsets 0, n, 2n.
    expect(tensorData[0]).toBeCloseTo((255 / 255 / mx - mr) / sr, 5); // R plane
    expect(tensorData[n]).toBeCloseTo((128 / 255 / mx - mg) / sg, 5); // G plane
    expect(tensorData[2 * n]).toBeCloseTo((64 / 255 / mx - mb) / sb, 5); // B plane
  });

  it("divide-by-max differs from plain /255 when max < 255 (proves rembg im/max(im))", () => {
    // Brightest sample is 200 ⇒ mx = 200/255. A 100-valued sample normalizes to (100/255)/(200/255)
    // = 0.5 under divide-by-max, vs 100/255 ≈ 0.392 under plain /255 — the two MUST disagree.
    const img = makeImageData(SPEC.inputSize, SPEC.inputSize);
    img.data[0] = 200; // pixel 0 R — the global max
    img.data[3] = 255;
    img.data[4] = 100; // pixel 1 R
    img.data[7] = 255;

    const { tensorData } = preprocess(img, SPEC);
    const [mr] = SPEC.mean;
    const [sr] = SPEC.std;
    const mx = 200 / 255;

    const expectedByMax = (100 / 255 / mx - mr) / sr; // == (0.5 - mr)/sr
    const plainBy255 = (100 / 255 - mr) / sr;
    // tensorData[1] is pixel 1 in the R plane (plane offset 0).
    expect(tensorData[1]).toBeCloseTo(expectedByMax, 5);
    expect(tensorData[1]).not.toBeCloseTo(plainBy255, 2); // gap ≈ 0.47 ≫ 2-decimal tolerance
  });
});

// ── postprocessMask ─────────────────────────────────────────────────────────────
describe("postprocessMask", () => {
  it("min-max normalizes: min ⇒ 0, max ⇒ 1 (identity-size path)", () => {
    // inputSize is a parameter — use 2 so the math is hand-checkable; outW=outH=2 ⇒ identity upscale.
    const raw = new Float32Array([0, 10, 5, 10]); // min 0, max 10
    const mask = postprocessMask(raw, 2, 2, 2);
    expect(mask.length).toBe(4);
    expect(mask[0]).toBeCloseTo(0, 5); // min → 0
    expect(mask[1]).toBeCloseTo(1, 5); // max → 1
    expect(mask[2]).toBeCloseTo(0.5, 1); // midpoint ~0.5 (8-bit round)
  });

  it("degenerate (range < 1e-6) ⇒ all-zero matte, no NaN divide", () => {
    const raw = new Float32Array([5, 5, 5, 5]);
    const mask = postprocessMask(raw, 2, 2, 2);
    expect(mask.length).toBe(4);
    expect(Array.from(mask).every((v) => v === 0)).toBe(true);
  });

  it("upscales to outW·outH when output dims differ from inputSize", () => {
    const raw = new Float32Array([0, 10, 5, 10]); // non-degenerate range
    const mask = postprocessMask(raw, 2, 4, 3);
    expect(mask.length).toBe(4 * 3);
  });
});

// ── compositeFromMask ──────────────────────────────────────────────────────────
// Read pixels back through the oxipng DOWNLOAD path (mock returns raw RGBA, Blob-independent).
async function compositeBytes(
  src: ImageData,
  mask: Float32Array,
  opts: RemoveOptions,
): Promise<Uint8Array> {
  const { bytes } = await compositeFromMask(src, mask, { ...opts, format: "png" }, "download");
  return bytes;
}

describe("compositeFromMask", () => {
  it("transparent (threshold 0): alpha === round(mask·255), RGB preserved", async () => {
    const src = makeImageData(2, 2, [255, 0, 0, 255]); // solid red
    const mask = new Float32Array([1, 1, 0, 0]);
    const bytes = await compositeBytes(src, mask, {
      ...DEFAULT_PREFS,
      outputMode: "transparent",
      alphaThreshold: 0,
    });
    for (let i = 0; i < 4; i++) {
      expect(bytes[i * 4]).toBe(255); // R preserved
      expect(bytes[i * 4 + 1]).toBe(0); // G
      expect(bytes[i * 4 + 2]).toBe(0); // B
      expect(bytes[i * 4 + 3]).toBe(Math.round((mask[i] as number) * 255)); // A = mask·255
    }
  });

  it("color over #0000ff: RGB = round(c·m + bg·(1−m)), alpha opaque", async () => {
    const src = makeImageData(2, 2, [255, 0, 0, 255]);
    const mask = new Float32Array([1, 1, 0, 0]);
    const bytes = await compositeBytes(src, mask, {
      ...DEFAULT_PREFS,
      outputMode: "color",
      backgroundColor: "#0000ff",
      alphaThreshold: 0,
    });
    // m=1 ⇒ full red; m=0 ⇒ full blue background.
    expect(Array.from(bytes.slice(0, 4))).toEqual([255, 0, 0, 255]); // pixel 0, m=1
    expect(Array.from(bytes.slice(8, 12))).toEqual([0, 0, 255, 255]); // pixel 2, m=0
  });

  it("mask mode: grayscale RGB === round(mask·255), alpha opaque", async () => {
    const src = makeImageData(2, 2, [255, 0, 0, 255]);
    const mask = new Float32Array([1, 0.5, 0, 0.25]);
    const bytes = await compositeBytes(src, mask, { ...DEFAULT_PREFS, outputMode: "mask" });
    for (let i = 0; i < 4; i++) {
      const v = Math.round((mask[i] as number) * 255);
      expect(bytes[i * 4]).toBe(v);
      expect(bytes[i * 4 + 1]).toBe(v);
      expect(bytes[i * 4 + 2]).toBe(v);
      expect(bytes[i * 4 + 3]).toBe(255);
    }
  });

  it("alphaThreshold 128 binarizes the matte (0.4 ⇒ 0, 0.9 ⇒ 255)", async () => {
    const src = makeImageData(2, 1, [255, 0, 0, 255]);
    const mask = new Float32Array([0.4, 0.9]);
    const bytes = await compositeBytes(src, mask, {
      ...DEFAULT_PREFS,
      outputMode: "transparent",
      alphaThreshold: 128,
    });
    expect(bytes[3]).toBe(0); // 0.4 < 128/255 ⇒ 0
    expect(bytes[7]).toBe(255); // 0.9 ≥ 128/255 ⇒ 255
  });

  it("format png ⇒ ext 'png' / mime 'image/png'", async () => {
    const out = await compositeFromMask(
      makeImageData(1, 1, [0, 0, 0, 255]),
      new Float32Array([1]),
      { ...DEFAULT_PREFS, format: "png" },
      "preview",
    );
    expect(out.ext).toBe("png");
    expect(out.mime).toBe("image/png");
  });

  it("format webp ⇒ ext 'webp' / mime 'image/webp'", async () => {
    const out = await compositeFromMask(
      makeImageData(1, 1, [0, 0, 0, 255]),
      new Float32Array([1]),
      { ...DEFAULT_PREFS, format: "webp" },
      "preview",
    );
    expect(out.ext).toBe("webp");
    expect(out.mime).toBe("image/webp");
  });
});

// ── removeBackgroundFromBytes (geometry + plumbing) ─────────────────────────────
describe("removeBackgroundFromBytes", () => {
  it("geometry invariant: result dims === decoded dims; returns srcRGBA + W·H mask", async () => {
    const W = 12;
    const H = 8;
    // Decode seam: createImageBitmap yields the known W×H (drives the true output geometry).
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: W, height: H, close: vi.fn() })),
    );

    const fakeSession = {
      inputNames: ["input.1"],
      outputNames: ["out"],
      run: vi.fn(async () => ({ out: { data: new Float32Array(320 * 320).fill(0.5) } })),
    };
    const loadSession = vi.fn(async () => fakeSession) as unknown as NonNullable<
      Parameters<typeof removeBackgroundFromBytes>[4]
    >["loadSession"];

    const { result, srcRGBA, fullResMask } = await removeBackgroundFromBytes(
      new Uint8Array(64),
      "png",
      DEFAULT_PREFS,
      "preview",
      { loadSession },
    );

    expect(result.width).toBe(W);
    expect(result.height).toBe(H);
    expect(srcRGBA.width).toBe(W);
    expect(srcRGBA.height).toBe(H);
    expect(fullResMask.length).toBe(W * H);
    expect(fakeSession.run).toHaveBeenCalledTimes(1);
    // Sanity on the fixed model wiring.
    expect(ACTIVE_VARIANT).toBe("fast");

    vi.unstubAllGlobals();
    // Re-stub the canvas/imagedata globals unstubbed above (other tests in this file rely on them).
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("ImageData", MockImageData);
  });
});
