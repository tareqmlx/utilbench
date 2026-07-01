import { clampToCanvasLimits, readImageDims } from "@/lib/image";
import type { NormFormat } from "@/lib/image";
// Pure inference / decode / alpha / encode logic for image-upscaler (plan §5.3). Runs INSIDE the
// dedicated worker — DOM-free beyond OffscreenCanvas / createImageBitmap. NO React. `upscale.worker.ts`
// imports this; unit tests inject a stub `loadUpscaler` (via the `deps` seam) to exercise the pipeline
// without real UpscalerJS / TF.js. Keeping the dynamic `import("upscaler")` + `import("@tensorflow/tfjs")`
// + model imports HERE — in a module Route.tsx never imports — keeps the TF.js graph off the main bundle
// (plan §3.1). ESRGAN is RGB-only, so alpha is split off, bicubic-upscaled separately, and recombined
// (plan §Alpha / §5.3 step 5). The load-bearing OUTPUT-cap gate (geometry MULTIPLIES) fires before decode.
import {
  FORMAT_EXT,
  FORMAT_MIME,
  MODELS,
  type OutputFormat,
  type ScaleFactor,
  TILE_PADDING,
  TILE_SIZE,
  type UpscaleOptions,
  type UpscaleResult,
} from "./upscaler-types";

// ── Progress ─────────────────────────────────────────────────────────────────
/** Stage-tagged progress the worker forwards to the UI bar (plan §6.1). */
export type StageProgress = { stage: string; current: number; total: number };

// ── UpscalerJS structural seam ───────────────────────────────────────────────
/** Options passed to a single `upscale` run (UpscalerJS patch/tiling knobs — plan §5.3 step 4). */
export interface UpscaleRunOptions {
  patchSize: number;
  padding: number;
  output: "tensor";
  progress?: (rate: number) => void;
}

/**
 * The output of an `upscale` run. In the real path this is a TF.js `Tensor3D` shaped `[outH, outW, 3]`
 * in 0..255 (exposes `shape`, async `data()` / sync `dataSync()`, and `dispose()`). We also accept a
 * plain RGBA `ImageData` so the shape is forgiving to the (browser-only) runtime semantics of
 * UpscalerJS's `output: "tensor"` option (marked OPEN). Read defensively.
 */
export interface UpscaleTensor {
  shape: number[];
  data?: () => Promise<ArrayLike<number>>;
  dataSync?: () => ArrayLike<number>;
  dispose?: () => void;
}
export type UpscaleOutput = UpscaleTensor | ImageData;

/**
 * Minimal structural type for a loaded upscaler so tests can stub it without real UpscalerJS/TF.js.
 * The REAL {@link loadUpscaler} returns a thin wrapper around `new Upscaler({ model })` whose `upscale`
 * builds the input `tf.Tensor3D` via `tf.browser.fromPixels(rgb)` and disposes it — keeping ALL TF.js
 * usage inside the (untested, browser-only) loader. `inferUpscaledRGBA` only reads + disposes the output.
 */
export interface UpscalerLike {
  upscale(input: ImageData, opts: UpscaleRunOptions): Promise<UpscaleOutput>;
}

// ── OffscreenCanvas helpers (mirror remover-core) ────────────────────────────
function get2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Couldn't get a 2D canvas context in this browser.");
  return ctx;
}

