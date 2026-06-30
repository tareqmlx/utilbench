import { MAX_CANVAS_AREA, readImageDims } from "@/lib/image";
import type { NormFormat } from "@/lib/image";
import type { InferenceSession, Tensor } from "onnxruntime-web";
// Pure inference / pre / post / composite logic for background-remover (plan §5.3).
// Runs INSIDE the dedicated worker — DOM-free beyond OffscreenCanvas / createImageBitmap /
// the Cache API. NO React. `remove.worker.ts` imports this; unit tests inject a stub
// `loadSession` (via the `deps` seam) to exercise pre/post/composite without real ORT.
// Keeping the `onnxruntime-web` import HERE — in a module Route.tsx never imports — keeps the
// ORT/WASM graph off the main bundle (plan §3.1).
//
// EP NOTE (v1): WASM-only. The `/webgpu` (JSEP) runtime wasm is 25.58 MiB — over Cloudflare
// Workers Assets' 25 MiB per-file cap — AND webgpu-in-worker is unverifiable here (plan §15 #2),
// so v1 ships the `onnxruntime-web/wasm` entry (single `ort-wasm-simd-threaded.wasm`, 12.85 MiB,
// the only EP we have empirically verified — plan §2.4 "WASM-SIMD is the safe floor", §15 #3).
// WebGPU is deferred to v1.1 (would need wasm-chunking + `ort.env.wasm.wasmBinary` to fit the cap).
//
// Pipeline (rembg-faithful, verified against the real u2netp model — plan §2.5/§5.3):
//   preprocess  = stretch → f=v/255 → divide by max-over-all-samples (clamp 1e-6) → (f−mean)/std → NCHW
//   postprocess = squeeze output[0] → min-max normalize (NOT sigmoid, degenerate→all-zero) → upscale
//   composite   = apply mask as alpha / flatten over a color / grayscale matte, then encode
import * as ort from "onnxruntime-web/wasm";
import {
  ACTIVE_VARIANT,
  MODELS,
  type ModelSpec,
  type ModelVariant,
  type RemoveOptions,
  type RemoveResult,
} from "./remover-types";

// ── Progress callbacks ──────────────────────────────────────────────────────
/** Raw byte progress emitted by {@link fetchModelWithProgress}. */
export type DownloadProgress = { current: number; total: number };
/** Stage-tagged progress the worker forwards to the UI bar (plan §6.1). */
export type StageProgress = { stage: string; current: number; total: number };

const MODEL_CACHE_NAME = "background-remover-models";

// ── ORT environment (configure EXACTLY ONCE — plan §5.3) ─────────────────────
let configured = false;

/**
 * Idempotently pin ORT's runtime config. Set ONCE, before the first
 * `InferenceSession.create`, never scattered per-call (mutating `ort.env` after init
 * is fragile — plan §5.3):
 *  - `wasm.wasmPaths` → the same-origin `/ort/` PREFIX (staged by `copy:ort`). The plan's
 *    "object form keyed by filename" is stale for ORT ≥1.21 (the `WasmFilePaths` type is now
 *    only `{ wasm, mjs }`); the prefix form resolves whichever runtime filename the `wasm`
 *    build requests against `/ort/`, where the two staged files live. NEVER jsDelivr
 *    (plan §2.4/§10.5).
 *  - `numThreads = 1` + `proxy = false`: ORT ships a THREADED simd binary, but with no
 *    COOP/COEP (plan §2.4) SharedArrayBuffer is unavailable — force single-thread so ORT
 *    never attempts the SAB path. "Threaded binary, run single-threaded."
 */
export function configureOrt(): void {
  if (configured) return;
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  configured = true;
}

// ── Model weights (streamed, Cache-API-cached — plan §6.1) ───────────────────
/**
 * Fetch the model weights with byte progress, caching the assembled bytes in a named Cache
 * (`background-remover-models`) so the download happens exactly ONCE (HTTP immutable cache can
 * be evicted under storage pressure, esp. Safari — plan §6.1).
 *
 * `url` is `string` (candidate A `u2netp`, one file) OR `string[]` (candidate B chunked int8
 * ISNet — N <25 MiB parts, §2.2/§3.3): for the array path every part is fetched in order, their
 * Content-Lengths summed for `total`, `current` accumulated ACROSS all parts, and the part buffers
 * CONCATENATED into a SINGLE ArrayBuffer before `InferenceSession.create`. Cache key = the manifest
 * identity (joined URLs) so a chunked model also downloads once.
 */
