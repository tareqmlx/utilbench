import { marked } from "marked";

marked.setOptions({ gfm: true });

interface ParseRequest {
  id: number;
  markdown: string;
}

interface ParseResponse {
  id: number;
  html?: string;
  error?: string;
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, markdown } = e.data;
  try {
    const html = markdown.trim() ? (marked.parse(markdown) as string) : "";
    const response: ParseResponse = { id, html };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    const response: ParseResponse = { id, error: message };
    self.postMessage(response);
  }
};
