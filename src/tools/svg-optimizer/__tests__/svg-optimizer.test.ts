import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  PRESET_CONFIGS,
  calculateReduction,
  createSvgBlob,
  createZipBlob,
  formatFileSize,
  optimizeSvg,
  validateSvgContent,
  validateSvgFile,
} from "../svg-optimizer";

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- A comment -->
  <circle cx="50" cy="50" r="40" fill="red"/>
</svg>`;

const MINIMAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

describe("validateSvgContent", () => {
  it("accepts valid SVG content", () => {
    expect(validateSvgContent(SIMPLE_SVG)).toEqual({ valid: true });
  });

  it("accepts minimal SVG", () => {
    expect(validateSvgContent(MINIMAL_SVG)).toEqual({ valid: true });
  });

  it("rejects empty content", () => {
    const result = validateSvgContent("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("rejects whitespace-only content", () => {
    const result = validateSvgContent("   \n  ");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("rejects content without svg tag", () => {
    const result = validateSvgContent("<div>not svg</div>");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No <svg>");
  });

  it("rejects invalid XML", () => {
    const result = validateSvgContent("<svg><unclosed");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid XML");
  });
});

describe("validateSvgFile", () => {
  it("accepts SVG files by MIME type", () => {
    const file = new File(["<svg></svg>"], "test.svg", { type: "image/svg+xml" });
    expect(validateSvgFile(file)).toEqual({ valid: true });
  });

  it("accepts SVG files by extension", () => {
    const file = new File(["<svg></svg>"], "test.svg", { type: "" });
    expect(validateSvgFile(file)).toEqual({ valid: true });
  });

  it("rejects non-SVG files", () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    const result = validateSvgFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects files over 10MB", () => {
    const bigData = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.svg", { type: "image/svg+xml" });
    const result = validateSvgFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("accepts files exactly 10MB", () => {
    const data = new Uint8Array(10 * 1024 * 1024);
    const file = new File([data], "exact.svg", { type: "image/svg+xml" });
    const result = validateSvgFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it("returns warning for files over 5MB but under 10MB", () => {
    const data = new Uint8Array(7 * 1024 * 1024);
    const file = new File([data], "large.svg", { type: "image/svg+xml" });
    const result = validateSvgFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("returns no warning for files under 5MB", () => {
    const data = new Uint8Array(2 * 1024 * 1024);
    const file = new File([data], "small.svg", { type: "image/svg+xml" });
    const result = validateSvgFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("optimizeSvg", () => {
  it("produces valid SVG output", () => {
    const result = optimizeSvg(SIMPLE_SVG, DEFAULT_OPTIONS);
    expect(result).toContain("<svg");
    expect(result).toContain("</svg>");
  });

  it("reduces size of SVG with comments", () => {
    const result = optimizeSvg(SIMPLE_SVG, DEFAULT_OPTIONS);
    expect(result.length).toBeLessThan(SIMPLE_SVG.length);
  });

  it("strips comments when removeComments is enabled", () => {
    const result = optimizeSvg(SIMPLE_SVG, { ...DEFAULT_OPTIONS, removeComments: true });
    expect(result).not.toContain("<!--");
  });

  it("strips metadata when removeMetadata is enabled", () => {
    const svgWithMetadata = `<svg xmlns="http://www.w3.org/2000/svg">
      <metadata>Some metadata</metadata>
      <rect width="1" height="1"/>
    </svg>`;
    const result = optimizeSvg(svgWithMetadata, { ...DEFAULT_OPTIONS, removeMetadata: true });
    expect(result).not.toContain("<metadata");
  });

  it("preserves SVG structure", () => {
    const result = optimizeSvg(SIMPLE_SVG, DEFAULT_OPTIONS);
    expect(result).toContain("circle");
  });
});

describe("createZipBlob", () => {
  it("returns a Blob with correct MIME type", () => {
    const blob = createZipBlob([{ name: "test.svg", content: MINIMAL_SVG }]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("returns a blob with non-zero size", () => {
    const blob = createZipBlob([
      { name: "a.svg", content: MINIMAL_SVG },
      { name: "b.svg", content: MINIMAL_SVG },
    ]);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats kilobytes with decimals", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("calculateReduction", () => {
  it("calculates correct percentage", () => {
    expect(calculateReduction(100, 40)).toBe(60);
  });

  it("returns 0 for zero original size", () => {
    expect(calculateReduction(0, 0)).toBe(0);
  });

  it("returns 100 for fully reduced", () => {
    expect(calculateReduction(100, 0)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(calculateReduction(3, 1)).toBe(67);
  });
});

describe("PRESET_CONFIGS", () => {
  it("has all four presets", () => {
    expect(Object.keys(PRESET_CONFIGS)).toEqual(["ui-icons", "mobile", "print", "legacy"]);
  });

  it("ui-icons has prefixIds enabled", () => {
    expect(PRESET_CONFIGS["ui-icons"].prefixIds).toBe(true);
  });

  it("mobile has prefixIds disabled", () => {
    expect(PRESET_CONFIGS.mobile.prefixIds).toBe(false);
  });

  it("print preserves metadata", () => {
    expect(PRESET_CONFIGS.print.removeMetadata).toBe(false);
  });

  it("legacy disables path simplification", () => {
    expect(PRESET_CONFIGS.legacy.simplifyPaths).toBe(false);
  });

  it("all presets remove comments", () => {
    for (const preset of Object.values(PRESET_CONFIGS)) {
      expect(preset.removeComments).toBe(true);
    }
  });
});

describe("DEFAULT_OPTIONS", () => {
  it("has prefixIds disabled by default", () => {
    expect(DEFAULT_OPTIONS.prefixIds).toBe(false);
  });

  it("has all other options enabled by default", () => {
    expect(DEFAULT_OPTIONS.removeComments).toBe(true);
    expect(DEFAULT_OPTIONS.removeMetadata).toBe(true);
    expect(DEFAULT_OPTIONS.simplifyPaths).toBe(true);
    expect(DEFAULT_OPTIONS.removeUnusedIds).toBe(true);
    expect(DEFAULT_OPTIONS.convertColorsToHex).toBe(true);
  });
});

describe("createSvgBlob", () => {
  it("returns a Blob with correct MIME type", () => {
    const blob = createSvgBlob(MINIMAL_SVG);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/svg+xml");
  });

  it("has correct size matching input content", () => {
    const blob = createSvgBlob(MINIMAL_SVG);
    expect(blob.size).toBe(new TextEncoder().encode(MINIMAL_SVG).length);
  });
});

describe("optimizeSvg edge cases", () => {
  it("handles all options disabled", () => {
    const allDisabled = {
      removeComments: false,
      removeMetadata: false,
      simplifyPaths: false,
      removeUnusedIds: false,
      prefixIds: false,
      convertColorsToHex: false,
    };
    const result = optimizeSvg(SIMPLE_SVG, allDisabled);
    expect(result).toContain("<svg");
  });

  it("adds prefixIds plugin when enabled", () => {
    const withPrefix = { ...DEFAULT_OPTIONS, prefixIds: true };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="grad"><stop offset="0"/></linearGradient></defs>
      <rect fill="url(#grad)" width="1" height="1"/>
    </svg>`;
    const result = optimizeSvg(svg, withPrefix);
    expect(result).toContain("<svg");
    // IDs should be prefixed (won't match original "grad" exactly)
    expect(result).not.toContain('id="grad"');
  });

  it("preserves comments when removeComments is disabled", () => {
    const opts = { ...DEFAULT_OPTIONS, removeComments: false };
    const result = optimizeSvg(SIMPLE_SVG, opts);
    expect(result).toContain("<!--");
  });
});
