import { describe, expect, it } from "vitest";
// One-off test-only cross-layer import: `src/lib` reaching into `src/tools/markdown-preview`
// to assert renderMarkdown/parseMarkdown stay in lockstep. The `?worker` import in that module
// is auto-stubbed under the vitest config, so importing it here is safe.
import { parseMarkdown } from "../../tools/markdown-preview/markdown";
import { renderMarkdown } from "../markdown";
import { MARKDOWN_FIXTURES } from "./fixtures/markdown";

describe("renderMarkdown", () => {
  describe("basic formatting", () => {
    it("renders headings", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.heading);
      expect(result).toContain("<h1");
      expect(result).toContain("<h2");
      expect(result).toContain("<h3");
    });

    it("renders bold text", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.bold);
      expect(result).toContain("<strong>bold</strong>");
    });

    it("renders italic text", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.italic);
      expect(result).toContain("<em>italic</em>");
    });

    it("renders links", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.link);
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain("link</a>");
    });

    it("renders unordered lists", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.unorderedList);
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>item 1</li>");
      expect(result).toContain("<li>item 2</li>");
    });

    it("renders ordered lists", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.orderedList);
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>first</li>");
      expect(result).toContain("<li>second</li>");
    });
  });

  describe("GFM extensions", () => {
    it("renders tables", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.table);
      expect(result).toContain("<table>");
      expect(result).toContain("<th>A</th>");
      expect(result).toContain("<td>1</td>");
    });

    it("renders task lists", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.taskList);
      expect(result).toContain('type="checkbox"');
      expect(result).toContain("checked");
    });

    it("marks task-list checkboxes as decorative for screen readers", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.taskList);
      // Both checkboxes should carry aria-hidden and tabindex=-1 — they reflect `[x]` syntax, not interactive controls.
      const matches = result.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(matches).toHaveLength(2);
      for (const tag of matches) {
        expect(tag).toContain('aria-hidden="true"');
        expect(tag).toContain('tabindex="-1"');
      }
    });

    it("renders strikethrough", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.strikethrough);
      expect(result).toContain("<del>deleted</del>");
    });

    it("renders autolinks", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.autolink);
      expect(result).toContain('<a href="https://example.com"');
    });
  });

  describe("XSS prevention", () => {
    it("strips script tags", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.rawHtmlScript);
      expect(result).not.toContain("<script");
    });

    it("strips event handler attributes", () => {
      const result = renderMarkdown(MARKDOWN_FIXTURES.imgOnerror);
      expect(result).not.toContain("onerror");
    });

    it("strips javascript: hrefs", () => {
      const result = renderMarkdown("[x](javascript:alert(1))");
      expect(result).not.toContain("javascript:");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(renderMarkdown(MARKDOWN_FIXTURES.empty)).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(renderMarkdown("   \n  \t  ")).toBe("");
    });
  });

  describe("parity with markdown-preview parseMarkdown", () => {
    // Fork guard: renderMarkdown and parseMarkdown share identical render logic.
    // Keep them byte-for-byte equal across every fixture until they intentionally converge into one.
    for (const [name, src] of Object.entries(MARKDOWN_FIXTURES)) {
      it(`matches parseMarkdown for fixture "${name}"`, () => {
        expect(renderMarkdown(src)).toBe(parseMarkdown(src));
      });
    }
  });
});