export async function fetchModelWithProgress(
  url: string | string[],
  onProgress?: (p: DownloadProgress) => void,
): Promise<ArrayBuffer> {
  const urls = Array.isArray(url) ? url : [url];
  const cacheKey = urls.join("|"); // stable manifest identity (one URL → the URL itself)

  const cache = typeof caches !== "undefined" ? await caches.open(MODEL_CACHE_NAME) : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.arrayBuffer();
  }

  // First pass: open every part to read Content-Length → `total` (so the bar is honest from the
  // first byte). fetch() resolves on headers; bodies stream lazily in the second pass.
  const responses: Response[] = [];
  let total = 0;
  for (const u of urls) {
    const res = await fetch(u);
    if (!res.ok || !res.body) {
      throw new Error(
        `Couldn't load the AI model (${res.status}). Check your connection and retry.`,
      );
    }
    responses.push(res);
    total += Number(res.headers.get("Content-Length") ?? 0);
  }

  // Second pass: stream each body, accumulating `current` across all parts.
  const parts: Uint8Array[] = [];
  let current = 0;
  for (const res of responses) {
    const body = res.body;
    if (!body) continue; // already validated in pass 1; narrows the type for the reader
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      current += value.byteLength;
      onProgress?.({ current, total });
    }
  }

  // Concat parts → one ArrayBuffer.
  const totalBytes = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const assembled = new Uint8Array(totalBytes);
  let offset = 0;
  for (const p of parts) {
    assembled.set(p, offset);
    offset += p.byteLength;
  }

  if (cache) {
    await cache.put(
      cacheKey,
      new Response(assembled, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(totalBytes),
        },
      }),
    );
  }
  return assembled.buffer as ArrayBuffer;
}

// ── Session (cached per variant — plan §5.3) ─────────────────────────────────
const sessionCache = new Map<ModelVariant, Promise<InferenceSession>>();

async function createSession(
  variant: ModelVariant,
  onProgress?: (p: DownloadProgress) => void,
): Promise<InferenceSession> {
  const spec = MODELS[variant];
  if (!spec) {
    throw new Error(
      `No model registered for variant "${variant}". Build/config error (plan §5.1).`,
    );
  }
  configureOrt();
  const buffer = await fetchModelWithProgress(spec.url, onProgress);
  // WASM-only EP (v1): the single verified, deployable path — webgpu wasm busts the 25 MiB
  // Workers Assets cap and is unverifiable in-worker here (plan §2.4/§15 #2). v1.1 = WebGPU.
  return ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"] as InferenceSession.SessionOptions["executionProviders"],
  });
}

/**
 * Load (or reuse) the ORT session for `variant`. Cached per variant so it is NOT re-created per
 * image — kept alive across a batch (plan §5.3). The cache holds the PROMISE so concurrent callers
 * share one download; a failed create is evicted so a later retry can re-attempt.
 */
export function loadSession(
  variant: ModelVariant = ACTIVE_VARIANT,
  onProgress?: (p: DownloadProgress) => void,
): Promise<InferenceSession> {
  let pending = sessionCache.get(variant);
  if (!pending) {
    pending = createSession(variant, onProgress).catch((err) => {
      sessionCache.delete(variant);
      throw err;
    });
    sessionCache.set(variant, pending);
  }
  return pending;
}

// ── OffscreenCanvas helpers ──────────────────────────────────────────────────
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

// ── Preprocess (rembg-faithful — plan §5.3 step 3) ───────────────────────────
/**
 * STRETCH `srcRGBA` to the model's square input (no letterbox — rembg stretches; the caller holds
 * the src W/H for the inverse map), then normalize: per RGB sample `f = v/255`; divide by the
 * max over ALL samples (clamp 1e-6 — algebraically `v/max(v)`, exactly rembg's `im/np.max(im)`);
 * `(f − mean[c]) / std[c]`; pack NCHW `[1,3,size,size]`.
 */