function disposeCanvas(canvas: OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Parse `#rgb` / `#rrggbb` → 0–255 RGB; falls back to white on anything unparseable. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  let h = m[1] ?? "";
  if (h.length === 3) h = h.replace(/./g, (c) => c + c); // #rgb → #rrggbb
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

/** Clamp + round a float channel value to a valid 0..255 byte (defensive tensor read — plan §5.3 step 4). */
function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

// ── TF.js runtime (configure EXACTLY ONCE — plan §5.3) ───────────────────────
interface TfRuntime {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
}
let configured = false;

/**
 * Idempotently pick the TF.js backend: WebGL first (the source's "preferred"), falling back to the
 * pure-JS CPU floor when WebGL is unavailable (plan §2.3/§5.3). Guarded by a module-scope flag so it
 * runs once before the first `new Upscaler`, never per-image.
 */
async function configureTf(tf: TfRuntime): Promise<void> {
  if (configured) return;
  // tf.setBackend RESOLVES `false` (it does NOT throw) when a backend can't be activated — e.g. WebGL
  // unavailable in this worker/device. Checking only for a thrown error would let a `false` slip past
  // and leave TF.js with no active backend (the first fromPixels then throws cryptically). So gate on
  // the boolean AND the catch, and only then fall back to the always-registered CPU backend (§2.3/§5.3).
  let webgl = false;
  try {
    webgl = await tf.setBackend("webgl");
  } catch {
    webgl = false;
  }
  if (!webgl) await tf.setBackend("cpu");
  await tf.ready();
  configured = true;
}

// ── Upscaler (cached per scale — plan §5.3) ──────────────────────────────────
const upscalerCache = new Map<ScaleFactor, Promise<UpscalerLike>>();

async function createUpscaler(scale: ScaleFactor): Promise<UpscalerLike> {
  // Dynamic imports keyed on `scale` so ONLY the selected scale's weights download; do NOT statically
  // import both 2x and 4x. Held here so Route never pulls TF.js into its bundle (plan §3.1).
  const { default: Upscaler } = await import("upscaler");
  const tf = (await import("@tensorflow/tfjs")) as unknown as TfRuntime & {
    browser: { fromPixels(pixels: ImageData): { dispose(): void } };
  };
  await configureTf(tf);

  // Force SAME-ORIGIN weights: UpscalerJS's fetchModel uses a model definition's TOP-LEVEL `path`
  // directly and only falls back to the jsDelivr/unpkg CDN when none is set. The esrgan-slim default
  // export has no top-level path, so we splice in the staged same-origin URL (plan §3.3/§10.5).
  const modelModule =
    scale === 4
      ? await import("@upscalerjs/esrgan-slim/4x")
      : await import("@upscalerjs/esrgan-slim/2x");
  const model = { ...modelModule.default, path: MODELS[scale].path };
  const upscaler = new Upscaler({ model }) as {
    upscale(input: unknown, opts: unknown): Promise<UpscaleOutput>;
  };

  // Thin wrapper: build the input tensor via tf.browser.fromPixels (UpscalerJS wants a Tensor3D — plan
  // §5.3 step 4), run, and ALWAYS dispose that input tensor (the #1 TF.js leak footgun — §7.2). The
  // OUTPUT tensor is read + disposed by inferUpscaledRGBA.
  return {
    async upscale(rgb: ImageData, opts: UpscaleRunOptions): Promise<UpscaleOutput> {
      const inputTensor = tf.browser.fromPixels(rgb);
      try {
        return await upscaler.upscale(inputTensor as unknown as ImageData, opts);
      } finally {
        inputTensor.dispose();
      }
    },
  };
}

/**
 * Load (or reuse) the UpscalerJS instance for `scale`. Cached per scale so it is NOT re-created per
 * image — kept alive across a batch (plan §5.3). The cache holds the PROMISE so concurrent callers share
 * one download; a failed create is evicted so a later retry can re-attempt (mirrors remover-core).
 */
export function loadUpscaler(scale: ScaleFactor): Promise<UpscalerLike> {
  let pending = upscalerCache.get(scale);
  if (!pending) {
    pending = createUpscaler(scale).catch((err) => {
      upscalerCache.delete(scale);
      throw err;
    });
    upscalerCache.set(scale, pending);
  }
  return pending;
}

// ── Alpha split / recombine (pure — unit-testable without TF.js) ─────────────
/**
 * Split `src` into an opaque RGB {@link ImageData} (A forced to 255) and its alpha plane. Returns
 * `alpha === null` when the source is fully opaque (every A === 255) so the caller can skip the separate
 * alpha upscale (plan §5.3 step 3).
 */
export function splitAlpha(src: ImageData): { rgb: ImageData; alpha: Uint8ClampedArray | null } {
  const { width, height } = src;
  const s = src.data;
  const n = width * height;
  const rgbData = new Uint8ClampedArray(n * 4);
  const alpha = new Uint8ClampedArray(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    const a = s[i * 4 + 3] ?? 255;
    rgbData[i * 4] = s[i * 4] ?? 0;
    rgbData[i * 4 + 1] = s[i * 4 + 1] ?? 0;
    rgbData[i * 4 + 2] = s[i * 4 + 2] ?? 0;
    rgbData[i * 4 + 3] = 255;
    alpha[i] = a;
    if (a !== 255) hasAlpha = true;
  }
  return { rgb: new ImageData(rgbData, width, height), alpha: hasAlpha ? alpha : null };
}

/**
 * Bicubic-resample the `w×h` alpha plane to `(w·scale)×(h·scale)` via an OffscreenCanvas with
 * `imageSmoothingQuality:"high"` (plan §5.3 step 5 — committed, NOT run through the RGB model). Returns
 * a `(w·scale)·(h·scale)` alpha plane.
 */
export function upscaleAlphaPlane(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  scale: ScaleFactor,
): Uint8ClampedArray {
  const outW = w * scale;
  const outH = h * scale;

  // Pack the alpha plane into a grayscale ImageData for the canvas resample.
  const small = new ImageData(w, h);
  const sd = small.data;
  for (let i = 0; i < w * h; i++) {
    const v = alpha[i] ?? 0;
    sd[i * 4] = v;
    sd[i * 4 + 1] = v;
    sd[i * 4 + 2] = v;
    sd[i * 4 + 3] = 255;
  }

  const smallCanvas = new OffscreenCanvas(w, h);
  get2d(smallCanvas).putImageData(small, 0, 0);
  const bigCanvas = new OffscreenCanvas(outW, outH);
  const bctx = get2d(bigCanvas);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(smallCanvas, 0, 0, w, h, 0, 0, outW, outH);
  const up = bctx.getImageData(0, 0, outW, outH).data;
  disposeCanvas(smallCanvas);
  disposeCanvas(bigCanvas);

  const out = new Uint8ClampedArray(outW * outH);
  for (let i = 0; i < out.length; i++) out[i] = up[i * 4] ?? 0; // read back the (grayscale) R channel
  return out;
}

/**
 * Recombine an RGB {@link ImageData} with an alpha plane (or 255 when `alpha === null`) into an RGBA
 * ImageData. Throws when the alpha plane's length does not match `rgb.width · rgb.height` (plan §5.3 step 6).
 */
export function recombine(rgb: ImageData, alpha: Uint8ClampedArray | null): ImageData {
  const { width, height } = rgb;
  const n = width * height;
  if (alpha && alpha.length !== n) {
    throw new Error(
      `Geometry mismatch: alpha plane length ${alpha.length} !== ${width}×${height} = ${n}.`,
    );
  }
  const r = rgb.data;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r[i * 4] ?? 0;
    out[i * 4 + 1] = r[i * 4 + 1] ?? 0;
    out[i * 4 + 2] = r[i * 4 + 2] ?? 0;
    out[i * 4 + 3] = alpha ? (alpha[i] ?? 255) : 255;
  }
  return new ImageData(out, width, height);
}

