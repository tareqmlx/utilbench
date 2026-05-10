import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import {
  buildDotLottie,
  detectFeatures,
  exportAsGif,
  exportFrameAsPng,
  extractMetadata,
  formatDuration,
  formatFileSize,
  generateEmbedCode,
  parseDotLottie,
  parseFile,
  parseLottieJson,
  validateFile,
} from "../lottie";
import type { LottieJSON } from "../lottie";

vi.mock("gifenc", () => ({
  GIFEncoder: vi.fn(() => ({
    writeFrame: vi.fn(),
    finish: vi.fn(),
    bytes: vi.fn(() => new Uint8Array([71, 73, 70])),
  })),
  quantize: vi.fn(() => [[0, 0, 0]]),
  applyPalette: vi.fn(() => new Uint8Array([0])),
}));

function makeLottie(overrides: Partial<LottieJSON> = {}): LottieJSON {
  return {
    w: 512,
    h: 512,
    fr: 30,
    ip: 0,
    op: 60,
    layers: [{ ty: 4 }],
    v: "5.7.0",
    nm: "Test Animation",
    ...overrides,
  };
}

describe("validateFile", () => {
  it("accepts .json files", () => {
    const file = new File(["{}"], "anim.json", { type: "application/json" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts .lottie files", () => {
    const file = new File(["data"], "anim.lottie", { type: "application/octet-stream" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("rejects unsupported file types", () => {
    const file = new File(["data"], "anim.gif", { type: "image/gif" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects files over 10MB", () => {
    const bigData = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.json", { type: "application/json" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("accepts files exactly 10MB", () => {
    const data = new Uint8Array(10 * 1024 * 1024);
    const file = new File([data], "exact.json", { type: "application/json" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it("returns warning for files over 5MB but under 10MB", () => {
    const data = new Uint8Array(7 * 1024 * 1024);
    const file = new File([data], "large.json", { type: "application/json" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("returns no warning for files under 5MB", () => {
    const data = new Uint8Array(2 * 1024 * 1024);
    const file = new File([data], "small.json", { type: "application/json" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("parseLottieJson", () => {
  it("parses valid Lottie JSON", () => {
    const json = makeLottie();
    const result = parseLottieJson(JSON.stringify(json));
    expect(result.w).toBe(512);
    expect(result.h).toBe(512);
    expect(result.fr).toBe(30);
    expect(result.layers).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLottieJson("{not json")).toThrow("Invalid JSON format");
  });

  it("throws on missing required fields", () => {
    expect(() => parseLottieJson(JSON.stringify({ w: 100 }))).toThrow("Missing required fields");
  });

  it("throws when layers is not an array", () => {
    expect(() =>
      parseLottieJson(JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 60, layers: "nope" })),
    ).toThrow("Missing required fields");
  });
});

describe("parseDotLottie", () => {
  it("parses .lottie with manifest", () => {
    const json = makeLottie({ nm: "Manifest Animation" });
    const manifest = { animations: [{ id: "hero" }] };
    const files: Record<string, Uint8Array> = {
      "manifest.json": Uint8Array.from(new TextEncoder().encode(JSON.stringify(manifest))),
      "animations/hero.json": Uint8Array.from(new TextEncoder().encode(JSON.stringify(json))),
    };
    const zipped = zipSync(files);
    const result = parseDotLottie(zipped);
    expect(result.nm).toBe("Manifest Animation");
  });

  it("falls back to any .json file", () => {
    const json = makeLottie({ nm: "Fallback" });
    const files: Record<string, Uint8Array> = {
      "data.json": Uint8Array.from(new TextEncoder().encode(JSON.stringify(json))),
    };
    const zipped = zipSync(files);
    const result = parseDotLottie(zipped);
    expect(result.nm).toBe("Fallback");
  });

  it("throws on invalid zip", () => {
    const badBuffer = new ArrayBuffer(10);
    expect(() => parseDotLottie(badBuffer)).toThrow("Failed to decompress");
  });
});

describe("extractMetadata", () => {
  it("computes correct metadata", () => {
    const json = makeLottie({ w: 1080, h: 1080, fr: 60, ip: 0, op: 253 });
    const file = new File(["x".repeat(145000)], "hero.json", { type: "application/json" });
    const meta = extractMetadata(json, file);

    expect(meta.filename).toBe("hero.json");
    expect(meta.fileSize).toBe(145000);
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
    expect(meta.frameRate).toBe(60);
    expect(meta.totalFrames).toBe(253);
    expect(meta.duration).toBeCloseTo(253 / 60, 5);
    expect(meta.version).toBe("5.7.0");
    expect(meta.animationName).toBe("Test Animation");
  });

  it("handles missing optional fields", () => {
    const json = makeLottie({ v: undefined, nm: undefined });
    const file = new File(["data"], "test.json");
    const meta = extractMetadata(json, file);
    expect(meta.version).toBe("Unknown");
    expect(meta.animationName).toBe("Untitled");
  });
});

describe("detectFeatures", () => {
  it("detects shapes", () => {
    const json = makeLottie({ layers: [{ ty: 4, shapes: [{ ty: "sh" }] }] });
    const features = detectFeatures(json);
    expect(features.some((f) => f.tag === "shapes")).toBe(true);
    expect(features.find((f) => f.tag === "shapes")?.level).toBe("info");
  });

  it("detects gradients", () => {
    const json = makeLottie({ layers: [{ ty: 4, shapes: [{ ty: "gf" }] }] });
    const features = detectFeatures(json);
    expect(features.some((f) => f.tag === "gradients")).toBe(true);
  });

  it("detects 3D layers as warning", () => {
    const json = makeLottie({ ddd: 1 });
    const features = detectFeatures(json);
    const f3d = features.find((f) => f.tag === "3d");
    expect(f3d).toBeDefined();
    expect(f3d?.level).toBe("warning");
  });

  it("detects effects as warning", () => {
    const json = makeLottie({ layers: [{ ty: 4, ef: [{ ty: 29 }] }] });
    const features = detectFeatures(json);
    const fx = features.find((f) => f.tag === "effects");
    expect(fx).toBeDefined();
    expect(fx?.level).toBe("warning");
  });

  it("detects text layers", () => {
    const json = makeLottie({ layers: [{ ty: 5 }] });
    const features = detectFeatures(json);
    expect(features.some((f) => f.tag === "text")).toBe(true);
  });

  it("detects trim paths", () => {
    const json = makeLottie({ layers: [{ ty: 4, shapes: [{ ty: "tm" }] }] });
    const features = detectFeatures(json);
    expect(features.some((f) => f.tag === "trim-paths")).toBe(true);
  });

  it("detects repeaters", () => {
    const json = makeLottie({ layers: [{ ty: 4, shapes: [{ ty: "rp" }] }] });
    const features = detectFeatures(json);
    expect(features.some((f) => f.tag === "repeaters")).toBe(true);
  });

  it("returns empty array for featureless animation", () => {
    const json = makeLottie({ layers: [{ ty: 0 }], ddd: 0 });
    const features = detectFeatures(json);
    expect(features).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats seconds with padding", () => {
    expect(formatDuration(5)).toBe("0:05");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("handles NaN", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });

  it("handles negative values", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("handles Infinity", () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("formats zero", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });
});

describe("buildDotLottie", () => {
  it("produces a Blob", () => {
    const json = makeLottie();
    const blob = buildDotLottie(json);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("produces valid ZIP with manifest and animation", async () => {
    const json = makeLottie({ nm: "Packed" });
    const blob = buildDotLottie(json);
    const buffer = await blob.arrayBuffer();
    const result = parseDotLottie(buffer);
    expect(result.nm).toBe("Packed");
  });
});

describe("generateEmbedCode", () => {
  it("returns HTML with lottie-player", () => {
    const code = generateEmbedCode();
    expect(code).toContain("<lottie-player");
    expect(code).toContain("<script");
    expect(code).toContain("lottie-player.js");
  });

  it("includes autoplay and loop attributes", () => {
    const code = generateEmbedCode();
    expect(code).toContain("autoplay");
    expect(code).toContain("loop");
  });
});

describe("parseFile", () => {
  it("parses .json file via text()", async () => {
    const json = makeLottie({ nm: "JsonParse" });
    const file = new File([JSON.stringify(json)], "anim.json", { type: "application/json" });
    const result = await parseFile(file);
    expect(result.nm).toBe("JsonParse");
    expect(result.w).toBe(512);
  });

  it("parses .lottie file via arrayBuffer()", async () => {
    const json = makeLottie({ nm: "ZipParse" });
    const manifest = { animations: [{ id: "anim" }] };
    const files: Record<string, Uint8Array> = {
      "manifest.json": Uint8Array.from(new TextEncoder().encode(JSON.stringify(manifest))),
      "animations/anim.json": Uint8Array.from(new TextEncoder().encode(JSON.stringify(json))),
    };
    const zipped = zipSync(files);
    const file = new File([zipped], "anim.lottie", { type: "application/octet-stream" });
    const result = await parseFile(file);
    expect(result.nm).toBe("ZipParse");
  });

  it("throws on invalid .json content", async () => {
    const file = new File(["not json"], "bad.json", { type: "application/json" });
    await expect(parseFile(file)).rejects.toThrow("Invalid JSON");
  });

  it("throws on invalid .lottie content", async () => {
    const file = new File([new Uint8Array(10)], "bad.lottie");
    await expect(parseFile(file)).rejects.toThrow("Failed to decompress");
  });
});

describe("exportFrameAsPng", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a PNG Blob from an SVG element", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");

    const blob = await exportFrameAsPng(svg, 100, 100);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("creates a canvas with specified dimensions", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    await exportFrameAsPng(svg, 200, 150);
    // Verify canvas was created (via createElement)
    expect(document.createElement).toHaveBeenCalledWith("canvas");
  });

  it("revokes the object URL after export", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    await exportFrameAsPng(svg, 100, 100);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("exportAsGif", () => {
  beforeEach(() => {
    setupAllMocks();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 0;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports animation as GIF blob", async () => {
    const container = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.appendChild(svg);
    const lottieInstance = { goToAndStop: vi.fn() };

    const blob = await exportAsGif(container, 100, 100, 3, lottieInstance);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/gif");
  });

  it("calls goToAndStop for each frame", async () => {
    const container = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.appendChild(svg);
    const lottieInstance = { goToAndStop: vi.fn() };

    await exportAsGif(container, 50, 50, 5, lottieInstance);
    expect(lottieInstance.goToAndStop).toHaveBeenCalledTimes(5);
    expect(lottieInstance.goToAndStop).toHaveBeenCalledWith(0, true);
    expect(lottieInstance.goToAndStop).toHaveBeenCalledWith(4, true);
  });

  it("skips frames when no SVG is found in container", async () => {
    const container = document.createElement("div");
    // No SVG child
    const lottieInstance = { goToAndStop: vi.fn() };

    const blob = await exportAsGif(container, 50, 50, 2, lottieInstance);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/gif");
  });
});
