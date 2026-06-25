// Shared types + constants for image-compress. DOM-free, dependency-free so BOTH
// the worker-only `compressor-core.ts` and the Route-facing `compressor.ts`
// barrel can import it without coupling the codec graph or the resizer helpers
// into the wrong bundle (plan §3.1, §5.1).
import type { NormFormat } from "@/lib/image";

export type { NormFormat } from "@/lib/image";

// "keep" = re-encode in the input's own format family (JPEG→JPEG, PNG→PNG, …).
export type OutputFormat = "keep" | NormFormat;
export type PngMode = "oxipng" | "palette"; // lossless optimise vs UPNG quantize

/** The single resolved option set sent to the worker per encode. */
export interface CompressOptions {
  format: OutputFormat;
  quality: number; // 1..100; lossy codecs (jpeg/webp/avif) → jSquash `quality`
  lossless: boolean; // webp lossless (coerced to numeric 0/1 at the webp call site)
  pngMode: PngMode; // when the effective format is png
  paletteColors: number; // 2..256, UPNG palette size (pngMode === "palette")
  pngLevel: number; // 1..6 oxipng `level` (pngMode === "oxipng"). Default 2.
  avifSpeed: number; // 0..10 jSquash avif `speed` (higher = faster/larger). Default 6.
  webpMethod: number; // 0..6 jSquash webp `method` (effort). Default 4.
}

/**
 * Persisted UI prefs — per-format quality map resolved to `quality` at dispatch.
 * A `type` (not `interface`) so it satisfies `useToolPreferences`'s
 * `Record<string, unknown>` constraint (interfaces lack the implicit index sig).
 */
export type CompressPrefs = {
  format: OutputFormat;
  qualityByFormat: Record<"jpeg" | "webp" | "avif", number>;
  lossless: boolean;
  pngMode: PngMode;
  paletteColors: number;
  avifSpeed: number;
  webpMethod: number;
  pngLevel: number;
};

export const DEFAULT_PREFS: CompressPrefs = {
  format: "keep",
  qualityByFormat: { jpeg: 75, webp: 75, avif: 50 },
  lossless: false,
  pngMode: "oxipng",
  paletteColors: 256,
  avifSpeed: 6,
  webpMethod: 4,
  pngLevel: 2,
};

export interface CompressResult {
  bytes: Uint8Array; // the bytes to download
  mime: string; // "image/jpeg" | …
  ext: string; // "jpg" | "png" | …
  outputSize: number; // bytes.length
  inputSize: number; // original byte length
  ratio: number; // 1 - outputSize/inputSize (0 when regression-kept; <0 when larger)
  keptOriginal: boolean; // regression guard fired; bytes === original input
  width: number; // === input width (geometry never changes)
  height: number; // === input height
  outputFormat: NormFormat; // resolved concrete format
}

/** Resolve persisted prefs + the effective format into a single CompressOptions. */
export function resolveOptions(prefs: CompressPrefs, effectiveFormat: NormFormat): CompressOptions {
  return {
    format: prefs.format,
    quality: prefs.qualityByFormat[effectiveFormat as "jpeg" | "webp" | "avif"] ?? 75,
    lossless: prefs.lossless,
    pngMode: prefs.pngMode,
    paletteColors: prefs.paletteColors,
    pngLevel: prefs.pngLevel,
    avifSpeed: prefs.avifSpeed,
    webpMethod: prefs.webpMethod,
  };
}
