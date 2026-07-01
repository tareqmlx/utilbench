// Dedicated module Worker for image-upscaler (plan §7). Thin shell: all TF.js/WebGL logic lives in
// upscaler-core.ts (DOM-free, unit-tested). Speaks the WorkerRequest/WorkerResponse discriminated
// unions (plan §5.2). Holds a SINGLE cache slot so a `reencode` re-encodes the last upscale's RGBA
// without re-inferring — one slot only, and only for modest outputs (≤4 MP), since a large upscaled
// RGBA is many MB (plan §5.3). Any throw → an explicit error message.
/// <reference lib="webworker" />
import { encodeUpscaled, inferUpscaledRGBA, loadUpscaler } from "./upscaler-core";
import type { ScaleFactor, UpscaleResult, WorkerRequest, WorkerResponse } from "./upscaler-types";

interface CacheSlot {
  itemKey: string;
  upscaledRGBA: ImageData;
  scale: ScaleFactor;
  width: number;
  height: number;
}

// Only cache outputs at or below this area (≤~4 MP). Larger upscaled RGBA buffers are too big to
// keep resident just for a possible re-encode (plan §5.3).
const MAX_CACHE_AREA = 4_194_304;

// One slot only. itemKey === QueueItem.id; cleared/replaced on the next upscale.
let slot: CacheSlot | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const { requestId } = req;
  try {
    if (req.type === "upscale") {
      const input = new Uint8Array(req.input);
      const upscaledRGBA = await inferUpscaledRGBA(input, req.inputFormat, req.options.scale, (p) =>
        post({ type: "progress", requestId, stage: p.stage, current: p.current, total: p.total }),
      );
      const { width, height } = upscaledRGBA;
      // Cache only modest outputs so a later reencode is cheap; drop the slot for large outputs.
      slot =
        width * height <= MAX_CACHE_AREA
          ? { itemKey: req.itemKey, upscaledRGBA, scale: req.options.scale, width, height }
          : null;
      const encoded = await encodeUpscaled(
        upscaledRGBA,
        req.options.format,
        req.options.quality,
        req.options.backgroundColor,
      );
      const result: UpscaleResult = {
        bytes: encoded.bytes,
        mime: encoded.mime,
        ext: encoded.ext,
        outputSize: encoded.bytes.length,
        scale: req.options.scale,
        width,
        height,
      };
      post({ type: "result", requestId, ok: true, result }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }

    if (req.type === "reencode") {
      if (!slot || slot.itemKey !== req.itemKey) {
        post({
          type: "error",
          requestId,
          ok: false,
          error: "Preview cache is stale — re-run the upscale for this image.",
        });
        return;
      }
      const encoded = await encodeUpscaled(
        slot.upscaledRGBA,
        req.format,
        req.quality,
        req.backgroundColor,
      );
      const result: UpscaleResult = {
        bytes: encoded.bytes,
        mime: encoded.mime,
        ext: encoded.ext,
        outputSize: encoded.bytes.length,
        scale: slot.scale,
        width: slot.width,
        height: slot.height,
      };
      post({ type: "result", requestId, ok: true, result }, [result.bytes.buffer as ArrayBuffer]);
      return;
    }

    // prefetch — warm the model: download the weights + init the TF.js backend ahead of the first
    // real run (no bytes returned). WebGL shader compilation happens on the first real upscale
    // (a marginal, browser-only extra delay; a spec-shaped dummy warmup is deferred — plan §5.2).
    await loadUpscaler(req.scale);
    const empty: UpscaleResult = {
      bytes: new Uint8Array(0),
      mime: "",
      ext: "",
      outputSize: 0,
      scale: req.scale,
      width: 0,
      height: 0,
    };
    post({ type: "result", requestId, ok: true, result: empty });
  } catch (err) {
    post({ type: "error", requestId, ok: false, error: String(err) });
  }
};
