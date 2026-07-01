import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type UpscaleOutput,
  type UpscaleRunOptions,
  type UpscalerLike,
  encodeUpscaled,
  inferUpscaledRGBA,
  recombine,
  splitAlpha,
  upscaleAlphaPlane,
  upscaleImageData,
} from "../upscaler-core";
import { DEFAULT_PREFS, type ScaleFactor, computeMaxScale } from "../upscaler-types";

// ── Environment obstacle: OffscreenCanvas / ImageData (absent in jsdom) ──────
// Mirrors the background-remover core test's canvas mocks EXACTLY: a faithful-ENOUGH 2D mock that
// stores an RGBA buffer, copies on putImageData, NEAREST-NEIGHBOR resamples on the 9-arg drawImage
// (real code uses high-quality smoothing — irrelevant for these length/monotonicity assertions), and
// exposes the buffer bytes through getImageData / convertToBlob so encoded output is readable as pixels.
interface CanvasLike {
  width: number;
  height: number;
  _buffer?: Uint8ClampedArray;
}

class MockCtx {
  canvas: MockOffscreenCanvas;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  fillStyle = "";
  constructor(canvas: MockOffscreenCanvas) {
    this.canvas = canvas;
  }
  putImageData(img: { data: Uint8ClampedArray }): void {
    this.canvas._buffer.set(img.data);
  }
  fillRect(): void {}
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
    // 3-arg form: drawImage(src, dx, dy). Used with a decoded bitmap (no _buffer) — no-op leaves zeros,
    // which is fine: the geometry tests only assert dims/length, not pixel content.
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
    // Bytes ARE the raw RGBA buffer (NOT a real PNG/WebP/JPEG), so a test can read pixels back.
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
vi.stubGlobal("ImageData", MockImageData);

// createImageBitmap: jsdom lacks it. Return a closeable fake sized by `nextBitmap` (set per test). The
// decode path draws this bitmap (no _buffer → mock no-op) so srcRGBA is zeroed — fine, geometry tests
// assert dims only.
let nextBitmap = { width: 1, height: 1 };
vi.stubGlobal(
  "createImageBitmap",
  vi.fn(async () => ({ width: nextBitmap.width, height: nextBitmap.height, close: vi.fn() })),
);

afterEach(() => {
  vi.clearAllMocks();
});

// ── fixtures ─────────────────────────────────────────────────────────────────
/** A 24-byte PNG header whose IHDR carries `width`/`height` so `readImageDims` reads them (no raster). */
function pngWithDims(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  const view = new DataView(data.buffer);
  view.setUint32(8, 13, false); // IHDR length
  data.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return data;
}

function makeImageData(
  width: number,
  height: number,
  fill?: [number, number, number, number],
): ImageData {
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

// Stub `loadUpscaler` (the `deps` seam): returns a fake UpscalerLike whose `upscale` nearest-neighbor
// enlarges the RGB ImageData ×scale and returns a TF.js-shaped tensor `[outH, outW, 3]` — NO real
// TF.js / model. Uses the `scale` the core passes in (=== opts.scale), so one stub covers 2× and 4×.
const stubLoad = async (scale: ScaleFactor): Promise<UpscalerLike> => ({
  async upscale(rgb: ImageData, opts: UpscaleRunOptions): Promise<UpscaleOutput> {
    opts.progress?.(0.5);
    opts.progress?.(1);
    const w = rgb.width;
    const h = rgb.height;
    const ow = w * scale;
    const oh = h * scale;
    const out = new Float32Array(ow * oh * 3);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const sx = Math.floor(x / scale);
        const sy = Math.floor(y / scale);
        const si = (sy * w + sx) * 4;
        const di = (y * ow + x) * 3;
        out[di] = rgb.data[si] ?? 0;
        out[di + 1] = rgb.data[si + 1] ?? 0;
        out[di + 2] = rgb.data[si + 2] ?? 0;
      }
    }
    return { shape: [oh, ow, 3], dataSync: () => out, dispose: () => {} };
  },
});

// ── computeMaxScale (the load-bearing OUTPUT-cap gate — plan §10.2/§11) ───────
describe("computeMaxScale", () => {
  it("picks the largest scale whose OUTPUT fits ≤8192/side AND ≤16.7 MP area", () => {
    expect(computeMaxScale(1000, 1000)).toBe(4); // out 4000² = 16 MP, fits
    expect(computeMaxScale(1024, 1024)).toBe(4); // out 4096² = 16.777 MP, exactly at the area cap
    expect(computeMaxScale(2048, 2048)).toBe(2); // ×4 = 8192² = 67 MP busts; ×2 = 4096² fits
    expect(computeMaxScale(2000, 2000)).toBe(2); // ×4 busts area; ×2 = 16 MP fits
    expect(computeMaxScale(3000, 2000)).toBe(0); // ×2 = 6000×4000 = 24 MP busts area → even 2× fails
    expect(computeMaxScale(1025, 1025)).toBe(2); // ×4 = 4100² ≈ 16.81 MP > cap (area-bust branch)
  });

  it("busts on the 8192 px SIDE cap, not just area", () => {
    // 5000×100 ×2 = 10000×200: area 2 MP fits, but 10000 px side > 8192 → gated to 0 for ×2.
    expect(computeMaxScale(5000, 100)).toBe(0);
  });

  it("device-aware maxArea lowers the cap (weak-device gate — opencode r2 #1/#4)", () => {
    expect(computeMaxScale(1000, 1000, 8_000_000)).toBe(2); // ×4 = 16 MP > 8 MP cap; ×2 = 4 MP fits
    expect(computeMaxScale(1000, 1000)).toBe(4); // default 16.7 MP → 4×
  });
});

