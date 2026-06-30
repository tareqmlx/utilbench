// Main-thread client + the single barrel Route.tsx imports (plan §3.1/§5.2).
// Holds the worker dispatchers (`removeViaWorker`, `recompositeViaWorker`, `prefetchModel`) with
// requestId routing + per-dispatch timeout + onerror reject-all/respawn (mirrors compressor.ts),
// filename/byte helpers, and re-exports the shared helpers Route consumes — so Route imports ONE
// module. Imports ONLY TYPES from remover-types (never remover-core), keeping the ORT graph off
// Route's bundle.
import type { NormFormat } from "@/lib/image";
import type { RemoveOptions, RemoveResult, WorkerRequest, WorkerResponse } from "./remover-types";

// ── Re-exports so Route imports everything from here (pattern: compressor.ts) ──
export {
  validateImageFile,
  sniffImageMeta,
  normalizeFormat,
  readImageDims,
  MAX_IMAGE_SIZE,
  WARN_IMAGE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_CANVAS_AREA,
} from "@/lib/image";
export type { NormFormat } from "@/lib/image";
export { MAX_QUEUE_SIZE } from "../constants";
export { downloadBlob, readFileBytes } from "@/lib/pdf";
export type { ValidationResult } from "@/lib/pdf";
export { createBatchZip } from "../image-resizer/resizer";
export * from "./remover-types";

// ── Worker client ─────────────────────────────────────────────────────────────

// Per-dispatch safety-net timeout (plan §7.1). A hung/OOM `session.run` never fires `onmessage`,
// so the batch `await` would wedge forever and bumping `requestId` frees nothing. This generous
// ceiling (heavier WASM/ISNet path + multi-second oxipng encode) rejects the item and recycles the
// worker so the batch/preview proceeds.
const REMOVE_TIMEOUT_MS = 180_000;

type ProgressCb = (p: { stage: string; current: number; total: number }) => void;

let worker: Worker | null = null;
// Negative, monotonically-decreasing ids for internally-owned dispatches (prefetch) so they never
// collide with Route's positive reqIdRef counter.
let internalReqId = -1;
let prefetchPromise: Promise<RemoveResult> | null = null;

const pending = new Map<
  number,
  {
    resolve: (r: RemoveResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    onProgress?: ProgressCb;
  }
>();

// Serialize every worker dispatch FIFO. The worker's `onmessage` is async, so two overlapping posts
// would run two `session.run`/composite handlers concurrently — ORT forbids concurrent `run` on one
// session, and the single cache slot would race. A preview re-infer (gated on `previewBusy`) and a
// per-row download (gated on `isBusy`) could otherwise post at the same time (cursor r3 #3). Chaining
// here makes session.run strictly one-at-a-time regardless of which UI flag each caller checked.
let dispatchChain: Promise<unknown> = Promise.resolve();

/** Lazily construct the worker (module-scope `new Worker` breaks jsdom tests — plan §7.1). */
function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./remove.worker.ts", import.meta.url), { type: "module" });
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
      const err = new Error(e.message || "Background removal worker crashed.");
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
      terminateRemoveWorker();
    };
  }
  return worker;
}

/** Post a request, arm the per-dispatch timeout, route the reply by requestId. */
function dispatch(
  req: WorkerRequest,
  transfer: Transferable[],
  onProgress?: ProgressCb,
): Promise<RemoveResult> {
  // The actual post — runs only once the previous dispatch settles (see `dispatchChain`). `ensureWorker`
  // and the timeout are evaluated HERE, at post time, so a queued request gets a fresh worker after a
  // respawn and its 180s window starts when it really posts, not when it was enqueued.
  const run = () =>
    new Promise<RemoveResult>((resolve, reject) => {
      const w = ensureWorker();
      const timer = setTimeout(() => {
        // No-op if the request already settled (e.g. onerror got there first).
        if (pending.delete(req.requestId)) {
          reject(
            new Error(
              req.type === "prefetch"
                ? "Loading the AI model timed out — check your connection and retry."
                : "Background removal timed out.",
            ),
          );
          // A never-returning run blocks every later dispatch behind it; recycle the worker.
          terminateRemoveWorker();
        }
      }, REMOVE_TIMEOUT_MS);
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
 * Remove the background from one image in the worker. The caller owns `requestId` (resolve/reject
 * routes by it) and `itemKey` (=== QueueItem.id; the worker caches the slot under it). The input
 * buffer is COPIED and the copy transferred — the original `bytes` stays intact for the next
 * item/preview. `encodeIntent`: "preview" (fast convertToBlob) for the interactive single infer,
 * "download" (small oxipng) for batch items (plan §6.6).
 */
export function removeViaWorker(args: {
  input: Uint8Array;
  inputFormat: NormFormat;
  options: RemoveOptions;
  requestId: number;
  itemKey: string;
  encodeIntent: "preview" | "download";
  onProgress?: ProgressCb;
}): Promise<RemoveResult> {
  const copy = args.input.slice();
  const req: WorkerRequest = {
    type: "infer",
    requestId: args.requestId,
    itemKey: args.itemKey,
    input: copy.buffer as ArrayBuffer,
    inputFormat: args.inputFormat,
    options: args.options,
    encodeIntent: args.encodeIntent,
  };
  return dispatch(req, [copy.buffer as ArrayBuffer], args.onProgress);
}

/**
 * Cheap re-composite of the worker's cached { srcRGBA, fullResMask } slot — NO re-inference
 * (plan §5.3/§6.5). The worker REJECTS if `itemKey` !== the cached slot's key (stale / empty),
 * and Route then re-infers. Recomposite uses "preview" so it stays instant.
 */
export function recompositeViaWorker(args: {
  options: RemoveOptions;
  requestId: number;
  itemKey: string;
  encodeIntent: "preview" | "download";
  onProgress?: ProgressCb;
}): Promise<RemoveResult> {
  const req: WorkerRequest = {
    type: "recomposite",
    requestId: args.requestId,
    itemKey: args.itemKey,
    options: args.options,
    encodeIntent: args.encodeIntent,
  };
  return dispatch(req, [], args.onProgress);
}

/**
 * Warm the ORT session + download the weights ahead of the first run (plan §6.1). Idempotent:
 * concurrent/repeat calls share one in-flight dispatch; a failure resets so a retry can re-attempt.
 * No variant arg — the worker loads ACTIVE_VARIANT (plan §5.2).
 */
export function prefetchModel(
  onProgress?: (p: { current: number; total: number }) => void,
): Promise<void> {
  if (!prefetchPromise) {
    const req: WorkerRequest = { type: "prefetch", requestId: internalReqId-- };
    prefetchPromise = dispatch(
      req,
      [],
      onProgress ? (p) => onProgress({ current: p.current, total: p.total }) : undefined,
    );
  }
  return prefetchPromise.then(
    () => undefined,
    (err) => {
      prefetchPromise = null; // allow a retry
      throw err;
    },
  );
}

/** Tear down the worker (unmount / unrecoverable error). Pending promises reject. */
export function terminateRemoveWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Background removal worker stopped."));
  }
  pending.clear();
  prefetchPromise = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `${base}-nobg.${ext}`, sanitized; falls back to "image". */
export function buildCutoutFilename(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "image"}-nobg.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
