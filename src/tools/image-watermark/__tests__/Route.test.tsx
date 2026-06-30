import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import ImageWatermarkRoute from "../Route";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the client barrel: stub everything that decodes/encodes/draws or touches a Worker,
// but keep the pure geometry helpers (computeCenters/anchorCenter/resolvePx/fitFontPx/…) real
// so the tile pre-flight + placement wiring exercise the actual math (mirrors converter's mock).
vi.mock("../watermarker", async () => {
  const actual = await vi.importActual<typeof import("../watermarker")>("../watermarker");
  return {
    ...actual,
    validateImageFile: vi.fn(() => ({ valid: true })),
    sniffImageMeta: vi.fn(() => ({ format: "png" })),
    readImageDims: vi.fn(() => ({ width: 100, height: 100 })),
    loadOrientedImage: vi.fn(async (file: File) => ({
      bitmap: { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap,
      naturalWidth: 100,
      naturalHeight: 100,
      format: "png" as const,
      fileName: file.name,
      fileSize: file.size,
    })),
    loadLogo: vi.fn(async (file: File) => ({
      bitmap: { width: 50, height: 50, close: vi.fn() } as unknown as ImageBitmap,
      width: 50,
      height: 50,
      fileName: file.name,
    })),
    watermarkToBlob: vi.fn(async (base: { fileName: string }) => {
      if (base.fileName.includes("bad")) throw new Error("Couldn't export the watermarked image.");
      return {
        blob: new Blob(["out"], { type: "image/png" }),
        mime: "image/png",
        ext: "png",
        width: 100,
        height: 100,
      };
    }),
    renderWatermark: vi.fn(),
    downloadBlob: vi.fn(),
    createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
    canEncode: vi.fn(() => true),
    buildWatermarkedFilename: vi.fn(
      (name: string, ext: string) => `${name.replace(/\.[^.]+$/, "")}-watermarked.${ext}`,
    ),
    formatBytes: vi.fn((n: number) => `${n} B`),
  };
});

import * as watermarker from "../watermarker";

const mock = vi.mocked(watermarker);

function pngFile(name: string): File {
  return new File(["png-bytes-here"], name, { type: "image/png" });
}

async function uploadFiles(files: File[], testId = "file-input") {
  const input = screen.getByTestId(testId);
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:image-watermark");
  setupAllMocks();
  // clearAllMocks resets call counts but not implementations — re-establish the happy path.
  mock.validateImageFile.mockReturnValue({ valid: true });
  mock.sniffImageMeta.mockReturnValue({ format: "png" });
  mock.readImageDims.mockReturnValue({ width: 100, height: 100 });
  mock.canEncode.mockReturnValue(true);
  mock.loadOrientedImage.mockImplementation(async (file: File) => ({
    bitmap: { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap,
    naturalWidth: 100,
    naturalHeight: 100,
    format: "png" as const,
    fileName: file.name,
    fileSize: file.size,
  }));
  mock.watermarkToBlob.mockImplementation(async (base: { fileName: string }) => {
    if (base.fileName.includes("bad")) throw new Error("Couldn't export the watermarked image.");
    return {
      blob: new Blob(["out"], { type: "image/png" }),
      mime: "image/png",
      ext: "png",
      width: 100,
      height: 100,
    };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageWatermarkRoute", () => {
  it("renders the file input with the raster accept list and multiple (no gif/svg/avif)", () => {
    render(<ImageWatermarkRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("multiple");
    const accept = input.getAttribute("accept") ?? "";
    expect(accept).not.toContain("gif");
    expect(accept).not.toContain("svg");
    expect(accept).not.toContain("avif");
  });

  it("uploads an image, previews it on the canvas, and invokes renderWatermark", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());
    expect(screen.getByTestId("preview-canvas")).toBeInTheDocument();
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());
  });

  it("re-invokes renderWatermark when the text changes (rAF/debounced smoke)", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());
    mock.renderWatermark.mockClear();
    await act(async () => {
      fireEvent.change(screen.getByTestId("text-input"), { target: { value: "Hello" } });
    });
    // Let the ~120ms text debounce + rAF redraw fire, then assert the re-composite happened.
    // The redraw calls renderWatermark + canvas ops only (no React state), so no act() wrap.
    await new Promise((r) => setTimeout(r, 300));
    expect(mock.renderWatermark).toHaveBeenCalled();
  });

  it("toggles the outline controls on and off", async () => {
    render(<ImageWatermarkRoute />);
    // DEFAULT_PREFS.outline is true → the outline width control starts visible.
    expect(screen.getByRole("slider", { name: "Outline — % of text size" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("outline-toggle"));
    await waitFor(() =>
      expect(
        screen.queryByRole("slider", { name: "Outline — % of text size" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("outline-toggle"));
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Outline — % of text size" })).toBeInTheDocument(),
    );
  });

  it("loads a logo via loadLogo and reveals the scale slider in logo mode", async () => {
    render(<ImageWatermarkRoute />);
    fireEvent.click(screen.getByTestId("kind-image"));
    await uploadFiles([pngFile("logo.png")], "logo-input");
    await waitFor(() => expect(mock.loadLogo).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("slider", { name: "Scale — % of image width" })).toBeInTheDocument();
  });

  it("selects an anchor on grid click", () => {
    render(<ImageWatermarkRoute />);
    // Default anchor is bottom-right.
    expect(screen.getByTestId("anchor-bottom-right")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("anchor-top-left"));
    expect(screen.getByTestId("anchor-top-left")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("anchor-bottom-right")).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals the tile-gap slider and disables the anchor grid when tiling", async () => {
    render(<ImageWatermarkRoute />);
    expect(screen.queryByRole("slider", { name: "Tile gap" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("layout-tile"));
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Tile gap" })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("anchor-center")).toBeDisabled();
  });

  it("updates the rotation config via the snap buttons", () => {
    render(<ImageWatermarkRoute />);
    fireEvent.click(screen.getByTestId("rotate-snap-90"));
    // The readout span + the active snap button both now read "90°".
    expect(screen.getAllByText("90°").length).toBeGreaterThanOrEqual(2);
  });

  it("updates the opacity slider value", () => {
    render(<ImageWatermarkRoute />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "51");
  });

  it("shows quality + background for JPEG and hides quality for PNG", async () => {
    render(<ImageWatermarkRoute />);
    fireEvent.click(screen.getByTestId("format-jpeg"));
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Quality" })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("jpeg-bg-input")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("format-png"));
    await waitFor(() =>
      expect(screen.queryByRole("slider", { name: "Quality" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("jpeg-bg-input")).not.toBeInTheDocument();
  });

  it("flattens the preview onto jpegBackground for JPEG (WYSIWYG) and not for PNG", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());

    // JPEG selected → drawPreview must pass jpegBackground as the flatten arg so a transparent
    // base previews exactly as it exports (the §6.3 WYSIWYG invariant).
    mock.renderWatermark.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("format-jpeg"));
    });
    await new Promise((r) => setTimeout(r, 60));
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());
    expect(mock.renderWatermark.mock.calls.at(-1)?.[6]).toBe("#ffffff");

    // PNG selected → no flatten (transparency preserved).
    mock.renderWatermark.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("format-png"));
    });
    await new Promise((r) => setTimeout(r, 60));
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());
    expect(mock.renderWatermark.mock.calls.at(-1)?.[6]).toBeUndefined();
  });

  it("drops the stale preview when the newly-selected item fails to decode", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("good.png")]);
    await waitFor(() => expect(mock.renderWatermark).toHaveBeenCalled());

    // A second item that passes enqueue but throws during full-res decode.
    mock.loadOrientedImage.mockRejectedValueOnce(
      new Error("Couldn't read this image — it may be corrupt."),
    );
    await uploadFiles([pngFile("broken.png")]);
    await waitFor(() => expect(screen.getByText("broken.png")).toBeInTheDocument());

    mock.renderWatermark.mockClear();
    fireEvent.click(screen.getByText("broken.png"));
    // Decode rejects → error surfaced AND the previous item's preview is dropped, so the canvas
    // never re-composites the stale base (no renderWatermark after the clear).
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read this image"),
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(mock.renderWatermark).not.toHaveBeenCalled();
  });

  it("locks queue select + logo controls during export (mid-export bitmap-close races)", async () => {
    // Hold watermarkToBlob open so isExporting stays true while we assert.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.watermarkToBlob.mockImplementationOnce(async () => {
      await gate;
      return {
        blob: new Blob(["out"], { type: "image/png" }),
        mime: "image/png",
        ext: "png",
        width: 100,
        height: 100,
      };
    });
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());
    // Logo mode + a logo so the logo controls render.
    fireEvent.click(screen.getByTestId("kind-image"));
    await uploadFiles([pngFile("logo.png")], "logo-input");
    await waitFor(() => expect(screen.getByTestId("logo-remove")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("apply-button"));
    // While the export is in flight, the queue select button AND the logo controls must be
    // disabled — otherwise a mid-export click closes a bitmap the export loop is still drawing.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^photo\.png/ })).toBeDisabled();
    });
    expect(screen.getByTestId("logo-remove")).toBeDisabled();

    release();
    await waitFor(() => expect(mock.downloadBlob).toHaveBeenCalled());
  });

  it("hides the WebP format when the encoder is unsupported", async () => {
    mock.canEncode.mockReturnValue(false);
    render(<ImageWatermarkRoute />);
    await waitFor(() => expect(screen.queryByTestId("format-webp")).not.toBeInTheDocument());
    expect(screen.getByTestId("format-png")).toBeInTheDocument();
  });

  it("watermarks and downloads a single image under its -watermarked name", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-button"));
    });

    await waitFor(() => expect(mock.watermarkToBlob).toHaveBeenCalledTimes(1));
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "photo-watermarked.png");
  });

  it("batch-watermarks two images, shows the progressbar, and zips them", async () => {
    vi.useFakeTimers();
    try {
      render(<ImageWatermarkRoute />);
      await act(async () => {
        fireEvent.change(screen.getByTestId("file-input"), {
          target: { files: [pngFile("a.png"), pngFile("b.png")] },
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const apply = screen.getByText("Download all (2)");
      await act(async () => {
        fireEvent.click(apply);
      });
      // setIsExporting/setProgress fire synchronously before the first await → bar is mounted.
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText(/\d \/ 2/)).toBeInTheDocument();
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(mock.watermarkToBlob).toHaveBeenCalledTimes(2);
      expect(mock.createBatchZip).toHaveBeenCalledTimes(1);
      expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "watermarked-images.zip");
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps a 51-file drop at 50 and warns the queue is full", async () => {
    const files = Array.from({ length: 51 }, (_, i) => pngFile(`img-${i}.png`));
    render(<ImageWatermarkRoute />);
    await uploadFiles(files);
    await waitFor(() => expect(screen.getByText("50 Files")).toBeInTheDocument());
    expect(screen.getByText(/Queue is full \(max 50 files\)/)).toBeInTheDocument();
  });

  it("skips a failed export item, zips the survivor, and reports 'Watermarked 1 of 2'", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("good.png"), pngFile("bad.png")]);
    await waitFor(() => expect(screen.getByText("bad.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText("Download all (2)"));
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    expect(mock.createBatchZip).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "good-watermarked.png" }),
    ]);
    await waitFor(() => expect(screen.getByText(/Watermarked 1 of 2/)).toBeInTheDocument());
  });

  it("keeps a preview-time CapError item in the queue with an error and surfaces the alert", async () => {
    mock.loadOrientedImage.mockRejectedValueOnce(
      new watermarker.CapError("Image too large to watermark in your browser (over ~16 MP)."),
    );
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("huge.png")]);
    // The file STAYS in the queue (mirrors compress §6.7) with a disabled/error thumb.
    await waitFor(() => expect(screen.getByText("huge.png")).toBeInTheDocument());
    expect(screen.getByText("1 Files")).toBeInTheDocument();
    expect(screen.getAllByText(/too large to watermark/i).length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a generic decode error from a preview-time failure", async () => {
    mock.loadOrientedImage.mockRejectedValueOnce(
      new Error("Couldn't read this image — it may be corrupt."),
    );
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("broken.png")]);
    await waitFor(() =>
      expect(screen.getAllByText(/may be corrupt/i).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("rejects an invalid file type with an alert and queues nothing", async () => {
    mock.validateImageFile.mockReturnValue({
      valid: false,
      error: "Invalid file type. Use PNG, JPG, WebP.",
    });
    render(<ImageWatermarkRoute />);
    await uploadFiles([new File(["x"], "notes.txt", { type: "text/plain" })]);
    await waitFor(() => expect(screen.getByText(/Invalid file type/)).toBeInTheDocument());
    expect(screen.getByText("0 Files")).toBeInTheDocument();
  });

  it("hard-rejects an animated image at enqueue and queues nothing (§6.2 step 4)", async () => {
    mock.sniffImageMeta.mockReturnValueOnce({ format: "webp", animated: true });
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("loop.webp")]);
    await waitFor(() =>
      expect(screen.getByText(/Animated images aren't supported/)).toBeInTheDocument(),
    );
    expect(screen.getByText("0 Files")).toBeInTheDocument();
  });

  it("applies on Cmd+Enter when the action is enabled", async () => {
    render(<ImageWatermarkRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(mock.watermarkToBlob).toHaveBeenCalled());
    expect(mock.downloadBlob).toHaveBeenCalled();
  });
});
