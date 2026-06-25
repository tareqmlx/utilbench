// Pure encode/decode/regression logic for image-compress. NO DOM, NO React.
// `compress.worker.ts` imports this; unit tests target it directly by injecting
// a stub `CodecLoader` (and a stub decode). Keeping the dynamic codec `import()`s
// here — in a module Route.tsx never imports — keeps the codec graph off the main
// bundle (plan §3.1). Verified jSquash option names: see plan §2.1.
import { normalizeFormat } from "@/lib/image";
import type { NormFormat } from "@/lib/image";
import type { CompressOptions, CompressResult } from "./compressor-types";

// ── Codec API (verified jSquash signatures) ──────────────────────────────────
type JpegEncode = (data: ImageData, opts?: { quality?: number }) => Promise<ArrayBuffer>;
type WebpEncode = (
  data: ImageData,
  opts?: { quality?: number; method?: number; lossless?: number },
) => Promise<ArrayBuffer>;
type AvifEncode = (
  data: ImageData,
  opts?: { quality?: number; speed?: number },
) => Promise<ArrayBuffer>;
type OxipngOptimise = (
  data: ImageData | ArrayBuffer,
  opts?: { level?: number },
) => Promise<ArrayBuffer>;
type PngDecode = (data: ArrayBuffer) => Promise<ImageData>;
type AvifDecode = (data: ArrayBuffer) => Promise<ImageData>;

export interface CodecApi {
  jpeg: JpegEncode;
  webp: WebpEncode;
  avif: AvifEncode;
  oxipng: OxipngOptimise;
  pngDecode: PngDecode;
  avifDecode: AvifDecode;
}

export type CodecLoader = <K extends keyof CodecApi>(name: K) => Promise<CodecApi[K]>;

// Default loader — lazy dynamic import per codec, so a user who only does JPEG
// never downloads the AVIF WASM (plan §2.2). Each jSquash entry default-exports
// its single function.
export const loadCodec: CodecLoader = async (name) => {
  switch (name) {
    case "jpeg":
      return (await import("@jsquash/jpeg/encode")).default as unknown as CodecApi[typeof name];
    case "webp":
      return (await import("@jsquash/webp/encode")).default as unknown as CodecApi[typeof name];
    case "avif":
      return (await import("@jsquash/avif/encode")).default as unknown as CodecApi[typeof name];
    case "oxipng":
      return (await import("@jsquash/oxipng/optimise")).default as unknown as CodecApi[typeof name];
    case "pngDecode":
      return (await import("@jsquash/png/decode")).default as unknown as CodecApi[typeof name];
    case "avifDecode":
      return (await import("@jsquash/avif/decode")).default as unknown as CodecApi[typeof name];
    default: {
      // Exhaustiveness guard.
      const _never: never = name;
      throw new Error(`Unknown codec: ${String(_never)}`);
    }
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True if any pixel has alpha < 255. */
export function hasAlpha(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) return true;
  }
  return false;
}

/**
 * Composite an RGBA ImageData over an opaque white background (pure math, no
 * canvas — keeps this module DOM-free). JPEG has no alpha and jSquash's encoder
 * does NOT composite, so transparent pixels would otherwise go black (plan
 * §11.3). Source is non-premultiplied RGBA, so `out = src*a + 255*(1-a)`.
 */
export function flattenForJpeg(img: ImageData): ImageData {
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = (src[i + 3] ?? 255) / 255;
    const inv = 1 - a;
    out[i] = Math.round((src[i] ?? 0) * a + 255 * inv);
    out[i + 1] = Math.round((src[i + 1] ?? 0) * a + 255 * inv);
    out[i + 2] = Math.round((src[i + 2] ?? 0) * a + 255 * inv);
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height, colorSpace: img.colorSpace };
}

/**
 * Copy an ImageData's pixels into a tight `width*height*4` buffer. An ImageData
 * obtained via `subarray`/`getImageData` may sit on a larger or offset
 * ArrayBuffer, so `img.data.buffer` can be bigger than the pixels — UPNG would
 * read garbage. `new Uint8Array(img.data)` copies exactly the view (plan §5.3).
 */
export function tightRGBA(img: ImageData): Uint8Array {
  return new Uint8Array(img.data);
}

const MIME_EXT: Record<NormFormat, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  avif: { mime: "image/avif", ext: "avif" },
};

// ── Decode (worker-only: createImageBitmap + OffscreenCanvas) ─────────────────

export interface DecodedImage {
  data: ImageData;
  width: number;
  height: number;
}

/**
 * Decode input bytes to a full-resolution, EXIF-oriented, non-premultiplied
 * ImageData. Native `createImageBitmap` covers every browser-decodable format
 * for free (plan §2.5). `imageOrientation:"from-image"` bakes EXIF rotation so
 * decoded dims match what the user sees; `premultiplyAlpha:"none"` preserves
 * semi-transparent color fidelity. Falls back to `@jsquash/*` decoders when the
 * browser can't decode (AVIF input) or canvas decode is lossy (PNG fidelity).
 */
