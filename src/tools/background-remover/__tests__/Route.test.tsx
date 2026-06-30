import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import BackgroundRemoverRoute from "../Route";
import type { RemoveResult } from "../remover-types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the client barrel: keep the pure helpers (formatBytes / buildCutoutFilename + the size
// constants + the type/const surface re-exported from remover-types) REAL via `...actual`, and stub
// everything that touches a Worker, the filesystem, or real header parsing. No Worker is ever
// constructed (ensureWorker is lazy and every dispatcher is stubbed), so no MemoryRouter / real WASM
// is needed. (Deliberate deviation from the task's literal "stub formatBytes/buildCutoutFilename"
// list — the DOM assertions need their real output, exactly like the image-compress template.)
vi.mock("../remover", async () => {
  const actual = await vi.importActual<typeof import("../remover")>("../remover");
  return {
    ...actual,
    validateImageFile: vi.fn(() => ({ valid: true })),
    sniffImageMeta: vi.fn(() => ({ format: "png", animated: false })),
    readImageDims: vi.fn(() => ({ width: 100, height: 100 })),
    // readFileBytes tags the buffer with the file name so the removeViaWorker mock can decide
    // per-item behaviour (the worker call itself carries no name, only the input bytes).
    readFileBytes: vi.fn(async (file: File) => new TextEncoder().encode(file.name)),
    removeViaWorker: vi.fn(),
    recompositeViaWorker: vi.fn(),
    prefetchModel: vi.fn(),
    terminateRemoveWorker: vi.fn(),
    downloadBlob: vi.fn(),
    createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
  };
});

import * as remover from "../remover";

