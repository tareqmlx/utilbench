import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks, setupImageMock, setupURLMock } from "../../../test/canvas-mock";
import {
  clampDimension,
  createBatchZip,
  downloadBlob,
  estimateSize,
  generateFilename,
  getFileExtension,
  getImageDimensions,
  getMimeType,
  getQualityForCanvas,
  isFormatSupported,
  loadImage,
  resizeImage,
  validateFile,
} from "../resizer";

describe("validateFile", () => {
  it("accepts PNG files", () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts JPEG files", () => {
    const file = new File(["data"], "test.jpg", { type: "image/jpeg" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts WebP files", () => {
    const file = new File(["data"], "test.webp", { type: "image/webp" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("rejects unsupported file types", () => {
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects SVG files", () => {
    const file = new File(["data"], "test.svg", { type: "image/svg+xml" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects files over 20MB", () => {
    const bigData = new Uint8Array(20 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("accepts files exactly 20MB", () => {
    const data = new Uint8Array(20 * 1024 * 1024);
    const file = new File([data], "exact.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it("returns warning for files over 10MB but under 20MB", () => {
    const data = new Uint8Array(15 * 1024 * 1024);
    const file = new File([data], "large.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("returns no warning for files under 10MB", () => {
    const data = new Uint8Array(5 * 1024 * 1024);
    const file = new File([data], "small.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("getMimeType", () => {
  it("returns correct MIME for JPEG", () => {
    expect(getMimeType("jpeg")).toBe("image/jpeg");
  });

  it("returns correct MIME for PNG", () => {
    expect(getMimeType("png")).toBe("image/png");
  });

  it("returns correct MIME for WebP", () => {
    expect(getMimeType("webp")).toBe("image/webp");
  });

  it("returns correct MIME for AVIF", () => {
    expect(getMimeType("avif")).toBe("image/avif");
  });
});

describe("getFileExtension", () => {
  it("returns jpg for JPEG format", () => {
    expect(getFileExtension("jpeg")).toBe("jpg");
  });

  it("returns png for PNG format", () => {
    expect(getFileExtension("png")).toBe("png");
  });

  it("returns webp for WebP format", () => {
    expect(getFileExtension("webp")).toBe("webp");
  });

  it("returns avif for AVIF format", () => {
    expect(getFileExtension("avif")).toBe("avif");
  });
});

describe("getQualityForCanvas", () => {
  it("returns undefined for PNG (lossless)", () => {
    expect(getQualityForCanvas("png", 85)).toBeUndefined();
  });

  it("returns normalized quality for JPEG", () => {
    expect(getQualityForCanvas("jpeg", 85)).toBeCloseTo(0.85);
  });

  it("returns normalized quality for WebP", () => {
    expect(getQualityForCanvas("webp", 50)).toBeCloseTo(0.5);
  });

  it("returns normalized quality for AVIF", () => {
    expect(getQualityForCanvas("avif", 100)).toBeCloseTo(1.0);
  });
});

describe("clampDimension", () => {
  it("clamps values below 1 to 1", () => {
    expect(clampDimension(0)).toBe(1);
    expect(clampDimension(-5)).toBe(1);
  });

  it("clamps values above 10000 to 10000", () => {
    expect(clampDimension(15000)).toBe(10000);
  });

  it("rounds floating point values", () => {
    expect(clampDimension(100.7)).toBe(101);
  });

  it("passes through valid integers", () => {
    expect(clampDimension(1920)).toBe(1920);
  });
});

describe("estimateSize", () => {
  it("estimates smaller size for downscale", () => {
    const estimate = estimateSize(1000000, 2000, 1000, 1000, 500, "jpeg", 85);
    expect(estimate).toBeLessThan(1000000);
  });

  it("returns at least 1KB", () => {
    const estimate = estimateSize(100, 1000, 1000, 1, 1, "jpeg", 1);
    expect(estimate).toBeGreaterThanOrEqual(1024);
  });

  it("estimates lower for WebP than JPEG at same quality", () => {
    const jpegEst = estimateSize(1000000, 2000, 1000, 1000, 500, "jpeg", 85);
    const webpEst = estimateSize(1000000, 2000, 1000, 1000, 500, "webp", 85);
    expect(webpEst).toBeLessThan(jpegEst);
  });
});

describe("generateFilename", () => {
  it("appends dimensions and extension", () => {
    const result = generateFilename("photo.png", {
      width: 800,
      height: 600,
      format: "jpeg",
      quality: 85,
    });
    expect(result).toBe("photo_800x600.jpg");
  });

  it("handles filenames with multiple dots", () => {
    const result = generateFilename("my.photo.v2.png", {
      width: 1920,
      height: 1080,
      format: "webp",
      quality: 90,
    });
    expect(result).toBe("my.photo.v2_1920x1080.webp");
  });

  it("uses correct extension for each format", () => {
    const base = { width: 100, height: 100, quality: 85 } as const;
    expect(generateFilename("img.png", { ...base, format: "jpeg" })).toContain(".jpg");
    expect(generateFilename("img.png", { ...base, format: "png" })).toContain(".png");
    expect(generateFilename("img.png", { ...base, format: "webp" })).toContain(".webp");
    expect(generateFilename("img.png", { ...base, format: "avif" })).toContain(".avif");
  });
});

describe("loadImage", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves with an image element on success", async () => {
    const img = await loadImage("blob:mock-url");
    expect(img).toBeDefined();
    expect(img.src).toBe("blob:mock-url");
  });

  it("rejects when image fails to load", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        private _src = "";
        get src() {
          return this._src;
        }
        set src(value: string) {
          this._src = value;
          queueMicrotask(() => this.onerror?.(new Error("load failed")));
        }
      },
    );
    await expect(loadImage("bad-url")).rejects.toThrow("Failed to load image");
  });
});

describe("getImageDimensions", () => {
  beforeEach(() => {
    setupAllMocks({ width: 1920, height: 1080 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves with width and height from the image", async () => {
    const file = new File(["data"], "photo.png", { type: "image/png" });
    const dims = await getImageDimensions(file);
    expect(dims.width).toBe(1920);
    expect(dims.height).toBe(1080);
  });

  it("calls URL.createObjectURL with the file", async () => {
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await getImageDimensions(file);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it("revokes object URL after success", async () => {
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await getImageDimensions(file);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("revokes object URL after error", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        private _src = "";
        get src() {
          return this._src;
        }
        set src(value: string) {
          this._src = value;
          queueMicrotask(() => this.onerror?.(new Error("fail")));
        }
      },
    );
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await expect(getImageDimensions(file)).rejects.toThrow();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("isFormatSupported", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns true for png without canvas probe", () => {
    expect(isFormatSupported("png")).toBe(true);
  });

  it("returns true for jpeg without canvas probe", () => {
    expect(isFormatSupported("jpeg")).toBe(true);
  });

  it("probes canvas for webp and returns true when supported", () => {
    expect(isFormatSupported("webp")).toBe(true);
  });

  it("returns false when canvas reports different format", () => {
    const origCE = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const el = origCE(tagName);
      if (tagName === "canvas") {
        (el as unknown as Record<string, unknown>).toDataURL = vi.fn(
          () => "data:image/png;base64,fallback",
        );
      }
      return el;
    }) as typeof document.createElement);

    expect(isFormatSupported("webp")).toBe(false);
  });
});

describe("resizeImage", () => {
  let ctx: ReturnType<typeof setupAllMocks>["ctx"];

  beforeEach(() => {
    const mocks = setupAllMocks({ width: 200, height: 200 });
    ctx = mocks.ctx;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a Blob on successful resize", async () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    const result = await resizeImage(file, {
      width: 100,
      height: 100,
      format: "jpeg",
      quality: 85,
    });
    expect(result).toBeInstanceOf(Blob);
  });

  it("uses single pass when scale factor <= 2", async () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    await resizeImage(file, { width: 100, height: 100, format: "png", quality: 100 });
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("uses two-pass downscaling when scale factor > 2", async () => {
    // Need image much larger than target for scale > 2
    setupImageMock({ width: 1000, height: 1000 });
    const file = new File(["data"], "test.png", { type: "image/png" });
    await resizeImage(file, { width: 100, height: 100, format: "jpeg", quality: 85 });
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("revokes object URL after resize", async () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    await resizeImage(file, { width: 50, height: 50, format: "jpeg", quality: 85 });
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("downloadBlob", () => {
  beforeEach(() => {
    setupURLMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("completes without throwing", () => {
    const blob = new Blob(["test"], { type: "image/png" });
    expect(() => downloadBlob(blob, "test.png")).not.toThrow();
  });

  it("calls URL.createObjectURL with the blob", () => {
    const blob = new Blob(["test"], { type: "image/png" });
    downloadBlob(blob, "test.png");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("revokes the object URL after click", () => {
    const blob = new Blob(["test"], { type: "image/png" });
    downloadBlob(blob, "test.png");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("removes the anchor element from document body", () => {
    const blob = new Blob(["test"], { type: "image/png" });
    const childCountBefore = document.body.childNodes.length;
    downloadBlob(blob, "test.png");
    expect(document.body.childNodes.length).toBe(childCountBefore);
  });
});

describe("createBatchZip", () => {
  it("returns a blob with application/zip type", async () => {
    const items = [
      { blob: new Blob(["data1"], { type: "image/png" }), filename: "a.png" },
      { blob: new Blob(["data2"], { type: "image/jpeg" }), filename: "b.jpg" },
    ];
    const result = await createBatchZip(items);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("application/zip");
  });

  it("produces a non-zero size blob", async () => {
    const items = [{ blob: new Blob(["data"], { type: "image/png" }), filename: "a.png" }];
    const result = await createBatchZip(items);
    expect(result.size).toBeGreaterThan(0);
  });
});
