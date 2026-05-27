import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
});

export function parseMarkdown(input: string): string {
  if (!input.trim()) return "";

  const raw = marked.parse(input) as string;

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
