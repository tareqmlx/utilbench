// Main-thread client + the single barrel Route.tsx imports (plan §3.1/§5.2).
// Holds the worker dispatchers (`upscaleViaWorker`, `reencodeViaWorker`, `prefetchModel`) with
// requestId routing + per-dispatch timeout + onerror reject-all/respawn (mirrors remover.ts),
// filename/byte helpers, and re-exports the shared helpers Route consumes — so Route imports ONE
// module. Imports ONLY TYPES from upscaler-types (never upscaler-core), keeping the TF.js graph off
// Route's bundle.
import type { NormFormat } from "@/lib/image";
import type {
  OutputFormat,
  ScaleFactor,
  UpscaleOptions,
  UpscaleResult,
  WorkerRequest,
  WorkerResponse,
} from "./upscaler-types";

// ── Re-exports so Route imports everything from here (pattern: remover.ts) ──
export {
  validateImageFile,
  sniffImageMeta,
  normalizeFormat,
  readImageDims,
  clampToCanvasLimits,
  MAX_IMAGE_SIZE,
  WARN_IMAGE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_CANVAS_DIM,
  MAX_CANVAS_AREA,
} from "@/lib/image";
export type { NormFormat } from "@/lib/image";
export { MAX_QUEUE_SIZE } from "../constants";
export { downloadBlob, readFileBytes } from "@/lib/pdf";
export type { ValidationResult } from "@/lib/pdf";
export { createBatchZip } from "../image-resizer/resizer";
export * from "./upscaler-types";

// ── Worker client ─────────────────────────────────────────────────────────────

// Per-dispatch safety-net timeout (plan §7.1). A hung/OOM inference never fires `onmessage`, so the
// batch `await` would wedge forever and bumping `requestId` frees nothing. This generous ceiling (a
// 4× run on the CPU backend floor is genuinely slow) rejects the item and recycles the worker so the
// batch/preview proceeds.
const UPSCALE_TIMEOUT_MS = 300_000;

type ProgressCb = (p: { stage: string; current: number; total: number }) => void;

let worker: Worker | null = null;
// Negative, monotonically-decreasing ids for internally-owned dispatches (prefetch) so they never
// collide with Route's positive reqIdRef counter.
let internalReqId = -1;
// One in-flight prefetch promise per scale (idempotent per scale; reset on failure).
const prefetchPromises = new Map<ScaleFactor, Promise<UpscaleResult>>();

const pending = new Map<
  number,
  {
    resolve: (r: UpscaleResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    onProgress?: ProgressCb;
  }
>();

// Serialize every worker dispatch FIFO. The worker's `onmessage` is async, so two overlapping posts
// would run two upscale/encode handlers concurrently — TF.js forbids overlapping WebGL runs on one
// backend, and the single cache slot would race. A preview re-encode and a per-row download could
// otherwise post at the same time. Chaining here makes inference strictly one-at-a-time regardless
// of which UI flag each caller checked.
let dispatchChain: Promise<unknown> = Promise.resolve();

/** Lazily construct the worker (module-scope `new Worker` breaks jsdom tests — plan §7.1). */
function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./upscale.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const entry = pending.get(msg.requestId);
      if (!entry) return; // stale / already-settled request
      if (msg.type === "progress") {
        entry.onProgress?.({ stage: msg.stage, current: msg.current, total: msg.total });
        return; // progress never settles or clears the timer
      }
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    };
    worker.onerror = (e) => {
      // Unrecoverable worker error: clear every armed timer, reject all in-flight, force respawn.
      // (Clearing timers first avoids a later timeout double-settling an already-rejected promise.)
      const err = new Error(e.message || "Image upscaler worker crashed.");
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
      terminateUpscaleWorker();
    };
  }
  return worker;
}

