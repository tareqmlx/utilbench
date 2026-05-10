import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import {
  canvasToBlob,
  encodeIco,
  generateFaviconPack,
  generateWebManifest,
  getSizesForFormat,
  loadImage,
  renderPreview,
  renderToCanvas,
  validateFile,
} from "../favicon";

describe("validateFile", () => {
  it("accepts PNG files", () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts JPEG files", () => {
    const file = new File(["data"], "test.jpg", { type: "image/jpeg" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts SVG files", () => {
    const file = new File(["data"], "test.svg", { type: "image/svg+xml" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("rejects unsupported file types", () => {
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects files over 5MB", () => {
    const bigData = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("accepts files exactly 5MB", () => {
    const data = new Uint8Array(5 * 1024 * 1024);
    const file = new File([data], "exact.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it("returns warning for files over 2.5MB but under 5MB", () => {
    const data = new Uint8Array(3 * 1024 * 1024);
    const file = new File([data], "large.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("returns no warning for files under 2.5MB", () => {
    const data = new Uint8Array(1 * 1024 * 1024);
    const file = new File([data], "small.png", { type: "image/png" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("encodeIco", () => {
  // Create a minimal valid PNG buffer (just the header for dimension reading)
  function createFakePng(width: number, height: number): ArrayBuffer {
    const buf = new ArrayBuffer(24);
    const view = new DataView(buf);
    // PNG signature (8 bytes)
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < sig.length; i++) {
      const byte = sig[i];
      if (byte !== undefined) view.setUint8(i, byte);
    }
    // IHDR chunk length (4 bytes)
    view.setUint32(8, 13, false);
    // IHDR signature
    view.setUint8(12, 0x49); // I
    view.setUint8(13, 0x48); // H
    view.setUint8(14, 0x44); // D
    view.setUint8(15, 0x52); // R
    // Width and height (big-endian)
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return buf;
  }

  it("produces valid ICO magic bytes", () => {
    const png16 = createFakePng(16, 16);
    const ico = encodeIco([png16]);
    const view = new DataView(ico.buffer);

    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // type = ICO
  });

  it("sets correct image count in header", () => {
    const buffers = [createFakePng(16, 16), createFakePng(32, 32), createFakePng(48, 48)];
    const ico = encodeIco(buffers);
    const view = new DataView(ico.buffer);

    expect(view.getUint16(4, true)).toBe(3);
  });

  it("sets correct dimensions in directory entries", () => {
    const png16 = createFakePng(16, 16);
    const png32 = createFakePng(32, 32);
    const ico = encodeIco([png16, png32]);
    const view = new DataView(ico.buffer);

    // First entry at offset 6
    expect(view.getUint8(6)).toBe(16); // width
    expect(view.getUint8(7)).toBe(16); // height

    // Second entry at offset 22
    expect(view.getUint8(22)).toBe(32); // width
    expect(view.getUint8(23)).toBe(32); // height
  });

  it("calculates correct data offsets", () => {
    const png16 = createFakePng(16, 16);
    const png32 = createFakePng(32, 32);
    const ico = encodeIco([png16, png32]);
    const view = new DataView(ico.buffer);

    // Header(6) + 2 entries(32) = 38 bytes before data
    const firstOffset = view.getUint32(18, true); // offset field of first entry
    expect(firstOffset).toBe(38);

    const secondOffset = view.getUint32(34, true); // offset field of second entry
    expect(secondOffset).toBe(38 + png16.byteLength);
  });

  it("produces correct total size", () => {
    const png16 = createFakePng(16, 16);
    const png32 = createFakePng(32, 32);
    const ico = encodeIco([png16, png32]);

    // 6 (header) + 32 (2 entries) + 24 + 24 (data)
    expect(ico.byteLength).toBe(6 + 32 + 24 + 24);
  });
});

describe("generateWebManifest", () => {
  it("returns valid JSON", () => {
    const manifest = generateWebManifest();
    expect(() => JSON.parse(manifest)).not.toThrow();
  });

  it("includes 192x192 and 512x512 icons", () => {
    const manifest = JSON.parse(generateWebManifest());
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[0].sizes).toBe("192x192");
    expect(manifest.icons[1].sizes).toBe("512x512");
  });

  it("uses correct MIME type for icons", () => {
    const manifest = JSON.parse(generateWebManifest());
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
    }
  });
});

describe("getSizesForFormat", () => {
  it("returns ICO sizes for ico-only format", () => {
    const sizes = getSizesForFormat("ico-only");
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("returns all sizes for recommended format", () => {
    const sizes = getSizesForFormat("recommended");
    expect(sizes).toEqual([16, 32, 48, 64, 128, 180, 192, 512]);
  });

  it("returns all sizes for modern-only format", () => {
    const sizes = getSizesForFormat("modern-only");
    expect(sizes).toEqual([16, 32, 48, 64, 128, 180, 192, 512]);
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

  it("resolves with an image element", async () => {
    const img = await loadImage("data:image/png;base64,test");
    expect(img).toBeDefined();
    expect(img.src).toBe("data:image/png;base64,test");
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
          queueMicrotask(() => this.onerror?.(new Error("fail")));
        }
      },
    );
    await expect(loadImage("bad-data")).rejects.toThrow("Failed to load image");
  });
});

describe("renderToCanvas", () => {
  let ctx: ReturnType<typeof setupAllMocks>["ctx"];

  beforeEach(() => {
    const mocks = setupAllMocks();
    ctx = mocks.ctx;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a canvas element with correct dimensions", () => {
    const img = new Image();
    const canvas = renderToCanvas(img, 64, "#ffffff", "none");
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
  });

  it("fills background and draws image", () => {
    const img = new Image();
    renderToCanvas(img, 32, "#ff0000", "none");
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("applies clip path for soft rounding", () => {
    const img = new Image();
    renderToCanvas(img, 48, "#000000", "soft");
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.roundRect).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalled();
  });

  it("applies clip path for circle rounding", () => {
    const img = new Image();
    renderToCanvas(img, 48, "#000000", "circle");
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalled();
  });

  it("does not clip for none rounding", () => {
    const img = new Image();
    renderToCanvas(img, 48, "#000000", "none");
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  it("saves and restores context", () => {
    const img = new Image();
    renderToCanvas(img, 48, "#000000", "soft");
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });
});

describe("canvasToBlob", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves with a Blob", async () => {
    const canvas = document.createElement("canvas");
    const blob = await canvasToBlob(canvas);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("rejects when toBlob returns null", async () => {
    const canvas = document.createElement("canvas");
    (canvas as unknown as Record<string, unknown>).toBlob = vi.fn((cb: BlobCallback) => cb(null));
    await expect(canvasToBlob(canvas)).rejects.toThrow("Failed to create blob");
  });
});

describe("renderPreview", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a data URL string", async () => {
    const result = await renderPreview("data:image/png;base64,test", 64, "#ffffff", "none");
    expect(result).toContain("data:image/png");
  });
});

describe("generateFaviconPack", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a ZIP blob for recommended format", async () => {
    const blob = await generateFaviconPack("data:image/png;base64,test", {
      backgroundColor: "#ffffff",
      cornerRounding: "none",
      exportFormat: "recommended",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("returns an ICO blob for ico-only format", async () => {
    const blob = await generateFaviconPack("data:image/png;base64,test", {
      backgroundColor: "#ffffff",
      cornerRounding: "none",
      exportFormat: "ico-only",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/x-icon");
  });

  it("includes SVG content when provided", async () => {
    const blob = await generateFaviconPack("data:image/png;base64,test", {
      backgroundColor: "#ffffff",
      cornerRounding: "none",
      exportFormat: "recommended",
      svgContent: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("returns a ZIP blob for modern-only format", async () => {
    const blob = await generateFaviconPack("data:image/png;base64,test", {
      backgroundColor: "#000000",
      cornerRounding: "circle",
      exportFormat: "modern-only",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });
});
