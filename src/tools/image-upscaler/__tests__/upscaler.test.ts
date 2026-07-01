import { createBatchZip as encodeCreateBatchZip } from "@/lib/encode";
import { describe, expect, it } from "vitest";
import { createBatchZip as resizerCreateBatchZip } from "../../image-resizer/resizer";
// Importing the barrel is safe in jsdom: the Worker is only constructed lazily inside `ensureWorker`,
// never at module load, so no `new Worker` runs here.
import { buildUpscaledFilename, createBatchZip, formatBytes } from "../upscaler";

describe("createBatchZip source (batch download collision fix)", () => {
  // The upscaler forces the output extension to the chosen format, so two sources like `a.jpg` and
  // `a.png` both map to `a-2x.png` — a filename COLLISION. It MUST re-export the deduping helper from
  // @/lib/encode (which suffixes " (N)"), NOT image-resizer/resizer.ts's object-keyed copy that
  // silently drops same-named entries. Locks the regression found via browser testing.
  it("re-exports the deduping @/lib/encode helper, not the lossy resizer copy", () => {
    expect(createBatchZip).toBe(encodeCreateBatchZip);
    expect(createBatchZip).not.toBe(resizerCreateBatchZip);
  });
});

describe("buildUpscaledFilename", () => {
  it("strips the extension and appends the scale + ext (2x)", () => {
    expect(buildUpscaledFilename("photo.png", 2, "png")).toBe("photo-2x.png");
  });

  it("appends the 4x scale", () => {
    expect(buildUpscaledFilename("photo.jpg", 4, "webp")).toBe("photo-4x.webp");
  });

  it("uses the jpeg→jpg ext verbatim", () => {
    expect(buildUpscaledFilename("shot.jpeg", 2, "jpg")).toBe("shot-2x.jpg");
  });

  it("sanitizes unsafe characters to single dashes", () => {
    expect(buildUpscaledFilename("my photo (final)!.png", 4, "png")).toBe("my-photo-final-4x.png");
  });

  it("collapses runs of dashes and trims leading/trailing dashes", () => {
    expect(buildUpscaledFilename("--a  b--.png", 2, "png")).toBe("a-b-2x.png");
  });

  it("keeps existing hyphens and underscores", () => {
    expect(buildUpscaledFilename("cool_image-01.webp", 2, "webp")).toBe("cool_image-01-2x.webp");
  });

  it("falls back to 'image' when the base sanitizes to empty", () => {
    expect(buildUpscaledFilename("!!!.png", 4, "png")).toBe("image-4x.png");
  });

  it("falls back to 'image' for an empty name", () => {
    expect(buildUpscaledFilename("", 2, "png")).toBe("image-2x.png");
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1 KB with a B suffix", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats the KB boundary and range", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats the MB boundary and range", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(Math.round(2.5 * 1024 * 1024))).toBe("2.5 MB");
  });
});
