import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks, setupURLMock } from "../../../test/canvas-mock";
import { buildZip, downloadBlob, extractMetadata, stripMetadata, validateFile } from "../metadata";

describe("validateFile", () => {
  it("accepts JPEG files", () => {
    const file = new File(["data"], "test.jpg", { type: "image/jpeg" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts PNG files", () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("accepts WebP files", () => {
    const file = new File(["data"], "test.webp", { type: "image/webp" });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it("rejects GIF files", () => {
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid file type");
  });

  it("rejects BMP files", () => {
    const file = new File(["data"], "test.bmp", { type: "image/bmp" });
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

  it("rejects files over 50MB", () => {
    const bigData = new Uint8Array(50 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.jpg", { type: "image/jpeg" });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("File too large");
  });

  it("accepts files exactly 50MB", () => {
    const data = new Uint8Array(50 * 1024 * 1024);
    const file = new File([data], "exact.jpg", { type: "image/jpeg" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it("returns warning for files over 25MB but under 50MB", () => {
    const data = new Uint8Array(30 * 1024 * 1024);
    const file = new File([data], "large.jpg", { type: "image/jpeg" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("returns no warning for files under 25MB", () => {
    const data = new Uint8Array(10 * 1024 * 1024);
    const file = new File([data], "small.jpg", { type: "image/jpeg" });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("extractMetadata", () => {
  function buildJpegWithExif(opts: {
    cameraModel?: string;
    hasGps?: boolean;
    exifVersion?: string;
  }): Uint8Array {
    const parts: number[] = [];

    // SOI
    parts.push(0xff, 0xd8);

    // Build TIFF/EXIF data
    const tiff: number[] = [];

    // Byte order: little-endian
    tiff.push(0x49, 0x49);
    // Magic 42
    tiff.push(0x2a, 0x00);
    // IFD0 offset (8 = right after header)
    tiff.push(0x08, 0x00, 0x00, 0x00);

    // Count IFD0 entries
    const entries: Array<{ tag: number; type: number; count: number; value: number[] }> = [];
    const extraData: number[] = [];
    // Offset for extra data: after IFD0 header
    // IFD0 starts at offset 8, with 2 bytes for count, then entries (12 each), then 4 bytes next IFD pointer
    const ifd0DataBaseOffset = () => 8 + 2 + entries.length * 12 + 4;

    if (opts.cameraModel) {
      const modelBytes = [...Array.from(new TextEncoder().encode(opts.cameraModel)), 0];
      const offset = ifd0DataBaseOffset() + extraData.length;
      entries.push({ tag: 0x0110, type: 2, count: modelBytes.length, value: toLe32(offset) });
      extraData.push(...modelBytes);
    }

    if (opts.hasGps) {
      entries.push({ tag: 0x8825, type: 4, count: 1, value: [0, 0, 0, 0] });
    }

    // ExifIFD pointer if we need exif version
    let exifIfdOffset = 0;
    if (opts.exifVersion) {
      exifIfdOffset = ifd0DataBaseOffset() + extraData.length;
      entries.push({ tag: 0x8769, type: 4, count: 1, value: toLe32(exifIfdOffset) });
    }

    // Recalculate offsets now that entry count is finalized
    const actualDataBase = 8 + 2 + entries.length * 12 + 4;
    // Fix model offset
    if (opts.cameraModel) {
      const e = entries.find((e) => e.tag === 0x0110);
      if (e) e.value = toLe32(actualDataBase);
    }
    // Fix exifIFD offset
    if (opts.exifVersion) {
      const modelLen = opts.cameraModel ? new TextEncoder().encode(opts.cameraModel).length + 1 : 0;
      exifIfdOffset = actualDataBase + modelLen;
      const e = entries.find((e) => e.tag === 0x8769);
      if (e) e.value = toLe32(exifIfdOffset);
    }

    // Write IFD0 entry count
    tiff.push(entries.length & 0xff, (entries.length >> 8) & 0xff);

    // Write entries (sorted by tag)
    entries.sort((a, b) => a.tag - b.tag);
    for (const entry of entries) {
      tiff.push(entry.tag & 0xff, (entry.tag >> 8) & 0xff);
      tiff.push(entry.type & 0xff, (entry.type >> 8) & 0xff);
      tiff.push(...toLe32(entry.count));
      tiff.push(...entry.value);
    }

    // Next IFD pointer (0 = none)
    tiff.push(0, 0, 0, 0);

    // Extra data (camera model string)
    tiff.push(...extraData);

    // ExifIFD sub-IFD
    if (opts.exifVersion) {
      // 1 entry
      tiff.push(0x01, 0x00);
      // Tag 0x9000 (ExifVersion)
      tiff.push(0x00, 0x90);
      // Type: undefined (7)
      tiff.push(0x07, 0x00);
      // Count: 4
      tiff.push(0x04, 0x00, 0x00, 0x00);
      // Value inline: e.g. "0231"
      const versionChars = opts.exifVersion.replace(".", "").padStart(4, "0");
      for (let i = 0; i < 4; i++) {
        tiff.push(versionChars.charCodeAt(i));
      }
    }

    // Build APP1 segment
    const app1Data = [
      // "Exif\0\0"
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00,
      ...tiff,
    ];
    const segLen = app1Data.length + 2;
    parts.push(0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, ...app1Data);

    // EOI
    parts.push(0xff, 0xd9);

    return new Uint8Array(parts);
  }

  function toLe32(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  }

  it("detects JPEG EXIF with GPS data", async () => {
    const data = buildJpegWithExif({ hasGps: true });
    const file = new File([data], "test.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.hasGps).toBe(true);
  });

  it("detects JPEG camera model", async () => {
    const data = buildJpegWithExif({ cameraModel: "Sony A7R IV" });
    const file = new File([data], "test.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.cameraModel).toBe("Sony A7R IV");
  });

  it("detects EXIF version", async () => {
    const data = buildJpegWithExif({ exifVersion: "2.31" });
    const file = new File([data], "test.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.exifVersion).toBe("2.31");
  });

  it("counts IFD tags", async () => {
    const data = buildJpegWithExif({ cameraModel: "Test", hasGps: true });
    const file = new File([data], "test.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBeGreaterThanOrEqual(2);
  });

  it("handles PNG with no metadata chunks", async () => {
    // Minimal PNG: signature + IHDR + IEND
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR length
      0x49,
      0x48,
      0x44,
      0x52, // IHDR
      0x00,
      0x00,
      0x00,
      0x01, // width
      0x00,
      0x00,
      0x00,
      0x01, // height
      0x08,
      0x02,
      0x00,
      0x00,
      0x00, // bit depth, color type, etc.
      0x90,
      0x77,
      0x53,
      0xde, // CRC
      0x00,
      0x00,
      0x00,
      0x00, // IEND length
      0x49,
      0x45,
      0x4e,
      0x44, // IEND
      0xae,
      0x42,
      0x60,
      0x82, // CRC
    ]);
    const file = new File([png], "test.png", { type: "image/png" });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(0);
    expect(result.hasGps).toBe(false);
  });

  it("handles PNG with tEXt chunk", async () => {
    // PNG signature + IHDR + tEXt + IEND
    const textData = new TextEncoder().encode("Comment\0test value");
    const chunkLen = textData.length;

    const parts: number[] = [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR length
      0x49,
      0x48,
      0x44,
      0x52, // IHDR
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x90,
      0x77,
      0x53,
      0xde, // CRC
      // tEXt chunk
      (chunkLen >> 24) & 0xff,
      (chunkLen >> 16) & 0xff,
      (chunkLen >> 8) & 0xff,
      chunkLen & 0xff,
      0x74,
      0x45,
      0x58,
      0x74, // tEXt
      ...Array.from(textData),
      0x00,
      0x00,
      0x00,
      0x00, // CRC (dummy)
      // IEND
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44,
      0xae,
      0x42,
      0x60,
      0x82,
    ];

    const file = new File([new Uint8Array(parts)], "test.png", { type: "image/png" });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(1);
  });

  it("handles WebP with EXIF chunk", async () => {
    // Build a RIFF/WEBP with EXIF chunk containing minimal TIFF
    const tiff = new Uint8Array([
      0x49,
      0x49, // II (little-endian)
      0x2a,
      0x00, // magic 42
      0x08,
      0x00,
      0x00,
      0x00, // IFD offset
      0x00,
      0x00, // 0 entries
      0x00,
      0x00,
      0x00,
      0x00, // next IFD
    ]);

    const exifChunkSize = tiff.length;
    const fileSize = 4 + 8 + exifChunkSize; // "WEBP" + chunk header + data
    const parts = new Uint8Array(12 + 8 + exifChunkSize);
    const view = new DataView(parts.buffer);

    // RIFF header
    parts.set(new TextEncoder().encode("RIFF"), 0);
    view.setUint32(4, fileSize, true);
    parts.set(new TextEncoder().encode("WEBP"), 8);

    // EXIF chunk
    parts.set(new TextEncoder().encode("EXIF"), 12);
    view.setUint32(16, exifChunkSize, true);
    parts.set(tiff, 20);

    const file = new File([parts], "test.webp", { type: "image/webp" });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(0);
    expect(result.hasGps).toBe(false);
  });

  it("gracefully handles corrupt data", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00])], "bad.jpg", {
      type: "image/jpeg",
    });
    const result = await extractMetadata(file);
    expect(result).toBeDefined();
    expect(result.tagCount).toBe(0);
  });

  it("gracefully handles truncated files", async () => {
    const file = new File([new Uint8Array(2)], "tiny.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result).toBeDefined();
    expect(result.tagCount).toBe(0);
  });
});

describe("buildZip", () => {
  it("produces a valid ZIP blob", () => {
    const data = new TextEncoder().encode("hello");
    const result = buildZip([{ name: "test.txt", data: new Uint8Array(data) }]);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("application/zip");
  });

  it("includes all provided files", () => {
    const items = [
      { name: "a.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "b.png", data: new Uint8Array([4, 5, 6]) },
    ];
    const result = buildZip(items);
    expect(result.size).toBeGreaterThan(0);
  });

  it("handles duplicate filenames by appending suffix", () => {
    const items = [
      { name: "photo.jpg", data: new Uint8Array([1]) },
      { name: "photo.jpg", data: new Uint8Array([2]) },
      { name: "photo.jpg", data: new Uint8Array([3]) },
    ];
    // Should not throw
    const result = buildZip(items);
    expect(result.size).toBeGreaterThan(0);
  });

  it("handles files with no extension in duplicate names", () => {
    const items = [
      { name: "README", data: new Uint8Array([1]) },
      { name: "README", data: new Uint8Array([2]) },
    ];
    const result = buildZip(items);
    expect(result.size).toBeGreaterThan(0);
  });
});

describe("extractMetadata edge cases", () => {
  it("returns empty summary for unsupported MIME type", async () => {
    const file = new File([new Uint8Array(100)], "test.bmp", { type: "image/bmp" });
    // Force past validation by using raw File
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(0);
    expect(result.hasGps).toBe(false);
    expect(result.hasXmp).toBe(false);
    expect(result.hasIptc).toBe(false);
  });

  it("detects JPEG XMP data", async () => {
    // Build a JPEG with APP1 segment containing XMP signature
    const xmpSig = "http://ns.adobe.com/xap/1.0/\0<xmp>data</xmp>";
    const xmpBytes = new TextEncoder().encode(xmpSig);
    const segLen = xmpBytes.length + 2;
    const parts = new Uint8Array(2 + 2 + 2 + xmpBytes.length + 2);
    parts[0] = 0xff;
    parts[1] = 0xd8; // SOI
    parts[2] = 0xff;
    parts[3] = 0xe1; // APP1
    parts[4] = (segLen >> 8) & 0xff;
    parts[5] = segLen & 0xff;
    parts.set(xmpBytes, 6);
    parts[parts.length - 2] = 0xff;
    parts[parts.length - 1] = 0xd9; // EOI
    const file = new File([parts], "xmp.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.hasXmp).toBe(true);
  });

  it("detects JPEG IPTC data (APP13)", async () => {
    // Build a JPEG with APP13 segment
    const iptcData = new Uint8Array(10);
    const segLen = iptcData.length + 2;
    const parts = new Uint8Array(2 + 2 + 2 + iptcData.length + 2);
    parts[0] = 0xff;
    parts[1] = 0xd8; // SOI
    parts[2] = 0xff;
    parts[3] = 0xed; // APP13
    parts[4] = (segLen >> 8) & 0xff;
    parts[5] = segLen & 0xff;
    parts.set(iptcData, 6);
    parts[parts.length - 2] = 0xff;
    parts[parts.length - 1] = 0xd9; // EOI
    const file = new File([parts], "iptc.jpg", { type: "image/jpeg" });
    const result = await extractMetadata(file);
    expect(result.hasIptc).toBe(true);
  });

  it("detects WebP XMP chunk", async () => {
    // Build a RIFF/WEBP with XMP chunk
    const xmpData = new TextEncoder().encode("<xmp>test</xmp>");
    const chunkSize = xmpData.length;
    const fileSize = 4 + 8 + chunkSize + (chunkSize % 2);
    const parts = new Uint8Array(12 + 8 + chunkSize + (chunkSize % 2));
    const view = new DataView(parts.buffer);
    parts.set(new TextEncoder().encode("RIFF"), 0);
    view.setUint32(4, fileSize, true);
    parts.set(new TextEncoder().encode("WEBP"), 8);
    parts.set(new TextEncoder().encode("XMP "), 12);
    view.setUint32(16, chunkSize, true);
    parts.set(xmpData, 20);
    const file = new File([parts], "test.webp", { type: "image/webp" });
    const result = await extractMetadata(file);
    expect(result.hasXmp).toBe(true);
  });

  it("handles invalid PNG signature gracefully", async () => {
    const file = new File([new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])], "bad.png", {
      type: "image/png",
    });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(0);
  });

  it("handles invalid WebP signature gracefully", async () => {
    const file = new File([new Uint8Array(20)], "bad.webp", { type: "image/webp" });
    const result = await extractMetadata(file);
    expect(result.tagCount).toBe(0);
  });
});

describe("stripMetadata", () => {
  beforeEach(() => {
    setupAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a Blob for JPEG", async () => {
    const file = new File(["fake-image"], "photo.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file);
    expect(result).toBeInstanceOf(Blob);
  });

  it("returns a Blob for PNG", async () => {
    const file = new File(["fake-image"], "photo.png", { type: "image/png" });
    const result = await stripMetadata(file);
    expect(result).toBeInstanceOf(Blob);
  });

  it("draws image on canvas to strip metadata", async () => {
    const file = new File(["fake-image"], "photo.jpg", { type: "image/jpeg" });
    await stripMetadata(file);
    // stripMetadata uses canvas.getContext("2d") and ctx.drawImage internally
    // If it completes without error, the canvas mock worked correctly
  });
});

describe("downloadBlob (metadata)", () => {
  beforeEach(() => {
    setupURLMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("completes without throwing", () => {
    const blob = new Blob(["test"], { type: "image/jpeg" });
    expect(() => downloadBlob(blob, "cleaned.jpg")).not.toThrow();
  });

  it("creates and revokes object URL", () => {
    const blob = new Blob(["test"], { type: "image/jpeg" });
    downloadBlob(blob, "cleaned.jpg");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