// ── Defensive tensor → RGBA read ─────────────────────────────────────────────
function isImageDataLike(o: UpscaleOutput): o is ImageData {
  return (
    typeof o === "object" &&
    o !== null &&
    "width" in o &&
    "height" in o &&
    (o as ImageData).data instanceof Uint8ClampedArray
  );
}

/**
 * Convert an {@link UpscaleOutput} to an opaque RGBA {@link ImageData} (A = 255). Handles a plain RGBA
 * ImageData OR a TF.js-shaped tensor `[outH, outW, C]` in 0..255, reading via async `data()` then
 * `dataSync()`, clamping/rounding each channel. Disposes the tensor after read (plan §5.3 step 4/§7.2).
 */
async function outputToRgb(output: UpscaleOutput): Promise<ImageData> {
  if (isImageDataLike(output)) return output;

  const t = output;
  const h = t.shape[0] ?? 0;
  const w = t.shape[1] ?? 0;
  const c = t.shape[2] ?? 3;
  let raw: ArrayLike<number>;
  if (typeof t.data === "function") raw = await t.data();
  else if (typeof t.dataSync === "function") raw = t.dataSync();
  else throw new Error("The upscaler returned a tensor with no readable data.");

  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = clamp255(raw[i * c] ?? 0);
    rgba[i * 4 + 1] = clamp255(raw[i * c + 1] ?? 0);
    rgba[i * 4 + 2] = clamp255(raw[i * c + 2] ?? 0);
    rgba[i * 4 + 3] = 255;
  }
  try {
    t.dispose?.();
  } catch {
    // best-effort tensor disposal — never let a dispose throw mask a successful upscale.
  }
  return new ImageData(rgba, w, h);
}

