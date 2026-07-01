// ── upscaler-types.ts — DOM-free, no TF.js (only the pure clampToCanvasLimits). ──
// Imported by Route, core, and worker. The single source of truth for the worker protocol,
// option/result shapes, model metadata, and the load-bearing output-cap gate (plan §5.1).
import { MAX_CANVAS_AREA, clampToCanvasLimits } from "@/lib/image";
import type { NormFormat } from "@/lib/image";

export type ScaleFactor = 2 | 4; // v1 ships 2× and 4× (3×/8× out — plan §2.2)
export type OutputFormat = "png" | "webp" | "jpeg"; // png default (lossless, keeps detail + alpha)

// ext mapping — jpeg→"jpg" per repo convention (compressor-core.ts), NOT "jpeg":
export const FORMAT_EXT: Record<OutputFormat, string> = { png: "png", webp: "webp", jpeg: "jpg" };
export const FORMAT_MIME: Record<OutputFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

export const SCALES: ScaleFactor[] = [4, 2]; // largest-first, for computeMaxScale
export const TILE_SIZE = 128; // UpscalerJS patchSize (esrgan-slim was trained at patchSize 128)
export const TILE_PADDING = 16; // halo cropped to hide seams (plan §7.2)

/**
 * OUTPUT-cap gate (load-bearing, plan §10.2). Unique to this tool: geometry MULTIPLIES, and the
 * output is encoded on a canvas, so it must obey the repo's canvas ceiling — BOTH ≤8192 px/side
 * AND ≤16.7 MP area (the iOS-Safari limit `clampToCanvasLimits` enforces). Returns the largest
 * scale in {4,2} whose OUTPUT fits, else 0 (image too large even at 2× → Route disables the run
 * and points at image-resizer). We GATE (disable the scale); we NEVER clamp/downscale the output
 * (that would defeat an upscaler).
 *
 * `maxArea` defaults to MAX_CANVAS_AREA (16.7 MP, the canvas ceiling). Route — which CAN read
 * navigator.* (this DOM-free module can't) — passes a LOWER maxArea on weak devices (the device-aware
 * GPU gate, plan §7.2, e.g. ~8 MP). The clampToCanvasLimits side/area cap still applies on top.
 */
export function computeMaxScale(
  w: number,
  h: number,
  maxArea: number = MAX_CANVAS_AREA,
): ScaleFactor | 0 {
  for (const s of SCALES) {
    const ow = w * s;
    const oh = h * s;
    if (!clampToCanvasLimits(ow, oh).downscaled && ow * oh <= maxArea) return s;
  }
  return 0;
}

export interface UpscaleOptions {
  scale: ScaleFactor; // 2 | 4
  format: OutputFormat; // png | webp | jpeg
  quality: number; // 1..100 — used for webp/jpeg encode; ignored for png. Default 90.
  backgroundColor: string; // "#ffffff" — flatten color when format === "jpeg" (no alpha). Default white.
}

export type UpscalePrefs = UpscaleOptions; // 1:1; persisted via useToolPreferences
export const DEFAULT_PREFS: UpscalePrefs = {
  scale: 2,
  format: "png",
  quality: 90,
  backgroundColor: "#ffffff",
};

export interface UpscaleResult {
  bytes: Uint8Array; // the upscaled image to download
  mime: string; // "image/png" | "image/webp" | "image/jpeg"
  ext: string; // "png" | "webp" | "jpg" — jpeg→"jpg" (repo convention), NOT "jpeg"
  outputSize: number; // bytes.length
  scale: ScaleFactor; // the scale ACTUALLY applied (= effectiveScale; may be < prefs.scale for a clamped item)
  width: number; // === input width × scale (assert; plan §5.3 step 8)
  height: number; // === input height × scale
}

// Per-scale model metadata — the ONLY place model identities live. SAME ORIGIN (staged by
// copy:upscaler-models into public/models/image-upscaler), never a CDN (plan §3.3).
export interface ModelSpec {
  scale: ScaleFactor;
  /** Same-origin URL to the TF.js model.json; shards resolve relative to it. NEVER a CDN. */
  path: string;
  approxBytes: number; // weight shard size (~0.9 MB/scale — plan §2.2)
}
export const MODELS: Record<ScaleFactor, ModelSpec> = {
  2: { scale: 2, path: "/models/image-upscaler/x2/model.json", approxBytes: 888_300 },
  4: { scale: 4, path: "/models/image-upscaler/x4/model.json", approxBytes: 933_804 },
};

// Approx first-load total surfaced in copy (plan §6.1): the selected scale's weights (~0.9 MB)
// + the TF.js runtime (~1.5 MB) ≈ ~2–3 MB. Stated, not the model alone and not the source's "5–20 MB".
export const APPROX_RUNTIME_BYTES = 1_500_000;

// ── Worker protocol (discriminated unions — pin up front) ────────────────────
// Three inbound shapes; the client routes responses by `type` (progress does NOT settle the
// promise — plan §5.2/§7.1). `itemKey` === QueueItem.id — the worker keys its cache slot by it.
export type WorkerRequest =
  | {
      type: "upscale";
      requestId: number;
      itemKey: string;
      input: ArrayBuffer;
      inputFormat: NormFormat;
      options: UpscaleOptions;
    }
  // re-encode the cached upscaled RGBA at a new format/quality — NO re-inference (plan §6.5).
  // Worker REJECTS if itemKey !== cached slot (stale/empty/mismatched).
  | {
      type: "reencode";
      requestId: number;
      itemKey: string;
      format: OutputFormat;
      quality: number;
      backgroundColor: string;
    }
  | { type: "prefetch"; requestId: number; scale: ScaleFactor };

export type WorkerResponse =
  // current/total = 0..1 patch fraction (UpscalerJS progress) OR byte fraction (weight download); does NOT settle
  | { type: "progress"; requestId: number; stage: string; current: number; total: number }
  | { type: "result"; requestId: number; ok: true; result: UpscaleResult }
  | { type: "error"; requestId: number; ok: false; error: string };
