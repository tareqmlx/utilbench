import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import ImagesToPdfRoute from "../Route";

// Mock the converter module so tests never touch pdf-lib / real decoding.
// Route.tsx imports everything (incl. downloadBlob) from this single path.
vi.mock("../converter", () => ({
  MAX_QUEUE_SIZE: 50,
  MAX_TOTAL_SIZE: 250 * 1024 * 1024,
  validateImageFile: vi.fn(() => ({ valid: true })),
  readImageMeta: vi.fn(async () => ({ format: "png", width: 100, height: 80 })),
  imagesToPdf: vi.fn(async () => ({ bytes: new Uint8Array([1]), downscaledNames: [] })),
  buildPdfFilename: vi.fn((images: { name: string }[]) =>
    images.length > 0 ? "photos.pdf" : "images.pdf",
  ),
  downloadBlob: vi.fn(),
  // Non-null rect so the per-image degenerate check never blocks Convert.
  resolvePageSize: vi.fn(() => [595, 842]),
  computeImageLayout: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 80 })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { downloadBlob, imagesToPdf, readImageMeta } from "../converter";

function makeImage(name: string, type = "image/png"): File {
  return new File(["fake-image-bytes"], name, { type });
}

async function uploadFiles(files: File[]) {
  const input = screen.getByTestId("file-input");
  fireEvent.change(input, { target: { files } });
  // Wait for every row to transition loading -> ready (dims badge appears).
  await waitFor(() => {
    const badges = screen.getAllByText("100×80");
    expect(badges.length).toBe(files.length);
  });
}

beforeEach(() => {
  setupAllMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImagesToPdfRoute", () => {
  it("renders the dropzone and file input with correct attributes", () => {
    render(<ImagesToPdfRoute />);
    expect(screen.getByText("Drop images here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("multiple");
  });

  it("shows the empty state initially", () => {
    render(<ImagesToPdfRoute />);
    expect(
      screen.getByText("No images yet. Add some above, then drag to reorder before converting."),
    ).toBeInTheDocument();
  });

  it("renders a row per uploaded image with dims and size badges", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png"), makeImage("b.png"), makeImage("c.png")]);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(screen.getByText("c.png")).toBeInTheDocument();
    expect(screen.getByText("3 Images")).toBeInTheDocument();
    expect(screen.getAllByText("100×80")).toHaveLength(3);
  });

  it("reorders rows with the move-down button", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("first.png"), makeImage("second.png")]);

    const before = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(before).toEqual(["first.png", "second.png"]);

    fireEvent.click(screen.getByLabelText("Move first.png down"));

    const after = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(after).toEqual(["second.png", "first.png"]);
  });

  it("reorders rows with the move-up button", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("first.png"), makeImage("second.png")]);

    fireEvent.click(screen.getByLabelText("Move second.png up"));

    const names = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(names).toEqual(["second.png", "first.png"]);
  });

  it("removes an image row and revokes its preview URL", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("keep.png"), makeImage("drop.png")]);

    const revokeCallsBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length;

    const dropRow = screen.getByText("drop.png").closest("div[style]") as HTMLElement;
    const removeBtn = within(dropRow).getByLabelText("Remove drop.png");
    fireEvent.click(removeBtn);

    expect(screen.queryByText("drop.png")).not.toBeInTheDocument();
    expect(screen.getByText("keep.png")).toBeInTheDocument();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(revokeCallsBefore);
  });

  it("changes page size and disables orientation for Match image", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png")]);

    // Orientation buttons are interactive while a fixed page size is selected.
    expect(screen.getByRole("button", { name: "Portrait" })).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("page-size-trigger"));
    fireEvent.click(await screen.findByRole("option", { name: "Match image" }));

    // The "match" branch renders the explanatory note and disables orientation.
    await waitFor(() => {
      expect(screen.getByText(/orientation does not apply/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Portrait" })).toBeDisabled();
  });

  it("reflects orientation selection state", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png")]);

    const landscape = screen.getByRole("button", { name: "Landscape" });
    expect(landscape).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(landscape);
    expect(landscape).toHaveAttribute("aria-pressed", "true");
  });

  it("reflects fit selection state", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png")]);

    const fill = screen.getByRole("button", { name: "Fill" });
    fireEvent.click(fill);
    expect(fill).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Cover the page/)).toBeInTheDocument();
  });

  it("hides the JPEG-quality control for a PNG-only queue", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png")]);
    expect(screen.queryByText("JPEG quality")).not.toBeInTheDocument();
  });

  it("shows the JPEG-quality control when a JPEG source is present", async () => {
    vi.mocked(readImageMeta).mockResolvedValueOnce({ format: "jpeg", width: 100, height: 80 });
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("photo.jpg", "image/jpeg")]);
    expect(screen.getByText("JPEG quality")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("updates the margin via the number input", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("a.png")]);

    const marginInput = screen.getByTestId("margin-input") as HTMLInputElement;
    fireEvent.change(marginInput, { target: { value: "24" } });
    expect(marginInput.value).toBe("24");
    expect(screen.getByText("24 pt")).toBeInTheDocument();
  });

  it("converts in queue order and triggers a .pdf download", async () => {
    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("one.png"), makeImage("two.png"), makeImage("three.png")]);

    // Reorder: move "three.png" to the top.
    fireEvent.click(screen.getByLabelText("Move three.png up"));
    fireEvent.click(screen.getByLabelText("Move three.png up"));

    const names = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(names).toEqual(["three.png", "one.png", "two.png"]);

    // Pick a non-default fit so we can assert the chosen ConvertOptions flow through.
    fireEvent.click(screen.getByRole("button", { name: "Stretch" }));

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(imagesToPdf).toHaveBeenCalledTimes(1);
    });

    const call = vi.mocked(imagesToPdf).mock.calls[0];
    const passedFiles = call?.[0] ?? [];
    expect(passedFiles.map((f) => f.name)).toEqual(["three.png", "one.png", "two.png"]);

    const passedOpts = call?.[1];
    expect(passedOpts).toMatchObject({ pageSize: "A4", orientation: "auto", fit: "stretch" });

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    const downloadName = vi.mocked(downloadBlob).mock.calls[0]?.[1];
    expect(downloadName).toMatch(/\.pdf$/);
  });

  it("shows a warning when imagesToPdf reports downscaled images", async () => {
    vi.mocked(imagesToPdf).mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      downscaledNames: ["big.png"],
    });

    render(<ImagesToPdfRoute />);
    await uploadFiles([makeImage("big.png")]);

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(screen.getByText(/downscaled to fit canvas limits/)).toBeInTheDocument();
    });
  });
});
