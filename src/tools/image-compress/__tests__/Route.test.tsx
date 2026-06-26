import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import ImageCompressRoute from "../Route";
import type { CompressResult } from "../compressor-types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the client barrel: keep the pure helpers (formatBytes/formatRatio/
// buildCompressedFilename + size constants) real, stub everything that touches
// a Worker, the filesystem, or real codec/header parsing. No Worker is ever
// constructed, so no MemoryRouter / real WASM is needed.
vi.mock("../compressor", async () => {
  const actual = await vi.importActual<typeof import("../compressor")>("../compressor");
  return {
    ...actual,
    validateImageFile: vi.fn(() => ({ valid: true })),
    sniffImageMeta: vi.fn(() => ({ format: "png" })),
    readImageDims: vi.fn(() => ({ width: 100, height: 100 })),
    // readFileBytes tags the buffer with the file name so the compressViaWorker
    // mock can decide per-item behaviour (the worker call itself carries no name).
    readFileBytes: vi.fn(async (file: File) => new TextEncoder().encode(file.name)),
    compressViaWorker: vi.fn(),
    createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
    downloadBlob: vi.fn(),
    terminateCompressWorker: vi.fn(),
  };
});

import * as compressor from "../compressor";

const mock = vi.mocked(compressor);

function result(over: Partial<CompressResult> = {}): CompressResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    ext: "png",
    outputSize: 50,
    inputSize: 100,
    ratio: 0.5,
    keptOriginal: false,
    width: 100,
    height: 100,
    outputFormat: "png",
    ...over,
  };
}

function pngFile(name: string): File {
  return new File(["png-bytes-here"], name, { type: "image/png" });
}

async function uploadFiles(files: File[]) {
  const input = screen.getByTestId("file-input");
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:image-compress");
  setupAllMocks();
  // clearAllMocks resets call counts but not implementations — re-establish the
  // happy path each test so overrides never leak across cases.
  mock.validateImageFile.mockReturnValue({ valid: true });
  mock.sniffImageMeta.mockReturnValue({ format: "png" });
  mock.readImageDims.mockReturnValue({ width: 100, height: 100 });
  mock.readFileBytes.mockImplementation(async (file: File) => new TextEncoder().encode(file.name));
  mock.compressViaWorker.mockImplementation(async ({ input }) => {
    const name = new TextDecoder().decode(input);
    if (name.includes("bad")) throw new Error("Compression failed.");
    return result({ inputSize: input.length });
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageCompressRoute", () => {
  it("renders the file input with the image accept list and multiple", () => {
    render(<ImageCompressRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(input).toHaveAttribute("multiple");
  });

  it("adds a queue row per uploaded image and counts them", async () => {
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => {
      expect(screen.getByText("a.png")).toBeInTheDocument();
      expect(screen.getByText("b.png")).toBeInTheDocument();
      expect(screen.getByText("2 Files")).toBeInTheDocument();
    });
  });

  it("live-previews the auto-selected image and shows the saving badge", async () => {
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("photo.png")]);
    // First upload auto-selects → debounced preview fires a worker encode.
    await waitFor(() => expect(mock.compressViaWorker).toHaveBeenCalled(), { timeout: 2000 });
    // ratio 0.5 → real formatRatio → "−50%" badge; compressed size readout "50 B".
    await waitFor(() => {
      expect(screen.getByText("−50%")).toBeInTheDocument();
      expect(screen.getByText("50 B")).toBeInTheDocument();
    });
  });

  it("compresses and downloads a single image under its compressed name", async () => {
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("photo.png")]);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compress all" }));
    });
    // The per-row Download button only appears once the row reaches "done".
    const dl = await screen.findByRole("button", { name: "Download photo.png" });
    fireEvent.click(dl);

    expect(mock.downloadBlob).toHaveBeenCalledTimes(1);
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "photo-compressed.png");
    // One item done → no batch ZIP control.
    expect(
      screen.queryByRole("button", { name: /Download all .* as ZIP/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the original name + 'already optimized' when the guard fires", async () => {
    mock.compressViaWorker.mockResolvedValue(
      result({ keptOriginal: true, outputSize: 100, ratio: 0 }),
    );
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("already.png")]);
    await waitFor(() => expect(screen.getByText("already.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compress all" }));
    });

    const dl = await screen.findByRole("button", { name: "Download already.png" });
    expect(screen.getAllByText("already optimized").length).toBeGreaterThan(0);
    fireEvent.click(dl);
    // Regression-kept → download under the ORIGINAL filename, not "-compressed".
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "already.png");
  });

  it("zips and downloads all when more than one image is done", async () => {
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compress all" }));
    });

    const zipBtn = await screen.findByRole("button", { name: /Download all .* as ZIP/ });
    await act(async () => {
      fireEvent.click(zipBtn);
    });

    await waitFor(() => expect(mock.createBatchZip).toHaveBeenCalledTimes(1));
    expect(mock.createBatchZip).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ filename: "a-compressed.png" }),
        expect.objectContaining({ filename: "b-compressed.png" }),
      ]),
    );
    expect(mock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "compressed-images.zip");
  });

  it("marks the failed item as error and still finishes the rest of the batch (N2)", async () => {
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("good.png"), pngFile("bad.png"), pngFile("good2.png")]);
    await waitFor(() => expect(screen.getByText("good2.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compress all" }));
    });

    // The failing row surfaces its error; the others reach "done" (downloadable).
    await waitFor(() => {
      expect(screen.getByText(/couldn't compress/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download good2.png" })).toBeInTheDocument();
    });
    // "bad.png" never produced a result → no download button for it.
    expect(screen.queryByRole("button", { name: "Download bad.png" })).not.toBeInTheDocument();
  });

  it("shows the 'larger' warning + tomato badge on a negative ratio (N5)", async () => {
    mock.compressViaWorker.mockResolvedValue(result({ outputSize: 120, ratio: -0.2 }));
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("grows.png")]);

    await waitFor(
      () => {
        // formatRatio(-0.2) → "+20% larger" (warning), never a misleading "−" saving.
        expect(screen.getByText("+20% larger")).toBeInTheDocument();
        expect(screen.getByText(/came out larger than the original/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("rejects an image above the ~16 MP area cap and queues nothing", async () => {
    mock.readImageDims.mockReturnValue({ width: 5000, height: 5000 }); // 25 MP
    render(<ImageCompressRoute />);
    await uploadFiles([pngFile("huge.png")]);

    await waitFor(() => {
      expect(screen.getByText(/exceeds your browser's canvas limit/)).toBeInTheDocument();
    });
    expect(screen.queryByText("huge.png")).not.toBeInTheDocument();
    expect(screen.getByText("0 Files")).toBeInTheDocument();
  });
});
