// Dedicated module Worker for image-compress (plan §7). Thin shell: all logic
// lives in compressor-core.ts (DOM-free, unit-tested). Receives a request,
// decodes + encodes + runs the regression guard, and posts the full
// CompressResult back, transferring ONLY the output buffer (never re-transferring
// the input). On any throw it posts an explicit error so the client rejects and
// the batch loop continues to the next item.
/// <reference lib="webworker" />
import type { NormFormat } from "@/lib/image";
import { compressImageData } from "./compressor-core";
import type { CompressOptions, CompressResult } from "./compressor-types";

export interface WorkerRequest {
  input: Uint8Array;
  inputFormat: NormFormat;
  options: CompressOptions;
  requestId: number;
}

export type WorkerResponse =
  | { requestId: number; ok: true; result: CompressResult }
  | { requestId: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { input, inputFormat, options, requestId } = e.data;
  try {
    const result = await compressImageData(input, inputFormat, options);
    const res: WorkerResponse = { requestId, ok: true, result };
    // Transfer only the freshly-created output buffer back.
    self.postMessage(res, [result.bytes.buffer]);
  } catch (err) {
    const res: WorkerResponse = { requestId, ok: false, error: String(err) };
    self.postMessage(res);
  }
};
