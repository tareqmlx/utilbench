// Main-thread client + the single barrel Route.tsx imports (plan §3.1/§5.1).
// Holds `compressViaWorker` (posts to the dedicated worker + request routing),
// filename/byte helpers, and re-exports the shared helpers Route consumes — so
// Route imports ONE module. Imports only TYPES from compressor-types (never
// compressor-core), keeping the codec graph off Route's bundle.
import type { NormFormat } from "@/lib/image";
import type { WorkerRequest, WorkerResponse } from "./compress.worker";
import type { CompressOptions, CompressResult } from "./compressor-types";

// ── Re-exports so Route imports everything from here (pattern: resizer.ts) ──
export {
  validateImageFile,
  sniffImageMeta,
  normalizeFormat,
  readImageDims,
  classifyImageFormat,
  MAX_IMAGE_SIZE,
  WARN_IMAGE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_CANVAS_AREA,
  clampToCanvasLimits,
} from "@/lib/image";
export type { NormFormat } from "@/lib/image";
export { MAX_QUEUE_SIZE } from "../constants";
// downloadBlob/readFileBytes from the canonical @/lib/pdf (not resizer's duplicate).
export { downloadBlob, readFileBytes } from "@/lib/pdf";
export type { ValidationResult } from "@/lib/pdf";
// Only createBatchZip is resizer-specific.
export { createBatchZip } from "../image-resizer/resizer";
export * from "./compressor-types";

// ── Worker client ─────────────────────────────────────────────────────────────

// Per-dispatch safety-net timeout. Plan §7.1 deliberately dropped the workerPool's
// 30 s timeout (it would fire mid-AVIF), but left NO recovery — a hung/pathological
// WASM encode would wedge the batch await forever. This generous ceiling rejects so
// the item errors and the batch/preview can proceed (the worker may finish unseen).
const ENCODE_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
const pending = new Map<
  number,
  {
    resolve: (r: CompressResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/** Lazily construct the worker (module-scope `new Worker` breaks jsdom tests — §7.1). */
function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./compress.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const entry = pending.get(msg.requestId);
      if (!entry) return; // stale / already-settled request
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    };
    worker.onerror = (e) => {
      // Unrecoverable worker error: reject everything in flight and force respawn.
      const err = new Error(e.message || "Compression worker crashed.");
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
      terminateCompressWorker();
    };
  }
  return worker;
}

/**
 * Encode one image in the worker. The caller owns `requestId`; resolve/reject is
 * routed by it. The input buffer is COPIED and the copy transferred — the
 * original `bytes` stays intact for the next debounced preview/batch item, and
 * nothing structured-clones the whole buffer per tick (plan §7.1).
 */
export function compressViaWorker(args: {
  input: Uint8Array;
  inputFormat: NormFormat;
  options: CompressOptions;
  requestId: number;
}): Promise<CompressResult> {
  const w = ensureWorker();
  const copy = args.input.slice();
  return new Promise<CompressResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(args.requestId)) {
        reject(new Error("Compression timed out — the image may be too large or complex."));
        // The worker's onmessage is serial: a never-returning WASM encode would block
        // every later dispatch behind it (each then burning the full timeout). Recycle
        // the (possibly wedged) worker so the next dispatch spawns a fresh one.
        terminateCompressWorker();
      }
    }, ENCODE_TIMEOUT_MS);
    pending.set(args.requestId, { resolve, reject, timer });
    const req: WorkerRequest = {
      input: copy,
      inputFormat: args.inputFormat,
      options: args.options,
      requestId: args.requestId,
    };
    w.postMessage(req, [copy.buffer]);
  });
}

/** Tear down the worker (unmount / unrecoverable error). Pending promises reject. */
export function terminateCompressWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Compression worker stopped."));
  }
  pending.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `${base}-compressed.${ext}`, sanitized; falls back to "image". */
export function buildCompressedFilename(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "image"}-compressed.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a size-change ratio for display. Positive ratio = saved bytes ("−42%");
 * negative ratio = the output grew, shown as a warning ("+20% larger"), never a
 * misleading "−" saving (plan §6.5).
 */
export function formatRatio(ratio: number): { label: string; larger: boolean } {
  const pct = Math.round(Math.abs(ratio) * 100);
  if (ratio < 0) return { label: `+${pct}% larger`, larger: true };
  return { label: `−${pct}%`, larger: false };
}
