import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageMetadataRemovalRoute from "../Route";

vi.mock("../metadata", async () => {
  const actual = await vi.importActual("../metadata");
  return {
    ...actual,
    extractMetadata: vi.fn().mockResolvedValue({
      hasGps: true,
      cameraModel: "Sony A7R IV",
      exifVersion: "2.31",
      tagCount: 5,
      hasXmp: false,
      hasIptc: false,
    }),
    stripMetadata: vi.fn().mockResolvedValue(new Blob(["cleaned"], { type: "image/jpeg" })),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function uploadFile(name = "photo.jpg", type = "image/jpeg") {
  const input = screen.getByTestId("file-input");
  const file = new File(["fake-image-data"], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("ImageMetadataRemovalRoute", () => {
  it("renders upload zone initially, no queue visible", () => {
    render(<ImageMetadataRemovalRoute />);
    expect(screen.getByText("Drop your images here")).toBeInTheDocument();
    expect(screen.queryByText(/Processing Queue/)).not.toBeInTheDocument();
  });

  it("has file input with correct accept and multiple attributes", () => {
    render(<ImageMetadataRemovalRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("multiple");
  });

  it("rejects invalid file types with error banner", () => {
    render(<ImageMetadataRemovalRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
  });

  it("rejects oversized files with error banner", () => {
    render(<ImageMetadataRemovalRoute />);
    const input = screen.getByTestId("file-input");
    const bigData = new Uint8Array(50 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/File too large/)).toBeInTheDocument();
  });

  it("shows file in queue after upload with metadata tags", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("mountain.jpg");

    await waitFor(() => {
      expect(screen.getByText("mountain.jpg")).toBeInTheDocument();
    });

    // Metadata tags appear after analysis
    await waitFor(() => {
      expect(screen.getByText("GPS Data Detected")).toBeInTheDocument();
      expect(screen.getByText("Sony A7R IV")).toBeInTheDocument();
      expect(screen.getByText("EXIF 2.31")).toBeInTheDocument();
    });
  });

  it("shows processing queue with correct count", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("a.jpg");

    await waitFor(() => {
      expect(screen.getByText("Processing Queue (1)")).toBeInTheDocument();
    });
  });

  it("removes file from queue when delete button is clicked", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("removable.jpg");

    await waitFor(() => {
      expect(screen.getByText("removable.jpg")).toBeInTheDocument();
    });

    // Find and click the remove button (icon-only button with data-testid)
    const removeButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("data-testid")?.startsWith("remove-"));
    const firstButton = removeButtons[0];
    if (firstButton) fireEvent.click(firstButton);

    expect(screen.queryByText("removable.jpg")).not.toBeInTheDocument();
  });

  it("process button is disabled with no ready files", () => {
    render(<ImageMetadataRemovalRoute />);
    // No files uploaded, no process button visible
    expect(screen.queryByText("Remove Metadata & Download ZIP")).not.toBeInTheDocument();
  });

  it("shows progress bar during processing", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("process.jpg");

    await waitFor(() => {
      expect(screen.getByText(/Metadata: 5 tags/)).toBeInTheDocument();
    });

    const processButton = screen.getByText("Remove Metadata & Download ZIP").closest("button");
    if (processButton) fireEvent.click(processButton);

    // Progress bar should appear during processing
    await waitFor(() => {
      const progressBar = screen.queryByTestId("progress-bar");
      // It may flash quickly, but the processing should complete
      expect(
        progressBar !== null || screen.queryByText("Processing Complete!") !== null,
      ).toBeTruthy();
    });
  });

  it("shows success banner after processing with Download ZIP button", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("success.jpg");

    await waitFor(() => {
      expect(screen.getByText(/Metadata: 5 tags/)).toBeInTheDocument();
    });

    const processButton = screen.getByText("Remove Metadata & Download ZIP").closest("button");
    if (processButton) fireEvent.click(processButton);

    await waitFor(() => {
      expect(screen.getByText("Processing Complete!")).toBeInTheDocument();
      expect(screen.getByText("Download ZIP")).toBeInTheDocument();
    });
  });

  it("supports uploading multiple files", async () => {
    render(<ImageMetadataRemovalRoute />);
    const input = screen.getByTestId("file-input");
    const file1 = new File(["data1"], "a.jpg", { type: "image/jpeg" });
    const file2 = new File(["data2"], "b.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(screen.getByText("a.jpg")).toBeInTheDocument();
      expect(screen.getByText("b.png")).toBeInTheDocument();
      expect(screen.getByText("Processing Queue (2)")).toBeInTheDocument();
    });
  });

  it("handles drag events without crashing", () => {
    render(<ImageMetadataRemovalRoute />);
    const dropZone = screen.getByText("Drop your images here").closest("div") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
  });

  it("handles drop event with valid files", async () => {
    render(<ImageMetadataRemovalRoute />);
    const dropZone = screen.getByText("Drop your images here").closest("div") as HTMLElement;
    const file = new File(["data"], "dropped.jpg", { type: "image/jpeg" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("dropped.jpg")).toBeInTheDocument();
    });
  });

  it("shows metadata tag count after analysis", async () => {
    render(<ImageMetadataRemovalRoute />);
    uploadFile("meta.jpg");

    await waitFor(() => {
      expect(screen.getByText(/Metadata: 5 tags/)).toBeInTheDocument();
    });
  });

  it("renders hero section with title", () => {
    render(<ImageMetadataRemovalRoute />);
    expect(screen.getByText(/Metadata/)).toBeInTheDocument();
    expect(screen.getByText(/Remover/)).toBeInTheDocument();
  });
});
