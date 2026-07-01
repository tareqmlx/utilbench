import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import ImageUpscalerRoute from "../Route";
import type { ScaleFactor, UpscaleOptions, UpscaleResult } from "../upscaler-types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the client barrel wholesale (plan §11). The barrel is the ONLY module Route imports from, so
// stubbing it means no Worker, no WASM, no real header parsing, and no Router — hence no MemoryRouter.
// Constants (MAX_*, DEFAULT_PREFS) are provided as real values; every worker/fs/parse touchpoint is a
// vi.fn re-established in beforeEach. `buildUpscaledFilename` / `formatBytes` get real-enough output so
// the DOM assertions (filenames, dims) read like production.
vi.mock("../upscaler", () => ({
  DEFAULT_PREFS: { scale: 2, format: "png", quality: 90, backgroundColor: "#ffffff" },
  MAX_QUEUE_SIZE: 50,
  MAX_TOTAL_SIZE: 250 * 1024 * 1024,
  validateImageFile: vi.fn(() => ({ valid: true })),
  sniffImageMeta: vi.fn(() => ({ format: "png", animated: false })),
  normalizeFormat: vi.fn((f: string) => f),
  readImageDims: vi.fn(() => ({ width: 100, height: 100 })),
  clampToCanvasLimits: vi.fn((width: number, height: number) => ({
    width,
    height,
    downscaled: false,
  })),
  computeMaxScale: vi.fn(() => 4),
  readFileBytes: vi.fn(async (file: File) => new TextEncoder().encode(file.name)),
  upscaleViaWorker: vi.fn(),
  reencodeViaWorker: vi.fn(),
  prefetchModel: vi.fn(),
  terminateUpscaleWorker: vi.fn(),
  WORKER_STOPPED_MESSAGE: "Image upscaler worker stopped.",
  downloadBlob: vi.fn(),
  createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
  buildUpscaledFilename: vi.fn(
    (name: string, scale: number, ext: string) =>
      `${name.replace(/\.[^.]+$/, "")}-${scale}x.${ext}`,
  ),
  formatBytes: vi.fn((n: number) => `${n} B`),
}));

import * as upscaler from "../upscaler";

const mock = vi.mocked(upscaler);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function result(scale: ScaleFactor, over: Partial<UpscaleResult> = {}): UpscaleResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    ext: "png",
    outputSize: 3,
    scale,
    width: 100 * scale,
    height: 100 * scale,
    ...over,
  };
}

