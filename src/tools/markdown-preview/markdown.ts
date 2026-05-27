import DOMPurify from "dompurify";
import { marked } from "marked";
import MarkdownWorker from "./markdown.worker.ts?worker";

marked.setOptions({ gfm: true });

function sanitize(raw: string): string {
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "disabled", "aria-hidden", "tabindex"],
  });

  // Task-list checkboxes are decorative reflections of `[x]` syntax; hide from assistive tech.
  return sanitized.replace(
    /<input([^>]*?)type="checkbox"([^>]*?)>/g,
    '<input$1type="checkbox"$2 aria-hidden="true" tabindex="-1">',
  );
}

export function parseMarkdown(input: string): string {
  if (!input.trim()) return "";
  const raw = marked.parse(input) as string;
  return sanitize(raw);
}

interface ParseResponse {
  id: number;
  html?: string;
  error?: string;
}

interface Pending {
  resolve: (html: string) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    const w = new MarkdownWorker();
    w.onmessage = (e: MessageEvent<ParseResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) {
        p.reject(new Error(e.data.error));
      } else {
        p.resolve(e.data.html ?? "");
      }
    };
    w.onerror = (ev: ErrorEvent) => {
      const err = new Error(ev.message || "Markdown worker error");
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(err);
      }
    };
    worker = w;
    return w;
  } catch {
    return null;
  }
}

export async function parseMarkdownAsync(input: string): Promise<string> {
  if (!input.trim()) return "";
  const w = getWorker();
  if (!w) return parseMarkdown(input);
  const raw = await new Promise<string>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, markdown: input });
  });
  return sanitize(raw);
}

export function disposeMarkdownWorker(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(new Error("Markdown worker disposed"));
  }
}
