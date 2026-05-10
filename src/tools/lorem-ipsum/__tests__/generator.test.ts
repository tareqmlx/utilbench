import { describe, expect, it } from "vitest";
import type { GenerateOptions } from "../generator";
import { generateLoremIpsum } from "../generator";

function generate(overrides: Partial<GenerateOptions> = {}, seed = 42): string {
  return generateLoremIpsum(
    {
      mode: "paragraphs",
      amount: 3,
      startWithLorem: true,
      htmlTags: false,
      ...overrides,
    },
    seed,
  );
}

describe("generateLoremIpsum", () => {
  describe("paragraphs mode", () => {
    it("generates the correct number of paragraphs", () => {
      const result = generate({ mode: "paragraphs", amount: 5 });
      const paragraphs = result.split("\n\n");
      expect(paragraphs).toHaveLength(5);
    });

    it("generates 1 paragraph when amount is 1", () => {
      const result = generate({ mode: "paragraphs", amount: 1 });
      const paragraphs = result.split("\n\n");
      expect(paragraphs).toHaveLength(1);
      expect(result.length).toBeGreaterThan(0);
    });

    it("each paragraph contains multiple sentences", () => {
      const result = generate({ mode: "paragraphs", amount: 3 });
      const paragraphs = result.split("\n\n");
      for (const p of paragraphs) {
        // Each paragraph should have at least 4 sentences (period-terminated)
        const sentenceCount = (p.match(/\./g) || []).length;
        expect(sentenceCount).toBeGreaterThanOrEqual(4);
      }
    });
  });

  describe("words mode", () => {
    it("generates the correct number of words", () => {
      const result = generate({ mode: "words", amount: 25 });
      const words = result.split(/\s+/);
      expect(words).toHaveLength(25);
    });

    it("generates exactly 1 word when amount is 1", () => {
      const result = generate({ mode: "words", amount: 1 });
      const words = result.split(/\s+/);
      expect(words).toHaveLength(1);
    });

    it("generates exactly 100 words", () => {
      const result = generate({ mode: "words", amount: 100 });
      const words = result.split(/\s+/);
      expect(words).toHaveLength(100);
    });
  });

  describe("bytes mode", () => {
    it("generates text within the byte limit", () => {
      const result = generate({ mode: "bytes", amount: 200 });
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(200);
    });

    it("generates text close to the byte limit", () => {
      const result = generate({ mode: "bytes", amount: 500 });
      const byteLength = new TextEncoder().encode(result).length;
      // Should be reasonably close to 500 (within a few bytes for trimming)
      expect(byteLength).toBeGreaterThan(450);
      expect(byteLength).toBeLessThanOrEqual(500);
    });

    it("handles small byte amounts", () => {
      const result = generate({ mode: "bytes", amount: 10 });
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(10);
    });
  });

  describe("startWithLorem option", () => {
    it("starts with 'Lorem ipsum' when enabled", () => {
      const result = generate({ startWithLorem: true });
      expect(result).toMatch(/^Lorem ipsum dolor sit amet/);
    });

    it("starts with 'Lorem ipsum' in words mode when enabled", () => {
      const result = generate({ mode: "words", amount: 20, startWithLorem: true });
      expect(result).toMatch(/^Lorem ipsum dolor sit amet/);
    });

    it("starts with 'Lorem ipsum' in bytes mode when enabled", () => {
      const result = generate({ mode: "bytes", amount: 500, startWithLorem: true });
      expect(result).toMatch(/^Lorem ipsum dolor sit amet/);
    });

    it("does NOT start with 'Lorem ipsum' when disabled", () => {
      // Use a seed that produces non-Lorem output
      const result = generate({ startWithLorem: false }, 42);
      expect(result).not.toMatch(/^Lorem ipsum/);
    });

    it("only first paragraph starts with Lorem when multiple paragraphs", () => {
      const result = generate({ mode: "paragraphs", amount: 3, startWithLorem: true });
      const paragraphs = result.split("\n\n");
      expect(paragraphs[0]).toMatch(/^Lorem ipsum/);
      // Subsequent paragraphs should not start with Lorem ipsum
      for (let i = 1; i < paragraphs.length; i++) {
        expect(paragraphs[i]).not.toMatch(/^Lorem ipsum/);
      }
    });
  });

  describe("htmlTags option", () => {
    it("wraps each paragraph in <p> tags when enabled", () => {
      const result = generate({ mode: "paragraphs", amount: 3, htmlTags: true });
      const lines = result.split("\n");
      for (const line of lines) {
        expect(line).toMatch(/^<p>.*<\/p>$/);
      }
    });

    it("wraps words output in <p> tags when enabled", () => {
      const result = generate({ mode: "words", amount: 10, htmlTags: true });
      expect(result).toMatch(/^<p>.*<\/p>$/);
    });

    it("does NOT include HTML tags when disabled", () => {
      const result = generate({ mode: "paragraphs", amount: 3, htmlTags: false });
      expect(result).not.toContain("<p>");
      expect(result).not.toContain("</p>");
    });

    it("paragraphs with HTML are separated by single newlines", () => {
      const result = generate({ mode: "paragraphs", amount: 3, htmlTags: true });
      const lines = result.split("\n");
      expect(lines).toHaveLength(3);
    });

    it("paragraphs without HTML are separated by double newlines", () => {
      const result = generate({ mode: "paragraphs", amount: 3, htmlTags: false });
      const paragraphs = result.split("\n\n");
      expect(paragraphs).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    it("returns empty string when amount is 0", () => {
      expect(generate({ amount: 0 })).toBe("");
    });

    it("returns empty string when amount is negative", () => {
      expect(generate({ amount: -5 })).toBe("");
    });

    it("paragraphs mode produces valid text for amount=1", () => {
      const result = generate({ mode: "paragraphs", amount: 1 });
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain("\n\n");
    });

    it("words mode produces valid text for amount=1", () => {
      const result = generate({ mode: "words", amount: 1 });
      expect(result.split(/\s+/)).toHaveLength(1);
    });

    it("bytes mode produces valid text for amount=1", () => {
      const result = generate({ mode: "bytes", amount: 1 });
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(1);
    });
  });

  describe("determinism", () => {
    it("produces identical output with the same seed", () => {
      const a = generate({}, 123);
      const b = generate({}, 123);
      expect(a).toBe(b);
    });

    it("produces different output with different seeds", () => {
      const a = generate({ startWithLorem: false }, 1);
      const b = generate({ startWithLorem: false }, 2);
      expect(a).not.toBe(b);
    });
  });

  describe("all modes produce valid output", () => {
    const modes: GenerateOptions["mode"][] = ["paragraphs", "words", "bytes"];

    for (const m of modes) {
      it(`${m} mode produces non-empty output`, () => {
        const result = generate({ mode: m, amount: 5 });
        expect(result.length).toBeGreaterThan(0);
      });
    }
  });
});
