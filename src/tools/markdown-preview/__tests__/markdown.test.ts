import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../markdown";

describe("parseMarkdown", () => {
  describe("basic formatting", () => {
    it("renders headings", () => {
      expect(parseMarkdown("# Heading 1")).toContain("<h1");
      expect(parseMarkdown("## Heading 2")).toContain("<h2");
      expect(parseMarkdown("### Heading 3")).toContain("<h3");
    });

    it("renders bold text", () => {
      const result = parseMarkdown("**bold**");
      expect(result).toContain("<strong>bold</strong>");
    });

    it("renders italic text", () => {
      const result = parseMarkdown("*italic*");
      expect(result).toContain("<em>italic</em>");
    });

    it("renders links", () => {
      const result = parseMarkdown("[link](https://example.com)");
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain("link</a>");
    });

    it("renders unordered lists", () => {
      const result = parseMarkdown("- item 1\n- item 2");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>item 1</li>");
      expect(result).toContain("<li>item 2</li>");
    });

    it("renders ordered lists", () => {
      const result = parseMarkdown("1. first\n2. second");
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>first</li>");
      expect(result).toContain("<li>second</li>");
    });
  });

  describe("GFM extensions", () => {
    it("renders tables", () => {
      const input = "| A | B |\n|---|---|\n| 1 | 2 |";
      const result = parseMarkdown(input);
      expect(result).toContain("<table>");
      expect(result).toContain("<th>A</th>");
      expect(result).toContain("<td>1</td>");
    });

    it("renders task lists", () => {
      const input = "- [x] done\n- [ ] todo";
      const result = parseMarkdown(input);
      expect(result).toContain('type="checkbox"');
      expect(result).toContain("checked");
    });

    it("marks task-list checkboxes as decorative for screen readers", () => {
      const input = "- [x] done\n- [ ] todo";
      const result = parseMarkdown(input);
      // Both checkboxes should carry aria-hidden and tabindex=-1 — they reflect `[x]` syntax, not interactive controls.
      const matches = result.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(matches).toHaveLength(2);
      for (const tag of matches) {
        expect(tag).toContain('aria-hidden="true"');
        expect(tag).toContain('tabindex="-1"');
      }
    });

    it("renders strikethrough", () => {
      const result = parseMarkdown("~~deleted~~");
      expect(result).toContain("<del>deleted</del>");
    });

    it("renders autolinks", () => {
      const result = parseMarkdown("https://example.com");
      expect(result).toContain('<a href="https://example.com"');
    });
  });

  describe("XSS prevention", () => {
    it("strips script tags", () => {
      const result = parseMarkdown('<script>alert("xss")</script>');
      expect(result).not.toContain("<script");
    });

    it("strips event handler attributes", () => {
      const result = parseMarkdown('<img src="x" onerror="alert(1)">');
      expect(result).not.toContain("onerror");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(parseMarkdown("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(parseMarkdown("   \n  \t  ")).toBe("");
    });
  });
});