export function preprocess(
  srcRGBA: ImageData,
  spec: ModelSpec,
): { tensorData: Float32Array; dims: [1, 3, number, number] } {
  const { inputSize, mean, std } = spec;

  // Stretch src → inputSize² (high-quality resample).
  const srcCanvas = new OffscreenCanvas(srcRGBA.width, srcRGBA.height);
  get2d(srcCanvas).putImageData(srcRGBA, 0, 0);
  const dstCanvas = new OffscreenCanvas(inputSize, inputSize);
  const dctx = get2d(dstCanvas);
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(srcCanvas, 0, 0, srcRGBA.width, srcRGBA.height, 0, 0, inputSize, inputSize);
  const resized = dctx.getImageData(0, 0, inputSize, inputSize).data;
  disposeCanvas(srcCanvas);
  disposeCanvas(dstCanvas);

  const n = inputSize * inputSize;

  // Pass 1: max over all R/G/B samples (as f=v/255), clamped to 1e-6.
  let mx = 1e-6;
  for (let i = 0; i < n; i++) {
    const r = (resized[i * 4] ?? 0) / 255;
    const g = (resized[i * 4 + 1] ?? 0) / 255;
    const b = (resized[i * 4 + 2] ?? 0) / 255;
    if (r > mx) mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
  }

  // Pass 2: divide-by-max → (f−mean)/std → NCHW.
  const tensorData = new Float32Array(3 * n);
  const [mr, mg, mb] = mean;
  const [sr, sg, sb] = std;
  for (let i = 0; i < n; i++) {
    const r = (resized[i * 4] ?? 0) / 255 / mx;
    const g = (resized[i * 4 + 1] ?? 0) / 255 / mx;
    const b = (resized[i * 4 + 2] ?? 0) / 255 / mx;
    tensorData[i] = (r - mr) / sr; // R plane
    tensorData[n + i] = (g - mg) / sg; // G plane
    tensorData[2 * n + i] = (b - mb) / sb; // B plane
  }

  return { tensorData, dims: [1, 3, inputSize, inputSize] };
}

// ── Postprocess (min-max, NOT sigmoid — plan §5.3 step 5) ────────────────────
/**
 * Squeeze the model's first output map to `inputSize²`, min-max normalize to [0,1] (NaN-guarded:
 * a uniform output where `(max−min) < 1e-6` → an all-zero / empty matte, never a NaN divide), then
 * upscale (stretch) to `outW × outH` via a high-quality OffscreenCanvas resample. Returns a full-res
 * Float32 mask in [0,1]. The 8-bit canvas resample is acceptable per plan (true-LANCZOS parity is a
 * deferred spike note); the output alpha is 8-bit anyway.
 */
export function postprocessMask(
  raw: Float32Array | { length: number; [index: number]: number },
  inputSize: number,
  outW: number,
  outH: number,
): Float32Array {
  const n = inputSize * inputSize;

  let mi = Number.POSITIVE_INFINITY;
  let ma = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = raw[i] ?? 0;
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const range = ma - mi;

  // Degenerate output → empty matte (don't divide by ~0).
  if (!(range >= 1e-6)) {
    return new Float32Array(outW * outH); // all zeros
  }

  // Pack normalized mask into an inputSize² grayscale ImageData for the canvas resample.
  const small = new ImageData(inputSize, inputSize);
  const sd = small.data;
  for (let i = 0; i < n; i++) {
    const v = Math.round((((raw[i] ?? 0) - mi) / range) * 255);
    sd[i * 4] = v;
    sd[i * 4 + 1] = v;
    sd[i * 4 + 2] = v;
    sd[i * 4 + 3] = 255;
  }

  const smallCanvas = new OffscreenCanvas(inputSize, inputSize);
  get2d(smallCanvas).putImageData(small, 0, 0);
  const bigCanvas = new OffscreenCanvas(outW, outH);
  const bctx = get2d(bigCanvas);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(smallCanvas, 0, 0, inputSize, inputSize, 0, 0, outW, outH);
  const up = bctx.getImageData(0, 0, outW, outH).data;
  disposeCanvas(smallCanvas);
  disposeCanvas(bigCanvas);

  const mask = new Float32Array(outW * outH);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (up[i * 4] ?? 0) / 255; // read back the (grayscale) R channel
  }
  return mask;
}

