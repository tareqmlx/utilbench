import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true }); // identical to markdown-preview/markdown.ts:5

// Same sanitizer allow-list + decorative-checkbox regex pass markdown-preview uses (markdown.ts:6-19).
function sanitize(raw: string): string {
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "disabled", "aria-hidden", "tabindex"],
  });

  // Task-list checkboxes are decorative reflections of `[x]` syntax; hide from assistive tech.
  const withCheckboxes = sanitized.replace(
    /<input([^>]*?)type="checkbox"([^>]*?)>/g,
    '<input$1type="checkbox"$2 aria-hidden="true" tabindex="-1">',
  );

  // External links open in a new tab so clicking a link inside the preview never navigates the SPA
  // away and discards the user's unsaved Markdown. rel hardens against reverse-tabnabbing.
  return withCheckboxes.replace(
    /<a\s+href="(https?:\/\/[^"]*)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
}

export function renderMarkdown(src: string): string {
  if (!src.trim()) return ""; // matches markdown-preview/markdown.ts:21
  // `as string` is safe only while marked runs synchronously (default async:false, no async walkTokens).
  // markdown-preview/markdown.ts:22 casts the same way — keep this note next to the cast.
  const raw = marked.parse(src) as string;
  return sanitize(raw);
}
