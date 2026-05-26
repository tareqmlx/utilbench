import { type SvgOptimizerOptions, createZipBlob, optimizeSvg } from "./svg-optimizer";

interface TaskMessage {
  id: string;
  type: string;
  payload: unknown;
}

interface OptimizePayload {
  content: string;
  options: SvgOptimizerOptions;
}

interface ZipPayload {
  files: Array<{ name: string; content: string }>;
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<TaskMessage>) => {
  const { id, type, payload } = e.data;

  try {
    switch (type) {
      case "optimize-svg": {
        const { content, options } = payload as OptimizePayload;
        const result = optimizeSvg(content, options);
        self.postMessage({ id, type, result });
        break;
      }
      case "zip-svgs": {
        const { files } = payload as ZipPayload;
        const blob = createZipBlob(files);
        const buffer = await blob.arrayBuffer();
        self.postMessage({ id, type, result: buffer }, [buffer]);
        break;
      }
      default:
        self.postMessage({ id, type, error: `Unknown task type: ${type}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    self.postMessage({ id, type, error: message });
  }
};