// ── Encode ───────────────────────────────────────────────────────────────────
async function canvasEncode(img: ImageData, mime: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  get2d(canvas).putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: mime });
  const buffer = await blob.arrayBuffer();
  disposeCanvas(canvas);
  return new Uint8Array(buffer);
}

// ── Composite + encode (the CHEAP half — re-run on every knob tweak) ─────────
/**
 * Apply `fullResMask` to `srcRGBA` per `opts.outputMode`, then encode. Split from inference so a
 * threshold / output-mode / color / format tweak re-composites WITHOUT re-inferring (plan §5.3).
 *
 *  - `alphaThreshold` 0 → soft matte (keep AA); t>0 → binary at t/255.
 *  - `transparent` → RGB kept, A = mask·255.   `color` → flatten RGB·mask over backgroundColor, A=255.
 *    `mask` → grayscale luminance = mask·255, A=255.
 *  - encode: png+"download" → @jsquash/oxipng (small, level 2; convertToBlob fallback if it throws);
 *    png+"preview" → convertToBlob (fast); webp → convertToBlob. NO JPEG.
 */
export async function compositeFromMask(
  srcRGBA: ImageData,
  fullResMask: Float32Array,
  opts: RemoveOptions,
  encodeIntent: "preview" | "download",
): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const { width, height } = srcRGBA;
  const src = srcRGBA.data;
  const out = new Uint8ClampedArray(width * height * 4);

  const useThreshold = opts.alphaThreshold > 0;
  const thr = opts.alphaThreshold / 255;
  const bg = parseHexColor(opts.backgroundColor);

  for (let i = 0; i < width * height; i++) {
    let m = fullResMask[i] ?? 0;
    if (useThreshold) m = m >= thr ? 1 : 0;
    const r = src[i * 4] ?? 0;
    const g = src[i * 4 + 1] ?? 0;
    const b = src[i * 4 + 2] ?? 0;
    const o = i * 4;
    if (opts.outputMode === "transparent") {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(m * 255);
    } else if (opts.outputMode === "color") {
      const inv = 1 - m;
      out[o] = Math.round(r * m + bg.r * inv);
      out[o + 1] = Math.round(g * m + bg.g * inv);
      out[o + 2] = Math.round(b * m + bg.b * inv);
      out[o + 3] = 255;
    } else {
      const v = Math.round(m * 255);
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }

  const composite = new ImageData(out, width, height);

  if (opts.format === "png") {
    if (encodeIntent === "download") {
      try {
        const optimise = (await import("@jsquash/oxipng/optimise")).default as (
          data: ImageData | ArrayBuffer,
          opts?: { level?: number },
        ) => Promise<ArrayBuffer>;
        const buffer = await optimise(composite, { level: 2 });
        return { bytes: new Uint8Array(buffer), mime: "image/png", ext: "png" };
      } catch (err) {
        // oxipng failed — fall back to the fast canvas encode below. Surface it (don't swallow
        // silently): a regression here means downloads/batch zips quietly ship fat PNGs.
        console.warn("oxipng optimise failed; falling back to canvas PNG encode:", err);
      }
    }
    return { bytes: await canvasEncode(composite, "image/png"), mime: "image/png", ext: "png" };
  }

  // webp (alpha-preserving). Encode via @jsquash/webp — real VP8/VP8L bytes on EVERY engine. Do NOT
  // use canvas.convertToBlob({type:"image/webp"}): on WebKit/WKWebView that type is unsupported and the
  // spec mandates a silent fallback to image/png, so we'd ship a `.webp` file holding a PNG payload
  // (cursor r3 #1). jSquash's encoder keeps the alpha channel, which the cutout depends on.
  const encodeWebp = (await import("@jsquash/webp/encode")).default as (
    data: ImageData,
  ) => Promise<ArrayBuffer>;
  const webp = await encodeWebp(composite);
  return { bytes: new Uint8Array(webp), mime: "image/webp", ext: "webp" };
}