const mock = vi.mocked(remover);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function result(over: Partial<RemoveResult> = {}): RemoveResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    ext: "png",
    outputSize: 3,
    width: 100,
    height: 100,
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
  localStorage.removeItem("utilbench:prefs:background-remover");
  setupAllMocks();
  // clearAllMocks resets call counts but not implementations — re-establish the happy path each test
  // so per-test overrides never leak across cases.
  mock.validateImageFile.mockReturnValue({ valid: true });
  mock.sniffImageMeta.mockReturnValue({ format: "png", animated: false });
  mock.readImageDims.mockReturnValue({ width: 100, height: 100 });
  mock.readFileBytes.mockImplementation(async (file: File) => new TextEncoder().encode(file.name));
  mock.prefetchModel.mockResolvedValue(undefined);
  mock.recompositeViaWorker.mockResolvedValue(result());
  mock.createBatchZip.mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
  mock.removeViaWorker.mockImplementation(async ({ input }) => {
    const name = new TextDecoder().decode(input);
    if (name.includes("bad")) throw new Error("Background removal failed.");
    return result();
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("BackgroundRemoverRoute", () => {
  it("renders the file input with the image accept list (no GIF) and multiple", () => {
    render(<BackgroundRemoverRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(input.getAttribute("accept")).not.toContain("gif");
    expect(input).toHaveAttribute("multiple");
  });

  it("adds a queue row per uploaded image, counts them, and drives the preview", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => {
      expect(screen.getByText("a.png")).toBeInTheDocument();
      expect(screen.getByText("b.png")).toBeInTheDocument();
      expect(screen.getByText("2 Files")).toBeInTheDocument();
    });
    // First upload auto-selects → the preview pane shows the "Original" figure for it.
    expect(screen.getByAltText("Original")).toBeInTheDocument();
  });

  it("shows the model-download progress affordance then 'ready' on success", async () => {
    const d = deferred<void>();
    let captured: ((p: { current: number; total: number }) => void) | undefined;
    mock.prefetchModel.mockImplementation((onProgress) => {
      captured = onProgress;
      return d.promise;
    });

    render(<BackgroundRemoverRoute />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    });

    // While the prefetch is in flight the download UI (progress bar copy) is shown.
    await waitFor(() => expect(screen.getByText("Downloading the AI model…")).toBeInTheDocument());
    expect(mock.prefetchModel).toHaveBeenCalledTimes(1);

    // Drive the byte-progress callback the stub received, then resolve.
    act(() => captured?.({ current: 50, total: 100 }));
    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(screen.getByText(/AI model ready/)).toBeInTheDocument());
  });

  it("shows a retry alert when the model fails to load", async () => {
    mock.prefetchModel.mockRejectedValue(new Error("offline"));
    render(<BackgroundRemoverRoute />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load the AI model/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  it("reveals the color picker in Color mode and offers only PNG/WebP formats", async () => {
    render(<BackgroundRemoverRoute />);
    // No color picker in the default (transparent) mode.
    expect(screen.queryByLabelText("Background color")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Color" }));
    });
    expect(screen.getByLabelText("Background color")).toBeInTheDocument();

    // Format toggle is PNG / WebP only — no JPEG control.
    expect(screen.getByRole("button", { name: "PNG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WebP" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JPEG" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JPG" })).not.toBeInTheDocument();
  });

  it("re-composites (not re-infers) when a pref changes on an already-processed item", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    // Process the selected item once so it has a stored result.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });
    await waitFor(() => expect(screen.getByText("cutout ready")).toBeInTheDocument());

    mock.removeViaWorker.mockClear();
    mock.recompositeViaWorker.mockClear();

    // Toggle output mode transparent → color (a pref change). This must re-COMPOSITE the warm slot,
    // never re-INFER. (recompositeViaWorker stays resolving so the catch→removeViaWorker fallback
    // never fires.)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Color" }));
    });

    await waitFor(() => expect(mock.recompositeViaWorker).toHaveBeenCalled(), { timeout: 2000 });
    expect(mock.removeViaWorker).not.toHaveBeenCalled();
  });

  it("dispatches infer with encodeIntent 'preview' for the interactive single run", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });

    await waitFor(() => expect(mock.removeViaWorker).toHaveBeenCalled());
    expect(mock.removeViaWorker).toHaveBeenCalledWith(
      expect.objectContaining({ encodeIntent: "preview" }),
    );
  });

  it("dispatches infer with encodeIntent 'download' for every batch item", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });

    await waitFor(() => expect(mock.removeViaWorker).toHaveBeenCalledTimes(2));
    for (const call of mock.removeViaWorker.mock.calls) {
      expect(call[0]).toMatchObject({ encodeIntent: "download" });
    }
  });

  it("runs the whole batch, then zips and downloads all cutouts with a completion toast", async () => {
    const { toast } = await import("sonner");
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });

    // Both rows reach "done" → the batch ZIP control appears (doneCount > 1).
    const zipBtn = await screen.findByRole("button", { name: "Download all cutouts as ZIP" });
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    expect(mock.createBatchZip).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ filename: "a-nobg.png" }),
        expect.objectContaining({ filename: "b-nobg.png" }),
      ]),
    );
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "cutouts.zip");
    expect(toast.success).toHaveBeenCalledWith("Removed the background from 2 images");
  });

  it("marks a failed item as error and still finishes the rest of the batch", async () => {
    const { toast } = await import("sonner");
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("good.png"), pngFile("bad.png"), pngFile("good2.png")]);
    await waitFor(() => expect(screen.getByText("good2.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Couldn't remove the background/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good2.png" })).toBeInTheDocument();
    });
    // "bad.png" never produced a result → no per-row download button for it.
    expect(screen.queryByRole("button", { name: "Download bad.png" })).not.toBeInTheDocument();
    // The success toast counts only the 2 produced cutouts — not the failed item.
    expect(toast.success).toHaveBeenCalledWith("Removed the background from 2 images · 1 failed");
  });

  it("reports an error (not a success toast) when every batch item fails", async () => {
    const { toast } = await import("sonner");
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("bad.png"), pngFile("bad2-bad.png")]);
    await waitFor(() => expect(screen.getByText("bad.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't remove the background from any image."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("warns when the upload exceeds the queue-size cap and keeps only the allowed files", async () => {
    render(<BackgroundRemoverRoute />);
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
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("huge.png")]);

    await waitFor(() => expect(screen.getByText(/This image is too large/)).toBeInTheDocument());
    expect(screen.queryByText("huge.png")).not.toBeInTheDocument();
  });

  it("rejects a file that would exceed the total queue footprint (MAX_TOTAL_SIZE)", async () => {
    const { MAX_TOTAL_SIZE } = await vi.importActual<typeof import("../remover")>("../remover");
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("big.png", MAX_TOTAL_SIZE + 1)]);

    await waitFor(() => expect(screen.getByText(/total queue limit/)).toBeInTheDocument());
    expect(screen.queryByText("big.png")).not.toBeInTheDocument();
  });

  it("re-derives a non-selected done item under the current controls when selected (no stale drift)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    // Process both, then change the output mode (recomposites only the selected item, a.png).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    await waitFor(() => expect(screen.getAllByText("cutout ready")).toHaveLength(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Color" }));
    });
    await waitFor(() => expect(mock.recompositeViaWorker).toHaveBeenCalled(), { timeout: 2000 });

    // Selecting b.png (still in the old mode) must re-derive it under the CURRENT controls, not show
    // its stale cutout — the core of cursor #2.
    mock.recompositeViaWorker.mockClear();
    mock.removeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByText("b.png"));
    });
    await waitFor(
      () =>
        expect(
          mock.recompositeViaWorker.mock.calls.length + mock.removeViaWorker.mock.calls.length,
        ).toBeGreaterThan(0),
      { timeout: 2000 },
    );
  });

  it("Download ZIP reuses the stored download bytes when nothing changed (no re-encode)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    const zipBtn = await screen.findByRole("button", { name: "Download all cutouts as ZIP" });

    mock.recompositeViaWorker.mockClear();
    mock.removeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    // Both items are already current + download-encoded → zero re-derivation.
    expect(mock.recompositeViaWorker).not.toHaveBeenCalled();
    expect(mock.removeViaWorker).not.toHaveBeenCalled();
  });

  it("Download ZIP re-derives items left stale by a pref change (consistent, optimized zip)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    const zipBtn = await screen.findByRole("button", { name: "Download all cutouts as ZIP" });

    // Change the controls AFTER the batch — now the stored bytes no longer match.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Color" }));
    });
    await waitFor(() => expect(mock.recompositeViaWorker).toHaveBeenCalled(), { timeout: 2000 });

    mock.recompositeViaWorker.mockClear();
    mock.removeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    // The zip path re-encodes the stale items for download under the new controls.
    expect(
      mock.recompositeViaWorker.mock.calls.length + mock.removeViaWorker.mock.calls.length,
    ).toBeGreaterThan(0);
    for (const call of mock.recompositeViaWorker.mock.calls) {
      expect(call[0]).toMatchObject({ encodeIntent: "download" });
    }
  });

  it("Remove all skips items already done under the current controls (no wasted re-infer)", async () => {
    const { toast } = await import("sonner");
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    await waitFor(() => expect(mock.removeViaWorker).toHaveBeenCalledTimes(2));

    // Re-clicking with nothing changed must NOT re-infer — it reports everything is up to date.
    mock.removeViaWorker.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("All cutouts are already up to date"),
    );
    expect(mock.removeViaWorker).not.toHaveBeenCalled();
  });

  it("preserves an already-done item's cutout when its re-run is cancelled (no demote to ready)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    // Process once → the item has a stored result.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });
    await waitFor(() => expect(screen.getByText("cutout ready")).toBeInTheDocument());

    // A mode change re-stales it; the next infer (the re-run) hangs so we can cancel mid-flight.
    const d = deferred<RemoveResult>();
    mock.removeViaWorker.mockImplementation(() => d.promise);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Color" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    await act(async () => {
      d.resolve(result());
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument(),
    );
    // The cancelled re-run keeps the item's prior cutout instead of wiping it back to "ready".
    expect(screen.getByText("cutout ready")).toBeInTheDocument();
  });

  it("discards a cancelled single-item Remove background and doesn't strand it on processing (r3 #2)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("solo.png")]);
    await waitFor(() => expect(screen.getByText("solo.png")).toBeInTheDocument());

    // First run, no prior cutout: hang the infer so we can cancel it mid-flight.
    const d = deferred<RemoveResult>();
    mock.removeViaWorker.mockImplementation(() => d.promise);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    // The in-flight infer now completes — but it was cancelled, so the result must NOT be applied.
    await act(async () => {
      d.resolve(result());
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument(),
    );
    // No cutout from the cancelled run, and the item is back to ready — not stranded on "processing".
    expect(screen.queryByText("cutout ready")).not.toBeInTheDocument();
    expect(screen.queryByText(/removing…/)).not.toBeInTheDocument();
  });

  it("aborts a single-item run when Cancel is clicked during model load, before inference (r4 #1)", async () => {
    // Hang the model download so the run sits in the load phase with Cancel on screen.
    const load = deferred<void>();
    mock.prefetchModel.mockImplementation(() => load.promise);
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("solo.png")]);
    await waitFor(() => expect(screen.getByText("solo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    // Cancel DURING the model-load phase (inference hasn't started — removeViaWorker not yet called).
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    // The model finishes downloading after the cancel; the run must NOT proceed to inference.
    await act(async () => {
      load.resolve();
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument(),
    );
    expect(mock.removeViaWorker).not.toHaveBeenCalled();
    expect(screen.queryByText("cutout ready")).not.toBeInTheDocument();
  });

  it("locks controls + shows a row spinner while a per-item Download prepares, and releases on error (opencode r1)", async () => {
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("solo.png")]);
    await waitFor(() => expect(screen.getByText("solo.png")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove background/ }));
    });
    await waitFor(() => expect(screen.getByText("cutout ready")).toBeInTheDocument());

    // Cold-slot per-item download: recomposite rejects, the re-infer hangs so we can inspect the lock.
    mock.recompositeViaWorker.mockRejectedValue(new Error("cold slot"));
    const d = deferred<RemoveResult>();
    mock.removeViaWorker.mockImplementation(() => d.promise);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download solo.png" }));
    });

    // Engaged: the row button flips to a preparing spinner and every worker-touching control is locked.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preparing download of solo.png" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Remove all/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Remove background/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Color" })).toBeDisabled();

    // The prepare fails — the lock MUST release in `finally`, not wedge the whole UI.
    await act(async () => {
      d.reject(new Error("encode failed"));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download solo.png" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Remove all/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Color" })).not.toBeDisabled();
  });

  it("locks worker-touching controls while a ZIP is preparing", async () => {
    const d = deferred<Blob>();
    mock.createBatchZip.mockImplementation(() => d.promise);
    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });
    const zipBtn = await screen.findByRole("button", { name: "Download all cutouts as ZIP" });
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    // While the (hung) zip prepares, no other action can race the singleton worker or change prefs.
    await waitFor(() => expect(screen.getByRole("button", { name: "Color" })).toBeDisabled());
    expect(screen.getByRole("button", { name: /Remove all/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Remove background/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PNG" })).toBeDisabled();

    await act(async () => {
      d.resolve(new Blob(["zip"], { type: "application/zip" }));
    });
  });

  it("cancels a batch and returns the remaining items to ready", async () => {
    const d = deferred<RemoveResult>();
    let calls = 0;
    mock.removeViaWorker.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? d.promise : Promise.resolve(result());
    });

    render(<BackgroundRemoverRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));
    });

    // Batch is in flight (first item hung) → Cancel is available.
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    // Resolve the hung first item; the loop breaks before the second item dispatches.
    await act(async () => {
      d.resolve(result());
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument(),
    );
    // Only the first item was ever dispatched; the rest returned to "ready" (never inferred).
    expect(mock.removeViaWorker).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/removing/)).not.toBeInTheDocument();
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