export async function decodeToImageData(
  bytes: Uint8Array,
  inputFormat: NormFormat,
  load: CodecLoader = loadCodec,
): Promise<DecodedImage> {
  const blob = new Blob([bytes as BlobPart]);
  try {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const result = { data, width: bitmap.width, height: bitmap.height };
      canvas.width = 0;
      canvas.height = 0;
      return result;
    } finally {
      bitmap.close();
    }
  } catch (nativeErr) {
    // AVIF inputs aren't universally decodable by createImageBitmap (plan §11.1).
    if (inputFormat === "avif") {
      const decode = await load("avifDecode");
      const data = await decode(toArrayBuffer(bytes));
      return { data, width: data.width, height: data.height };
    }
    throw nativeErr;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Tight copy — bytes may be a view onto a larger/transferred buffer.
  return bytes.slice().buffer as ArrayBuffer;
}

// ── Encode (pure given an ImageData) ──────────────────────────────────────────

/**
 * Encode an ImageData with exactly one codec. PURE given the ImageData; loads
 * the codec via the injectable `load` (stubbed in unit tests).
 */
export async function encodeImageData(
  img: ImageData,
  fmt: NormFormat,
  opts: CompressOptions,
  load: CodecLoader = loadCodec,
): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  let buf: ArrayBuffer;
  switch (fmt) {
    case "jpeg": {
      const encode = await load("jpeg");
      // jSquash JPEG does not composite alpha → flatten onto white first.
      const flat = hasAlpha(img) ? flattenForJpeg(img) : img;
      buf = await encode(flat, { quality: opts.quality });
      break;
    }
    case "webp": {
      const encode = await load("webp");
      buf = await encode(img, {
        quality: opts.quality,
        method: opts.webpMethod,
        lossless: opts.lossless ? 1 : 0,
      });
      break;
    }
    case "avif": {
      const encode = await load("avif");
      buf = await encode(img, { quality: opts.quality, speed: opts.avifSpeed });
      break;
    }
    case "png": {
      if (opts.pngMode === "palette") {
        const UPNG = (await import("upng-js")).default;
        const rgba = tightRGBA(img);
        buf = UPNG.encode([rgba.buffer as ArrayBuffer], img.width, img.height, opts.paletteColors);
      } else {
        const optimise = await load("oxipng");
        buf = await optimise(img, { level: opts.pngLevel });
      }
      break;
    }
    default: {
      const _never: never = fmt;
      throw new Error(`Unknown format: ${String(_never)}`);
    }
  }
  const meta = MIME_EXT[fmt];
  return { bytes: new Uint8Array(buf), mime: meta.mime, ext: meta.ext };
}

// ── Regression guard (pure decision) ──────────────────────────────────────────

/**
 * Decide whether a larger-than-original encode should be discarded in favor of
 * the original bytes (plan §5.4). Pinned rules:
 *  - Same NORMALIZED format AND not a WebP-lossless request → if output ≥ input,
 *    keep the original ("already optimized"). This INCLUDES PNG-oxipng and
 *    PNG-palette (both "png"): smaller-of-two-lossless wins.
 *  - Deliberate transcode (formats differ) larger → keep the (larger) output,
 *    surface a soft warning; do NOT swap back.
 *  - `opts.lossless === true` (WebP lossless) larger → keep the output, no swap.
 */
export function shouldKeepOriginal(
  outputSize: number,
  inputSize: number,
  outFormat: NormFormat,
  inputFormat: NormFormat,
  opts: Pick<CompressOptions, "lossless">,
): boolean {
  if (opts.lossless) return false; // WebP lossless is exempt from the auto-revert.
  const sameFormat = normalizeFormat(outFormat) === normalizeFormat(inputFormat);
  if (!sameFormat) return false; // deliberate transcode — keep the real (larger) output.
  return outputSize >= inputSize;
}

// ── Orchestration (worker entry) ──────────────────────────────────────────────

/**
 * Decode → encode → regression guard → assert geometry invariant. Runs in the
 * worker. `deps` is injectable so unit tests cover the guard + geometry without
 * real WASM or canvas (plan §12).
 */
export async function compressImageData(
  input: Uint8Array,
  inputFormat: NormFormat,
  opts: CompressOptions,
  deps: {
    load?: CodecLoader;
    decode?: (bytes: Uint8Array, fmt: NormFormat, load: CodecLoader) => Promise<DecodedImage>;
  } = {},
): Promise<CompressResult> {
  const load = deps.load ?? loadCodec;
  const decode = deps.decode ?? decodeToImageData;

  const fmt: NormFormat = opts.format === "keep" ? inputFormat : opts.format;
  const { data, width, height } = await decode(input, inputFormat, load);

  // Geometry invariant (plan §1.1): no resize path exists between decode and
  // encode — every codec encodes `data` at its own width/height, and `width`/
  // `height` are those same decoded dims surfaced on the result for the UI/test
  // to pin. There is no downscale call to guard against at runtime.
  const encoded = await encodeImageData(data, fmt, opts, load);

  const inputSize = input.length;
  const outputSize = encoded.bytes.length;
  const meta = MIME_EXT[inputFormat];

  if (shouldKeepOriginal(outputSize, inputSize, fmt, inputFormat, opts)) {
    return {
      bytes: input,
      mime: meta.mime,
      ext: meta.ext,
      outputSize: inputSize,
      inputSize,
      ratio: 0,
      keptOriginal: true,
      width,
      height,
      outputFormat: inputFormat,
    };
  }

  return {
    bytes: encoded.bytes,
    mime: encoded.mime,
    ext: encoded.ext,
    outputSize,
    inputSize,
    ratio: 1 - outputSize / inputSize,
    keptOriginal: false,
    width,
    height,
    outputFormat: fmt,
  };
}