// ── Orchestration (the EXPENSIVE half — decode + infer + upscale) ────────────
/**
 * Decode → preprocess → infer → postprocess → composite (plan §5.3 steps 1–8). Returns the
 * `RemoveResult` PLUS `srcRGBA` + `fullResMask` so the worker can cache them for a later cheap
 * `recomposite`. `deps` is the test/worker seam: `loadSession` is injectable (tests stub ORT) and
 * `onProgress` forwards the weight-download bar (plan §3.1/§6.1).
 */
export async function removeBackgroundFromBytes(
  input: Uint8Array,
  inputFormat: NormFormat,
  opts: RemoveOptions,
  encodeIntent: "preview" | "download" = "preview",
  deps: {
    loadSession?: typeof loadSession;
    onProgress?: (p: StageProgress) => void;
  } = {},
): Promise<{ result: RemoveResult; srcRGBA: ImageData; fullResMask: Float32Array }> {
  const load = deps.loadSession ?? loadSession;

  // 1. PREFLIGHT dims (header peek — cheap, OOM-safe). AVIF may throw if `ispe` is absent →
  //    fall back to createImageBitmap dims (plan §5.3 step 1).
  let dims: { width: number; height: number };
  try {
    dims = readImageDims(input, inputFormat);
  } catch (err) {
    if (inputFormat === "avif") {
      const probe = await createImageBitmap(new Blob([input as BlobPart]));
      dims = { width: probe.width, height: probe.height };
      probe.close();
    } else {
      throw err;
    }
  }
  if (dims.width * dims.height > MAX_CANVAS_AREA) {
    throw new Error("Image too large to process in your browser (over ~16 MP).");
  }

  // 2. DECODE full-res → srcRGBA (EXIF-oriented, non-premultiplied).
  const bitmap = await createImageBitmap(new Blob([input as BlobPart]), {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  let srcRGBA: ImageData;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    get2d(canvas).drawImage(bitmap, 0, 0);
    srcRGBA = get2d(canvas).getImageData(0, 0, bitmap.width, bitmap.height);
    disposeCanvas(canvas);
  } finally {
    bitmap.close();
  }

  // 3. PREPROCESS (resolve the spec once for pre + post).
  const spec = MODELS[ACTIVE_VARIANT];
  if (!spec) {
    throw new Error(`No model registered for variant "${ACTIVE_VARIANT}". Build/config error.`);
  }
  const { tensorData, dims: tensorDims } = preprocess(srcRGBA, spec);

  // 4. INFER → take output[0].
  const session = await load(ACTIVE_VARIANT, (p) =>
    deps.onProgress?.({ stage: "download", current: p.current, total: p.total }),
  );
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model exposes no input tensor.");
  const tensor: Tensor = new ort.Tensor("float32", tensorData, tensorDims);
  const outputs = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0];
  if (!outputName) throw new Error("Model exposes no output tensor.");
  const outputTensor = outputs[outputName];
  if (!outputTensor) throw new Error("Model produced no output map.");
  const raw = outputTensor.data as Float32Array;

  // 5. POSTPROCESS → full-res mask.
  const fullResMask = postprocessMask(raw, spec.inputSize, srcRGBA.width, srcRGBA.height);

  // 6 + 7. COMPOSITE + ENCODE.
  const encoded = await compositeFromMask(srcRGBA, fullResMask, opts, encodeIntent);

  // 8. GEOMETRY invariant — output dims === input dims, always.
  const result: RemoveResult = {
    bytes: encoded.bytes,
    mime: encoded.mime,
    ext: encoded.ext,
    outputSize: encoded.bytes.length,
    width: srcRGBA.width,
    height: srcRGBA.height,
  };
  if (result.width !== srcRGBA.width || result.height !== srcRGBA.height) {
    throw new Error("Geometry invariant violated: output dimensions changed.");
  }

  return { result, srcRGBA, fullResMask };
}
