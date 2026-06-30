// Dedicated module Worker for background-remover (plan §7). Thin shell: all logic lives in
// remover-core.ts (DOM-free, unit-tested). Speaks the WorkerRequest/WorkerResponse discriminated
// unions (plan §5.3). Holds a SINGLE cache slot so a `recomposite` reuses the last infer's
// { srcRGBA, fullResMask } without re-inferring — one slot only (a 16 MP Float32 mask + full-res
// RGBA is ~128 MB, so the whole queue is never cached). Any throw → an explicit error message.
/// <reference lib="webworker" />
import { compositeFromMask, loadSession, removeBackgroundFromBytes } from "./remover-core";
import type { RemoveResult, WorkerRequest, WorkerResponse } from "./remover-types";

interface CacheSlot {
  itemKey: string;
  srcRGBA: ImageData;
  fullResMask: Float32Array;
  width: number;
  height: number;
}

// One slot only (plan §5.3). itemKey === QueueItem.id; cleared implicitly on the next infer.
let slot: CacheSlot | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const { requestId } = req;
  try {
    if (req.type === "infer") {
      const input = new Uint8Array(req.input);
      const { result, srcRGBA, fullResMask } = await removeBackgroundFromBytes(
        input,
        req.inputFormat,
        req.options,
        req.encodeIntent,
        {
          onProgress: (p) =>
            post({
              type: "progress",
              requestId,
              stage: p.stage,
              current: p.current,
              total: p.total,
            }),
        },
      );
      // Cache the expensive intermediates so a later recomposite is cheap.
      slot = {
        itemKey: req.itemKey,
        srcRGBA,
        fullResMask,
        width: result.width,
        height: result.height,
      };
      post({ type: "result", requestId, ok: true, result }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }

    if (req.type === "recomposite") {
      if (!slot || slot.itemKey !== req.itemKey) {
        post({
          type: "error",
          requestId,
          ok: false,
          error: "Preview cache is stale — re-run background removal for this image.",
        });
        return;
      }
      const encoded = await compositeFromMask(
        slot.srcRGBA,
        slot.fullResMask,
        req.options,
        req.encodeIntent,
      );
      const result: RemoveResult = {
        bytes: encoded.bytes,
        mime: encoded.mime,
        ext: encoded.ext,
        outputSize: encoded.bytes.length,
        width: slot.width,
        height: slot.height,
      };
      post({ type: "result", requestId, ok: true, result }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }

    // prefetch — warm the session + download weights ahead of the first run (no bytes returned).
    await loadSession(undefined, (p) =>
      post({ type: "progress", requestId, stage: "download", current: p.current, total: p.total }),
    );
    const empty: RemoveResult = {
      bytes: new Uint8Array(0),
      mime: "",
      ext: "",
      outputSize: 0,
      width: 0,
      height: 0,
    };
    post({ type: "result", requestId, ok: true, result: empty });
  } catch (err) {
    post({ type: "error", requestId, ok: false, error: String(err) });
  }
};
