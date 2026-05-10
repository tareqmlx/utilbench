import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
});

export function parseMarkdown(input: string): string {
  if (!input.trim()) return "";

  const raw = marked.parse(input) as string;

  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "disabled"],
  });
}