// ── splitAlpha ────────────────────────────────────────────────────────────────
describe("splitAlpha", () => {
  it("fully opaque → alpha === null, rgb preserved with A=255", () => {
    const src = makeImageData(2, 2, [10, 20, 30, 255]);
    const { rgb, alpha } = splitAlpha(src);
    expect(alpha).toBeNull();
    expect(rgb.width).toBe(2);
    expect(rgb.height).toBe(2);
    for (let i = 0; i < 4; i++) {
      expect(rgb.data[i * 4]).toBe(10);
      expect(rgb.data[i * 4 + 3]).toBe(255);
    }
  });

  it("with transparency → alpha plane extracted, rgb opaque", () => {
    const src = makeImageData(2, 2, [255, 0, 0, 128]);
    const { rgb, alpha } = splitAlpha(src);
    expect(alpha).not.toBeNull();
    expect(alpha?.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(alpha?.[i]).toBe(128); // alpha plane holds the original A
      expect(rgb.data[i * 4]).toBe(255); // RGB kept
      expect(rgb.data[i * 4 + 3]).toBe(255); // rgb forced opaque
    }
  });
});

// ── upscaleAlphaPlane ───────────────────────────────────────────────────────
describe("upscaleAlphaPlane", () => {
  it("resamples to (w·scale)·(h·scale) length", () => {
    const alpha = new Uint8ClampedArray([0, 85, 170, 255]); // 2×2 plane
    const up = upscaleAlphaPlane(alpha, 2, 2, 2);
    expect(up.length).toBe(4 * 4); // (2·2)×(2·2) = 4×4 = 16
  });

  it("stays monotone non-decreasing on a horizontal ramp (bicubic-plausible)", () => {
    // 4×1 ramp 0→255. Upscaling ×2 → 8×2 (both dims scale). The first output ROW (indices 0..7) must
    // remain non-decreasing left→right — the horizontal resample must not invert the ramp.
    const alpha = new Uint8ClampedArray([0, 85, 170, 255]);
    const up = upscaleAlphaPlane(alpha, 4, 1, 2);
    expect(up.length).toBe(8 * 2); // outW·outH = 8×2
    for (let x = 1; x < 8; x++) {
      expect(up[x] ?? 0).toBeGreaterThanOrEqual(up[x - 1] ?? 0);
    }
  });
});

// ── recombine ────────────────────────────────────────────────────────────────
describe("recombine", () => {
  it("rgb + alpha → RGBA with the alpha channel set", () => {
    const rgb = makeImageData(2, 1, [9, 8, 7, 255]);
    const alpha = new Uint8ClampedArray([64, 200]);
    const out = recombine(rgb, alpha);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(64);
    expect(out.data[7]).toBe(200);
    expect(out.data[0]).toBe(9); // RGB preserved
  });

  it("alpha === null → A forced to 255", () => {
    const rgb = makeImageData(1, 1, [1, 2, 3, 255]);
    const out = recombine(rgb, null);
    expect(out.data[3]).toBe(255);
  });

  it("throws when the alpha plane length ≠ rgb.width·height", () => {
    const rgb = makeImageData(2, 2); // n = 4
    const wrong = new Uint8ClampedArray(3); // mismatched
    expect(() => recombine(rgb, wrong)).toThrow(/mismatch/i);
  });
});

// ── encodeUpscaled ──────────────────────────────────────────────────────────
describe("encodeUpscaled", () => {
  it("PNG → mime image/png, ext png, alpha PRESERVED", async () => {
    const rgba = makeImageData(2, 2, [255, 0, 0, 128]);
    const out = await encodeUpscaled(rgba, "png", 90, "#ffffff");
    expect(out.mime).toBe("image/png");
    expect(out.ext).toBe("png");
    expect(out.bytes[3]).toBe(128); // alpha kept (raw RGBA buffer via the mock)
  });

  it("WebP → mime image/webp, ext webp", async () => {
    const rgba = makeImageData(1, 1, [0, 0, 0, 255]);
    const out = await encodeUpscaled(rgba, "webp", 80, "#ffffff");
    expect(out.mime).toBe("image/webp");
    expect(out.ext).toBe("webp");
  });

  it("JPEG → mime image/jpeg, ext jpg, FLATTENS alpha over the background (no alpha channel)", async () => {
    // Half-transparent red flattened over BLACK → R ≈ 128, and A forced opaque.
    const rgba = makeImageData(2, 2, [255, 0, 0, 128]);
    const out = await encodeUpscaled(rgba, "jpeg", 90, "#000000");
    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg"); // repo convention: jpeg → "jpg"
    expect(out.bytes[3]).toBe(255); // flattened → opaque
    expect(out.bytes[0]).toBeCloseTo(128, -1); // 255 × 0.502 + 0 × 0.498 ≈ 128
  });

  it("re-encoding the SAME ImageData at a new format yields the new mime (the reencode path)", async () => {
    const rgba = makeImageData(1, 1, [0, 0, 0, 255]);
    const asPng = await encodeUpscaled(rgba, "png", 90, "#ffffff");
    const asWebp = await encodeUpscaled(rgba, "webp", 90, "#ffffff");
    expect(asPng.mime).toBe("image/png");
    expect(asWebp.mime).toBe("image/webp");
    expect(asPng.mime).not.toBe(asWebp.mime);
  });
});