/** Post a request, arm the per-dispatch timeout, route the reply by requestId. */
function dispatch(
  req: WorkerRequest,
  transfer: Transferable[],
  onProgress?: ProgressCb,
): Promise<UpscaleResult> {
  // The actual post — runs only once the previous dispatch settles (see `dispatchChain`). `ensureWorker`
  // and the timeout are evaluated HERE, at post time, so a queued request gets a fresh worker after a
  // respawn and its window starts when it really posts, not when it was enqueued.
  const run = () =>
    new Promise<UpscaleResult>((resolve, reject) => {
      const w = ensureWorker();
      const timer = setTimeout(() => {
        // No-op if the request already settled (e.g. onerror got there first).
        if (pending.delete(req.requestId)) {
          reject(
            new Error(
              req.type === "prefetch"
                ? "Loading the AI model timed out — check your connection and retry."
                : "Upscaling timed out.",
            ),
          );
          // A never-returning run blocks every later dispatch behind it; recycle the worker.
          terminateUpscaleWorker();
        }
      }, UPSCALE_TIMEOUT_MS);
      pending.set(req.requestId, { resolve, reject, timer, onProgress });
      w.postMessage(req, transfer);
    });
  // Tack onto the chain whether the prior dispatch resolved OR rejected (a failed run must not wedge
  // the queue), but hand the caller the real result promise.
  const result = dispatchChain.then(run, run);
  dispatchChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Upscale one image in the worker. The caller owns `requestId` (resolve/reject routes by it) and
 * `itemKey` (=== QueueItem.id; the worker caches the slot under it). The input buffer is COPIED and
 * the copy transferred — the original `bytes` stays intact for the next item/preview.
 */
export function upscaleViaWorker(args: {
  itemKey: string;
  input: Uint8Array;
  inputFormat: NormFormat;
  options: UpscaleOptions;
  requestId: number;
  onProgress?: ProgressCb;
}): Promise<UpscaleResult> {
  const copy = args.input.slice();
  const req: WorkerRequest = {
    type: "upscale",
    requestId: args.requestId,
    itemKey: args.itemKey,
    input: copy.buffer as ArrayBuffer,
    inputFormat: args.inputFormat,
    options: args.options,
  };
  return dispatch(req, [copy.buffer as ArrayBuffer], args.onProgress);
}

/**
 * Cheap re-encode of the worker's cached upscaled RGBA at a new format/quality — NO re-inference
 * (plan §6.5). The worker REJECTS if `itemKey` !== the cached slot's key (stale / empty / evicted),
 * and Route then re-runs the upscale.
 */
export function reencodeViaWorker(args: {
  itemKey: string;
  format: OutputFormat;
  quality: number;
  backgroundColor: string;
  requestId: number;
}): Promise<UpscaleResult> {
  const req: WorkerRequest = {
    type: "reencode",
    requestId: args.requestId,
    itemKey: args.itemKey,
    format: args.format,
    quality: args.quality,
    backgroundColor: args.backgroundColor,
  };
  return dispatch(req, []);
}

/**
 * Warm the model + compile the WebGL shaders ahead of the first run (plan §6.1). Idempotent per
 * scale: concurrent/repeat calls for the same scale share one in-flight dispatch; a failure resets
 * so a retry can re-attempt. Uses negative internal requestIds so they never collide with Route's
 * positive counter.
 */
export function prefetchModel(
  scale: ScaleFactor,
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> {
  let promise = prefetchPromises.get(scale);
  if (!promise) {
    const req: WorkerRequest = { type: "prefetch", requestId: internalReqId--, scale };
    promise = dispatch(
      req,
      [],
      onProgress ? (p) => onProgress({ current: p.current, total: p.total }) : undefined,
    );
    prefetchPromises.set(scale, promise);
  }
  return promise.then(
    () => undefined,
    (err) => {
      prefetchPromises.delete(scale); // allow a retry
      throw err;
    },
  );
}

/** Tear down the worker (unmount / unrecoverable error). Pending promises reject. */
export function terminateUpscaleWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Image upscaler worker stopped."));
  }
  pending.clear();
  prefetchPromises.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `${base}-${scale}x.${ext}`, sanitized; falls back to "image". */
export function buildUpscaledFilename(
  originalName: string,
  scale: ScaleFactor,
  ext: string,
): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "image"}-${scale}x.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