function pngFile(name: string, size?: number): File {
  const file = new File(["png-bytes-here"], name, { type: "image/png" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

async function uploadFiles(files: File[]) {
  const input = screen.getByTestId("file-input");
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:image-upscaler");
  setupAllMocks();
  mock.validateImageFile.mockReturnValue({ valid: true });
  mock.sniffImageMeta.mockReturnValue({ format: "png", animated: false });
  mock.readImageDims.mockReturnValue({ width: 100, height: 100 });
  mock.clampToCanvasLimits.mockImplementation((width: number, height: number) => ({
    width,
    height,
    downscaled: false,
  }));
  mock.computeMaxScale.mockReturnValue(4);
  mock.readFileBytes.mockImplementation(async (file: File) => new TextEncoder().encode(file.name));
  mock.prefetchModel.mockResolvedValue(undefined);
  mock.reencodeViaWorker.mockResolvedValue(result(2, { mime: "image/webp", ext: "webp" }));
  mock.createBatchZip.mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
  mock.buildUpscaledFilename.mockImplementation(
    (name: string, scale: number, ext: string) =>
      `${name.replace(/\.[^.]+$/, "")}-${scale}x.${ext}`,
  );
  mock.formatBytes.mockImplementation((n: number) => `${n} B`);
  // Default upscale: honours the requested scale; "bad" names throw so batch-error paths can fire.
  mock.upscaleViaWorker.mockImplementation(async (args) => {
    const name = new TextDecoder().decode(args.input);
    if (name.includes("bad")) throw new Error("upscale failed");
    return result((args.options as UpscaleOptions).scale);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageUpscalerRoute", () => {
  it("renders the file input with the image accept list (no GIF) and multiple", () => {
    render(<ImageUpscalerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(input.getAttribute("accept")).not.toContain("gif");
    expect(input).toHaveAttribute("multiple");
  });

  it("adds a queue row per uploaded image with its dimensions and drives the preview", async () => {
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => {
      expect(screen.getByText("a.png")).toBeInTheDocument();
      expect(screen.getByText("100×100")).toBeInTheDocument();
      expect(screen.getByText("1 File")).toBeInTheDocument();
    });
    // First upload auto-selects → the preview pane shows the "Original" figure for it.
    expect(screen.getByAltText("Original")).toBeInTheDocument();
  });

  it("disables the 4× control when the selected image's output can't fit 4× (computeMaxScale < 4)", async () => {
    mock.computeMaxScale.mockReturnValue(2);
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("medium.png")]);
    await waitFor(() => expect(screen.getByText("medium.png")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "4×" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2×" })).not.toBeDisabled();
  });

  it("disables the run and points at image-resizer when the image is too large even at 2× (=== 0)", async () => {
    mock.computeMaxScale.mockReturnValue(0);
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("huge.png")]);
    await waitFor(() => expect(screen.getByText("huge.png")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Upscale" })).toBeDisabled();
    expect(screen.getByText(/too large to upscale/i)).toBeInTheDocument();
  });

  it("shows the model-loading indicator then 'ready' on a successful Load model", async () => {
    const d = deferred<void>();
    mock.prefetchModel.mockReturnValue(d.promise);

    render(<ImageUpscalerRoute />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    });

    await waitFor(() => expect(screen.getByText("Loading the AI model…")).toBeInTheDocument());
    expect(mock.prefetchModel).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(screen.getByText(/AI model ready/)).toBeInTheDocument());
  });

  it("shows a retry alert when the model fails to load (offline)", async () => {
    mock.prefetchModel.mockRejectedValue(new Error("offline"));
    render(<ImageUpscalerRoute />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load the AI model/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  it("drives a determinate upscaling bar from onProgress, then applies the result", async () => {
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    const d = deferred<UpscaleResult>();
    let onProgress: ((p: { stage: string; current: number; total: number }) => void) | undefined;
    mock.upscaleViaWorker.mockImplementation((args) => {
      onProgress = args.onProgress;
      return d.promise;
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });
    await waitFor(() => expect(mock.upscaleViaWorker).toHaveBeenCalled());

    act(() => onProgress?.({ stage: "upscaling", current: 0.5, total: 1 }));
    await waitFor(() => expect(screen.getByText(/50%/)).toBeInTheDocument());

    await act(async () => {
      d.resolve(result(2));
    });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Upscaled the image"));
  });

  it("re-encodes (not re-infers) on a format change, but re-infers on a scale change (regression lock)", async () => {
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    // Explicit first upscale so the item has a cached result to re-derive from.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download a.png" })).toBeInTheDocument(),
    );

    // Format change (PNG → WebP) must re-ENCODE the warm slot, never re-INFER.
    mock.upscaleViaWorker.mockClear();
    mock.reencodeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "WebP" }));
    });
    await waitFor(() => expect(mock.reencodeViaWorker).toHaveBeenCalled(), { timeout: 2000 });
    expect(mock.upscaleViaWorker).not.toHaveBeenCalled();

    // Scale change (2× → 4×) is a different model output → it must re-INFER, not re-encode.
    mock.upscaleViaWorker.mockClear();
    mock.reencodeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "4×" }));
    });
    await waitFor(() => expect(mock.upscaleViaWorker).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("runs the whole batch, then zips + downloads all outputs with a completion toast", async () => {
    const { toast } = await import("sonner");
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upscale all/ }));
    });

    const zipBtn = await screen.findByRole("button", {
      name: "Download all upscaled images as ZIP",
    });
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    expect(mock.createBatchZip).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ filename: "a-2x.png" }),
        expect.objectContaining({ filename: "b-2x.png" }),
      ]),
    );
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "upscaled-images.zip");
    expect(toast.success).toHaveBeenCalledWith("Upscaled 2 images");
  });

  it("marks a failed item as error and still finishes the rest of the batch", async () => {
    const { toast } = await import("sonner");
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("good.png"), pngFile("bad.png"), pngFile("good2.png")]);
    await waitFor(() => expect(screen.getByText("good2.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upscale all/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Couldn't upscale/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good2.png" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Download bad.png" })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Upscaled 2 images · 1 failed");
  });

  it("warns when the upload exceeds the queue-size cap and keeps only the allowed files", async () => {
    render(<ImageUpscalerRoute />);
    const files = Array.from({ length: 51 }, (_, i) => pngFile(`f${i}.png`));
    await uploadFiles(files);

    await waitFor(() => {
      expect(screen.getByText(/Queue is full \(max 50 files\)/)).toBeInTheDocument();
      expect(screen.getByText("50 Files")).toBeInTheDocument();
    });
  });

  it("surfaces the validation rejection when a file is too large (MAX_IMAGE_SIZE)", async () => {
    mock.validateImageFile.mockReturnValue({
      valid: false,
      error: "This image is too large (over 50 MB).",
    });
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("huge.png")]);

    await waitFor(() => expect(screen.getByText(/This image is too large/)).toBeInTheDocument());
    expect(screen.queryByText("huge.png")).not.toBeInTheDocument();
  });

  it("rejects a file that would exceed the total queue footprint (MAX_TOTAL_SIZE)", async () => {
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("big.png", 250 * 1024 * 1024 + 1)]);

    await waitFor(() => expect(screen.getByText(/total queue limit/)).toBeInTheDocument());
    expect(screen.queryByText("big.png")).not.toBeInTheDocument();
  });

  it("rejects an input whose own dimensions already bust the canvas ceiling (→ image-resizer)", async () => {
    mock.clampToCanvasLimits.mockReturnValue({ width: 20000, height: 20000, downscaled: true });
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("massive.png")]);

    await waitFor(() =>
      expect(screen.getByText(/shrink it in image-resizer before upscaling/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("massive.png")).not.toBeInTheDocument();
  });

  it("soft-cancels a batch (Skip remaining): stops dispatching without terminating the worker", async () => {
    const d = deferred<UpscaleResult>();
    let calls = 0;
    mock.upscaleViaWorker.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? d.promise : Promise.resolve(result(2));
    });

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upscale all/ }));
    });

    const cancelBtn = await screen.findByRole("button", { name: "Skip remaining" });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    await act(async () => {
      d.resolve(result(2));
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Skip remaining" })).not.toBeInTheDocument(),
    );
    // Only the first item was ever dispatched; the worker was NOT torn down (soft cancel).
    expect(mock.upscaleViaWorker).toHaveBeenCalledTimes(1);
    expect(mock.terminateUpscaleWorker).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("hard-stops a batch (Stop now): terminates + respawns the worker", async () => {
    const d = deferred<UpscaleResult>();
    mock.upscaleViaWorker.mockImplementation(() => d.promise);

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upscale all/ }));
    });

    const stopBtn = await screen.findByRole("button", { name: "Stop now" });
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(mock.terminateUpscaleWorker).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop now" })).not.toBeInTheDocument(),
    );
  });

  it("surfaces a specific worker error (timeout) instead of the generic corrupt/unsupported message", async () => {
    mock.upscaleViaWorker.mockRejectedValue(new Error("Upscaling timed out."));

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });

    await waitFor(() => expect(screen.getByText(/Upscaling timed out\./)).toBeInTheDocument());
    expect(screen.queryByText(/may be corrupt or unsupported/)).not.toBeInTheDocument();
  });

  it("keeps the generic message for an opaque (non-friendly) worker error", async () => {
    mock.upscaleViaWorker.mockRejectedValue(new Error("TypeError: something internal"));

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });

    await waitFor(() =>
      expect(screen.getByText(/may be corrupt or unsupported/)).toBeInTheDocument(),
    );
  });

  it("shows a per-item cap badge in the queue row (too large / max 2×)", async () => {
    mock.computeMaxScale.mockReturnValue(0);
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("huge.png")]);
    await waitFor(() => expect(screen.getByText("huge.png")).toBeInTheDocument());
    // The compact queue-row badge (distinct from the Output-panel "too large" run message).
    expect(screen.getByText(/· too large/)).toBeInTheDocument();

    cleanup();
    mock.computeMaxScale.mockReturnValue(2);
    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("mid.png")]);
    await waitFor(() => expect(screen.getByText("mid.png")).toBeInTheDocument());
    expect(screen.getByText(/max 2×/)).toBeInTheDocument();
  });

  it("does NOT mark an item errored when a Stop-now-aborted run rejects afterwards", async () => {
    const d = deferred<UpscaleResult>();
    mock.upscaleViaWorker.mockReturnValue(d.promise);

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });
    // Hard-stop mid-run: resets the item + terminates the worker (which rejects the in-flight promise).
    const stopBtn = await screen.findByRole("button", { name: "Stop now" });
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    await act(async () => {
      d.reject(new Error("Image upscaler worker stopped."));
    });

    // The aborted item must NOT flip to a false error — the rejection is discarded (superseded reqId).
    expect(screen.queryByText(/may be corrupt or unsupported/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Image upscaler worker stopped/)).not.toBeInTheDocument();
    expect(mock.terminateUpscaleWorker).toHaveBeenCalled();
  });

  it("a superseded run unwinding after Stop now does NOT clear the NEW run's busy UI", async () => {
    // Reproduces the run-generation clobber: R1 is parked on a worker promise; Stop now aborts it and
    // the user immediately starts R2; only THEN does R1 settle. R1's finally must not tear down R2.
    const d1 = deferred<UpscaleResult>();
    const d2 = deferred<UpscaleResult>();
    mock.upscaleViaWorker.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    render(<ImageUpscalerRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    // R1 starts, then Stop now.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Stop now" }));
    });

    // R2 starts before R1's promise has settled.
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Upscale" }));
    });
    expect(await screen.findByRole("button", { name: "Stop now" })).toBeInTheDocument();
    // R2's queue row is processing ("· upscaling…" sits in the meta span next to the dims).
    const meta = screen.getByText("a.png").parentElement;
    expect(meta?.textContent).toMatch(/upscaling…/);

    // R1 finally lands late — with the run-generation guard it must be a no-op for R2.
    await act(async () => {
      d1.reject(new Error("Image upscaler worker stopped."));
    });

    // R2 still owns the run: its busy UI survives (button would revert to "Upscale" if R1 clobbered it).
    expect(screen.getByRole("button", { name: "Stop now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upscale" })).not.toBeInTheDocument();
    // …and R1's superseded revert must NOT have knocked R2's row out of "processing".
    expect(screen.getByText("a.png").parentElement?.textContent).toMatch(/upscaling…/);
  });
});