// ── inferUpscaledRGBA / upscaleImageData — geometry invariant + cap gate ─────
describe("inferUpscaledRGBA / upscaleImageData", () => {
  it("geometry invariant: output === input × scale (2×)", async () => {
    nextBitmap = { width: 10, height: 8 };
    const input = pngWithDims(10, 8);
    const rgba = await inferUpscaledRGBA(input, "png", 2, undefined, { loadUpscaler: stubLoad });
    expect(rgba.width).toBe(20);
    expect(rgba.height).toBe(16);
  });

  it("geometry invariant: output === input × scale (4×) via upscaleImageData", async () => {
    nextBitmap = { width: 10, height: 8 };
    const input = pngWithDims(10, 8);
    const result = await upscaleImageData(input, "png", { ...DEFAULT_PREFS, scale: 4 }, undefined, {
      loadUpscaler: stubLoad,
    });
    expect(result.width).toBe(40);
    expect(result.height).toBe(32);
    expect(result.scale).toBe(4);
    expect(result.mime).toBe("image/png");
    expect(result.ext).toBe("png");
    expect(result.outputSize).toBe(result.bytes.length);
  });

  it("orientation mismatch: output tracks DECODED dims, not preflight (rotated-AVIF guard, opencode r1 #2)", async () => {
    // Preflight (header) reports 10×8, but the decode yields 8×10 — the shape a rotated non-square
    // AVIF/WebP produces (readAvifDims/readImageDims report NON-oriented dims for those formats, while
    // the createImageBitmap decode is EXIF-oriented). Output geometry must follow the DECODED basis, so
    // the geometry invariant must NOT trip. (Cap gate stays on preflight — area/max-side are invariant.)
    nextBitmap = { width: 8, height: 10 };
    const input = pngWithDims(10, 8);
    const rgba = await inferUpscaledRGBA(input, "png", 2, undefined, { loadUpscaler: stubLoad });
    expect(rgba.width).toBe(16); // decoded 8 × 2
    expect(rgba.height).toBe(20); // decoded 10 × 2
  });

  it("upscaleImageData wrapper also tolerates the orientation mismatch (no stale preflight assertion, opencode r2 #1)", async () => {
    // Same rotated-source shape (preflight 10x8, decode 8x10) driven through the full wrapper: it must
    // NOT re-throw a geometry-invariant error against preflight dims — the invariant is enforced inside
    // inferUpscaledRGBA against decoded dims. Result must track the decoded basis.
    nextBitmap = { width: 8, height: 10 };
    const input = pngWithDims(10, 8);
    const result = await upscaleImageData(input, "png", { ...DEFAULT_PREFS, scale: 2 }, undefined, {
      loadUpscaler: stubLoad,
    });
    expect(result.width).toBe(16); // decoded 8 × 2
    expect(result.height).toBe(20); // decoded 10 × 2
  });

  it("streams upscaling progress via onProgress", async () => {
    nextBitmap = { width: 4, height: 4 };
    const input = pngWithDims(4, 4);
    const stages: string[] = [];
    await inferUpscaledRGBA(input, "png", 2, (p) => stages.push(p.stage), {
      loadUpscaler: stubLoad,
    });
    expect(stages).toContain("upscaling");
  });

  it("OUTPUT-cap rejection — AREA-bust (3000×2000 ×2 = 24 MP > 16.7 MP)", async () => {
    const input = pngWithDims(3000, 2000);
    await expect(
      inferUpscaledRGBA(input, "png", 2, undefined, { loadUpscaler: stubLoad }),
    ).rejects.toThrow(/too large to upscale/i);
    await expect(
      upscaleImageData(input, "png", { ...DEFAULT_PREFS, scale: 2 }, undefined, {
        loadUpscaler: stubLoad,
      }),
    ).rejects.toThrow(/canvas limit/i);
  });

  it("OUTPUT-cap rejection — SIDE-bust (5000×100 ×2 = 10000 px > 8192)", async () => {
    const input = pngWithDims(5000, 100);
    await expect(
      inferUpscaledRGBA(input, "png", 2, undefined, { loadUpscaler: stubLoad }),
    ).rejects.toThrow(/8192px\/side/i);
  });
});
