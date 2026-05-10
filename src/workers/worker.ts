import { createTwoFilesPatch, diffLines } from "diff";

interface TaskMessage {
  id: string;
  type: string;
  payload: unknown;
}

interface DiffPayload {
  original: string;
  modified: string;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<TaskMessage>) => {
  const { id, type, payload } = e.data;

  switch (type) {
    case "ping":
      self.postMessage({ id, type: "ping", result: "pong" });
      break;
    case "compute-diff": {
      const { original, modified, ignoreCase, ignoreWhitespace } = payload as DiffPayload;
      const changes = diffLines(original, modified, {
        ignoreCase,
        ignoreWhitespace,
      });
      const unifiedPatch = createTwoFilesPatch("Original", "Modified", original, modified);
      self.postMessage({ id, type, result: { changes, unifiedPatch } });
      break;
    }
    default:
      self.postMessage({ id, type, error: `Unknown task type: ${type}` });
  }
};