// ── Dimension preflight ──────────────────────────────────────────────────────
/**
 * Read pixel dims from the header bytes (cheap, OOM-safe). AVIF may throw if `ispe` is absent → fall
 * back to createImageBitmap dims, exactly as remover-core does (plan §5.3 step 1).
 */
async function preflightDims(
  input: Uint8Array,
  inputFormat: NormFormat,
): Promise<{ width: number; height: number }> {
  try {
    return readImageDims(input, inputFormat);
  } catch (err) {
    if (inputFormat === "avif") {
      const probe = await createImageBitmap(new Blob([input as BlobPart]));
      const dims = { width: probe.width, height: probe.height };
      probe.close();
      return dims;
    }
    throw err;
  }
}

function outputCapMessage(scale: ScaleFactor): string {
  return `This image is too large to upscale ${scale}× (the result would exceed the in-browser canvas limit — 8192px/side or 16.7 MP). Try 2× or shrink the source in image-resizer first.`;
}

// ── Decode (full-res → srcRGBA) ──────────────────────────────────────────────
async function decodeToImageData(input: Uint8Array, inputFormat: NormFormat): Promise<ImageData> {
  try {
    const bitmap = await createImageBitmap(new Blob([input as BlobPart]), {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      get2d(canvas).drawImage(bitmap, 0, 0);
      const srcRGBA = get2d(canvas).getImageData(0, 0, bitmap.width, bitmap.height);
      disposeCanvas(canvas);
      return srcRGBA;
    } finally {
      bitmap.close();
    }
  } catch (err) {
    // AVIF fallback (parity with compressor-core): if createImageBitmap can't decode AND the input is
    // AVIF, decode via @jsquash/avif/decode → ImageData. Other formats: a decode throw is a real error.
    if (inputFormat === "avif") {
      const decode = (await import("@jsquash/avif/decode")).default as (
        buffer: ArrayBuffer,
      ) => Promise<ImageData>;
      const buffer = input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ) as ArrayBuffer;
      return decode(buffer);
    }
    throw err;
  }
}

// ── Inference (the EXPENSIVE, cached artifact — plan §5.3 steps 1–6) ──────────
/**
 * Decode → cap-gate → split alpha → upscale RGB (UpscalerJS) → bicubic-upscale alpha → recombine, into
 * the `outW×outH` RGBA {@link ImageData} the worker caches for a later cheap re-encode. `deps.loadUpscaler`
 * is the test/worker seam (tests stub UpscalerJS). The OUTPUT-cap gate (plan §10.2, load-bearing —
 * geometry MULTIPLIES) fires BEFORE decode/inference.
 */
export async function inferUpscaledRGBA(
  input: Uint8Array,
  inputFormat: NormFormat,
  scale: ScaleFactor,
  onProgress?: (p: StageProgress) => void,
  deps: { loadUpscaler?: typeof loadUpscaler } = {},
): Promise<ImageData> {
  const load = deps.loadUpscaler ?? loadUpscaler;

  // 1. PREFLIGHT + OUTPUT-CAP GATE (both ≤8192 px/side AND ≤16.7 MP area — the canvas ceiling; §10.2).
  const { width: w, height: h } = await preflightDims(input, inputFormat);
  if (clampToCanvasLimits(w * scale, h * scale).downscaled) {
    throw new Error(outputCapMessage(scale));
  }
  const outW = w * scale;
  const outH = h * scale;

  // 2. DECODE full-res → srcRGBA (EXIF-oriented, non-premultiplied).
  const srcRGBA = await decodeToImageData(input, inputFormat);

  // 3. SPLIT ALPHA (ESRGAN is RGB-only).
  const { rgb, alpha } = splitAlpha(srcRGBA);

  // 4. UPSCALE RGB via UpscalerJS (tiled internally; halo cropped, stitched → outW×outH RGB).
  const upscaler = await load(scale);
  const output = await upscaler.upscale(rgb, {
    patchSize: TILE_SIZE,
    padding: TILE_PADDING,
    output: "tensor",
    progress: (rate) => onProgress?.({ stage: "upscaling", current: rate, total: 1 }),
  });
  const rgbUp = await outputToRgb(output);

  // 5. UPSCALE ALPHA separately (bicubic) when present.
  const alphaUp = alpha ? upscaleAlphaPlane(alpha, w, h, scale) : null;

  // 6. RECOMBINE → outW×outH RGBA.
  const combined = recombine(rgbUp, alphaUp);
  if (combined.width !== outW || combined.height !== outH) {
    throw new Error(
      `Geometry invariant violated: upscaled to ${combined.width}×${combined.height}, expected ${outW}×${outH}.`,
    );
  }
  return combined;
}

