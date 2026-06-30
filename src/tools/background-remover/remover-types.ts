// ── remover-types.ts — DOM-free, dependency-free. Imported by Route, core, worker. ──
// v1 ships ONE spike-chosen model (§2.2): "fast" = candidate A u2netp (~4.7MB, single file < 25 MiB);
// "quality" = candidate B chunked int8 ISNet, the in-v1 escalation if A fails the §15 #3 acceptance gate.
// Both variants are real v1 paths (B is NOT v1.1) — the spike decides which one ships; no in-app toggle (§6.1).
import type { NormFormat } from "@/lib/image";

export type ModelVariant = "fast" | "quality";
export type OutputMode = "transparent" | "color" | "mask"; // alpha PNG | flatten onto color | grayscale matte
export type OutputFormat = "png" | "webp"; // alpha-preserving encodes

export interface RemoveOptions {
  // NO `variant` here (opencode #1/#7): v1 ships exactly ONE spike-chosen model (§6.1, no toggle), so the
  // model is NOT a user option and is NEVER persisted. The active model is resolved at call time from the
  // single registered MODELS entry (ACTIVE_VARIANT below) — persisting a variant only re-creates the
  // restore hazard the old §6.4 guard patched. Keep model OUT of RemoveOptions/RemovePrefs entirely.
  outputMode: OutputMode;
  backgroundColor: string; // "#ffffff" — used when outputMode === "color"
  format: OutputFormat; // png (default, lossless alpha) | webp
  // Advanced (v1: ship "transparent" minimal; expose later):
  /** @deprecated v1.1 — NOT wired in v1 UI (manual mask convolution; §6.4/cursor #17). Kept for fwd-compat. */
  edgeFeather: number; // 0..5 px gaussian feather on the mask edge (0 = off). Default 0.
  alphaThreshold: number; // 0..255 hard-cutoff for the matte (0 = soft matte, keep AA). Default 0.
}

export interface RemovePrefs extends RemoveOptions {} // 1:1 here (no per-format map needed); NO variant.
export const DEFAULT_PREFS: RemovePrefs = {
  outputMode: "transparent",
  backgroundColor: "#ffffff",
  format: "png",
  edgeFeather: 0,
  alphaThreshold: 0,
};

export interface RemoveResult {
  bytes: Uint8Array; // the cutout to download
  mime: string; // "image/png" | "image/webp"
  ext: string; // "png" | "webp"
  outputSize: number; // bytes.length
  width: number; // === input width (assert; geometry never changes)
  height: number; // === input height
}

// Per-variant model metadata — the ONLY place model URLs/specs live (same-origin paths).
export interface ModelSpec {
  // SAME ORIGIN, never a CDN. A is one file; B is N <25 MiB chunks reassembled before create() (§2.2/§3.3).
  url: string | string[];
  inputSize: number; // 320 for u2netp (A); 1024 for ISNet (B) — square
  // normalization (rembg): divide-by-max then (x-mean)/std — NOT /255 (§5.3). e.g. u2netp ImageNet mean/std.
  mean: [number, number, number];
  std: [number, number, number];
}

// MODELS registers EXACTLY ONE entry — the variant the §15 #3 spike chose (opencode #1). Ship `fast`
// (candidate A u2netp) if it clears acceptance; otherwise register `quality` (candidate B chunked int8
// ISNet) INSTEAD and delete the `fast` entry. Both are NEVER registered at once — there is no toggle (§6.1),
// so the unshipped label is dead and absent from the table. `ACTIVE_VARIANT` is the single source of truth
// the worker/loader read; nothing persists or restores a variant (§5.1 RemoveOptions). rembg-verified norms.
export const ACTIVE_VARIANT: ModelVariant = "fast"; // set to whichever the spike shipped; the ONE live model
export const MODELS: Partial<Record<ModelVariant, ModelSpec>> = {
  // KEEP EXACTLY ONE of these, matching ACTIVE_VARIANT:
  fast: {
    url: "/models/background-remover/u2netp.onnx",
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  // quality: { url: ["/models/background-remover/isnet-int8.part0", "…part1", …], inputSize: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1] },
  //   url = CHUNK MANIFEST (N <25 MiB parts) reassembled before create() — §2.2/§3.3 (in-v1, NOT v1.1).
};
// loadSession reads MODELS[ACTIVE_VARIANT] — a missing/extra entry is a build error, not a runtime guess.

// ── Worker message union (§5.3) ────────────────────────────────────────────────
// The dedicated worker (remove.worker.ts) speaks these discriminated unions — NOT a single fixed message
// shape. `infer`/`recomposite`/`prefetch` inbound; `progress`/`result`/`error` outbound. `fetchModelWithProgress`
// and inference both emit `progress` so the first-load UI bar (§6.1) is fed worker→main. `removeViaWorker`/
// `prefetchModel`/`recompositeViaWorker` route replies by `requestId` + `type`.
export type WorkerRequest =
  // download for batch (small zip), preview for interactive single infer (opencode R3 #1):
  | {
      type: "infer";
      requestId: number;
      // itemKey === QueueItem.id (§5.3): the worker stores it on the cache slot so a later
      // `recomposite` can verify it targets the SAME item before reusing { srcRGBA, fullResMask }.
      itemKey: string;
      input: ArrayBuffer;
      inputFormat: NormFormat;
      options: RemoveOptions;
      encodeIntent: "preview" | "download";
    }
  // reuse cached { srcRGBA, fullResMask } slot; worker REJECTS if itemKey !== slot.itemKey (cursor r4 #6);
  // preview=convertToBlob, download=oxipng (opencode #3):
  | {
      type: "recomposite";
      requestId: number;
      itemKey: string;
      options: RemoveOptions;
      encodeIntent: "preview" | "download";
    }
  // model is ACTIVE_VARIANT (§5.1) — no variant arg (opencode #1):
  | { type: "prefetch"; requestId: number };

export type WorkerResponse =
  | { type: "progress"; requestId: number; stage: string; current: number; total: number }
  | { type: "result"; requestId: number; ok: true; result: RemoveResult }
  | { type: "error"; requestId: number; ok: false; error: string };