// ── Encode (the CHEAP half — re-run on every format/quality tweak) ───────────
/**
 * Encode `upscaledRGBA` to PNG / WebP / JPEG on an OffscreenCanvas (`convertToBlob`, fast; oxipng on an
 * 8192² image is punishingly slow — plan §5.3 step 7). JPEG FLATTENS alpha over `backgroundColor` (no
 * alpha channel). Split from inference so a format/quality/bg tweak re-encodes WITHOUT re-inferring (§6.5).
 */
export async function encodeUpscaled(
  upscaledRGBA: ImageData,
  format: OutputFormat,
  quality: number,
  backgroundColor: string,
): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const { width, height } = upscaledRGBA;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = get2d(canvas);

  if (format === "jpeg") {
    // Flatten in JS over the background (putImageData REPLACES pixels — it does not composite alpha).
    const bg = parseHexColor(backgroundColor);
    const src = upscaledRGBA.data;
    const flat = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const a = (src[i * 4 + 3] ?? 255) / 255;
      const inv = 1 - a;
      flat[i * 4] = Math.round((src[i * 4] ?? 0) * a + bg.r * inv);
      flat[i * 4 + 1] = Math.round((src[i * 4 + 1] ?? 0) * a + bg.g * inv);
      flat[i * 4 + 2] = Math.round((src[i * 4 + 2] ?? 0) * a + bg.b * inv);
      flat[i * 4 + 3] = 255;
    }
    ctx.putImageData(new ImageData(flat, width, height), 0, 0);
  } else {
    ctx.putImageData(upscaledRGBA, 0, 0);
  }

  const blob = await canvas.convertToBlob(
    format === "png"
      ? { type: FORMAT_MIME.png }
      : { type: FORMAT_MIME[format], quality: quality / 100 },
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  disposeCanvas(canvas);
  return { bytes, mime: FORMAT_MIME[format], ext: FORMAT_EXT[format] };
}

// ── End-to-end convenience (infer + encode — plan §5.3 steps 1–8) ────────────
/**
 * Full pipeline: {@link inferUpscaledRGBA} + {@link encodeUpscaled}. Asserts the geometry invariant —
 * output dims === input dims × scale (the DEFINING property of this tool; §5.3 step 8) — and stamps the
 * applied `scale` onto the result.
 */
export async function upscaleImageData(
  input: Uint8Array,
  inputFormat: NormFormat,
  opts: UpscaleOptions,
  onProgress?: (p: StageProgress) => void,
  deps: { loadUpscaler?: typeof loadUpscaler } = {},
): Promise<UpscaleResult> {
  const { width: inW, height: inH } = await preflightDims(input, inputFormat);
  const upscaledRGBA = await inferUpscaledRGBA(input, inputFormat, opts.scale, onProgress, deps);

  if (upscaledRGBA.width !== inW * opts.scale || upscaledRGBA.height !== inH * opts.scale) {
    throw new Error(
      `Geometry invariant violated: ${upscaledRGBA.width}×${upscaledRGBA.height} !== ${inW * opts.scale}×${inH * opts.scale}.`,
    );
  }

  const encoded = await encodeUpscaled(
    upscaledRGBA,
    opts.format,
    opts.quality,
    opts.backgroundColor,
  );
  return {
    bytes: encoded.bytes,
    mime: encoded.mime,
    ext: encoded.ext,
    outputSize: encoded.bytes.length,
    scale: opts.scale,
    width: upscaledRGBA.width,
    height: upscaledRGBA.height,
  };
}
