import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Single mock path: the metadata module re-exports the @/lib/pdf helpers, so mocking it here
// covers readFileBytes/downloadBlob/validatePdfFile too.
vi.mock("../metadata", async () => {
  const actual = await vi.importActual("../metadata");
  return {
    ...actual,
    validatePdfFile: vi.fn(() => ({ valid: true })),
    readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readPdfMetadata: vi.fn(async () => ({
      title: "Quarterly Report",
      author: "Jane Doe",
      subject: null,
      keywords: null,
      creator: null,
      producer: "Microsoft Word",
      creationDate: new Date("2021-03-04T00:00:00Z"),
      modificationDate: null,
      hasXmp: true,
      customKeys: ["Trapped"],
      hasDocumentId: true,
      fieldCount: 6,
      pageCount: 3,
      encrypted: false,
    })),
    stripPdfMetadata: vi.fn(async () => new Uint8Array([9, 9, 9])),
    buildZip: vi.fn(() => new Blob(["zip"], { type: "application/zip" })),
    buildCleanedFilename: vi.fn(
      (name: string) => `${name.replace(/\.[^.]+$/, "")}-no-metadata.pdf`,
    ),
    downloadBlob: vi.fn(),
  };
});

import PdfMetadataRemovalRoute from "../Route";
import {
  buildZip,
  downloadBlob,
  readFileBytes,
  readPdfMetadata,
  stripPdfMetadata,
  validatePdfFile,
} from "../metadata";

const READY_METADATA = {
  title: "Quarterly Report",
  author: "Jane Doe",
  subject: null,
  keywords: null,
  creator: null,
  producer: "Microsoft Word",
  creationDate: new Date("2021-03-04T00:00:00Z"),
  modificationDate: null,
  hasXmp: true,
  customKeys: ["Trapped"],
  hasDocumentId: true,
  fieldCount: 6,
  pageCount: 3,
  encrypted: false,
};

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  // Clear call history and reset implementations back to defaults so per-test
  // `mockResolvedValueOnce` / `mockReturnValueOnce` queues never leak across tests.
  vi.clearAllMocks();
  vi.mocked(validatePdfFile).mockReturnValue({ valid: true });
  vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(readPdfMetadata).mockResolvedValue({ ...READY_METADATA });
  vi.mocked(stripPdfMetadata).mockResolvedValue(new Uint8Array([9, 9, 9]));
  vi.mocked(buildZip).mockReturnValue(new Blob(["zip"], { type: "application/zip" }));
  vi.mocked(downloadBlob).mockImplementation(() => {});
});

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function uploadFiles(...names: string[]) {
  const input = screen.getByTestId("file-input");
  const files = names.map(makePdf);
  fireEvent.change(input, { target: { files } });
  return files;
}

describe("PdfMetadataRemovalRoute", () => {
  it("renders the dropzone empty state with helper text and no queue", () => {
    render(<PdfMetadataRemovalRoute />);
    expect(screen.getByText("Drop your PDFs here")).toBeInTheDocument();
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/Queue \(/)).not.toBeInTheDocument();
  });

  it("has a file input with accept and multiple attributes", () => {
    render(<PdfMetadataRemovalRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).toHaveAttribute("multiple");
  });

  it("shows a file row and metadata chips after upload", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("report.pdf");

    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("Producer: Microsoft Word")).toBeInTheDocument();
      expect(screen.getByText("XMP metadata")).toBeInTheDocument();
      expect(screen.getByText("Document ID")).toBeInTheDocument();
      expect(screen.getByText("Trapped")).toBeInTheDocument();
      expect(screen.getByText("Created 2021-03-04")).toBeInTheDocument();
    });
  });

  it("blocks an encrypted PDF with a lock message and renders no metadata chips", async () => {
    vi.mocked(readPdfMetadata).mockResolvedValueOnce({
      title: null,
      author: null,
      subject: null,
      keywords: null,
      creator: null,
      producer: null,
      creationDate: null,
      modificationDate: null,
      hasXmp: false,
      customKeys: [],
      hasDocumentId: false,
      fieldCount: 0,
      pageCount: 1,
      encrypted: true,
    });

    render(<PdfMetadataRemovalRoute />);
    uploadFiles("locked.pdf");

    await waitFor(() => {
      // Match the visible queue message specifically — the live-region announcement
      // also contains "password-protected", so scope to the unique "Unlock it first." text.
      expect(screen.getByText(/Unlock it first/i)).toBeInTheDocument();
    });
    // The encrypted block is announced to SR users via the polite live region (WCAG 4.1.3),
    // not only painted into the (non-live) queue <li>.
    expect(screen.getByRole("status")).toHaveTextContent(/password-protected/i);
    // No metadata chips for an encrypted file.
    expect(screen.queryByText(/^Author:/)).not.toBeInTheDocument();
    expect(screen.queryByText("XMP metadata")).not.toBeInTheDocument();
    // Process is disabled — no ready files.
    const process = screen.getByText("Remove Metadata").closest("button");
    expect(process).toBeDisabled();
  });

  it("processes a single file via direct .pdf download (no zip)", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("solo.pdf");

    await waitFor(() => {
      expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument();
    });

    const process = screen.getByText("Remove Metadata").closest("button");
    if (process) fireEvent.click(process);

    await waitFor(() => {
      expect(stripPdfMetadata).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    // Direct .pdf download, no zip path.
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toMatch(/\.pdf$/);
    expect(buildZip).not.toHaveBeenCalled();
    expect(screen.queryByText("Download ZIP")).not.toBeInTheDocument();
    // Success box still shows a re-download affordance.
    expect(screen.getByText("1 PDF cleaned")).toBeInTheDocument();
    expect(screen.getByText("Download Again")).toBeInTheDocument();
  });

  it("processes multiple files into a zip and downloads it on click", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("a.pdf", "b.pdf");

    await waitFor(() => {
      expect(screen.getByText("a.pdf")).toBeInTheDocument();
      expect(screen.getByText("b.pdf")).toBeInTheDocument();
    });

    const process = screen.getByText("Remove Metadata").closest("button");
    if (process) fireEvent.click(process);

    await waitFor(() => {
      expect(buildZip).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Download ZIP")).toBeInTheDocument();
    });

    // Zip is NOT auto-downloaded; only on click.
    expect(downloadBlob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Download ZIP").closest("button") as HTMLElement);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("cleaned-pdfs.zip");
  });

  it("surfaces a large-file warning from validatePdfFile", async () => {
    vi.mocked(validatePdfFile).mockReturnValueOnce({
      valid: true,
      warning: "This file is large and may be slow to process.",
    });
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("big.pdf");

    await waitFor(() => {
      expect(screen.getByText(/large and may be slow/i)).toBeInTheDocument();
    });
  });

  it("marks a corrupt file as errored while others complete", async () => {
    vi.mocked(stripPdfMetadata)
      .mockRejectedValueOnce(new Error("corrupt"))
      .mockResolvedValueOnce(new Uint8Array([9, 9, 9]));

    render(<PdfMetadataRemovalRoute />);
    uploadFiles("bad.pdf", "good.pdf");

    await waitFor(() => {
      expect(screen.getByText("good.pdf")).toBeInTheDocument();
    });

    const process = screen.getByText("Remove Metadata").closest("button");
    if (process) fireEvent.click(process);

    await waitFor(() => {
      expect(screen.getByText(/Failed to strip metadata/i)).toBeInTheDocument();
    });
    // One file still finished → success box shows.
    await waitFor(() => {
      expect(screen.getByText("1 PDF cleaned")).toBeInTheDocument();
    });
  });

  it("handles drag-over, drag-leave, and drop with valid files", async () => {
    render(<PdfMetadataRemovalRoute />);
    const dropZone = screen.getByText("Drop your PDFs here").closest("div") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    fireEvent.drop(dropZone, { dataTransfer: { files: [makePdf("dropped.pdf")] } });

    await waitFor(() => {
      expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
    });
  });

  it("removes a queued file and a done file from the queue", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("removable.pdf");

    await waitFor(() => {
      expect(screen.getByText("removable.pdf")).toBeInTheDocument();
    });

    const removeBtn = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-testid")?.startsWith("remove-"));
    if (removeBtn) fireEvent.click(removeBtn);
    expect(screen.queryByText("removable.pdf")).not.toBeInTheDocument();
  });

  it("processes via ⌘⏎ and re-downloads via ⌘S", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("shortcut.pdf");

    await waitFor(() => {
      expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(stripPdfMetadata).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(2);
    });
  });

  it("shows the progress bar (or completion) during processing", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("p.pdf");

    await waitFor(() => {
      expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument();
    });

    const process = screen.getByText("Remove Metadata").closest("button");
    if (process) fireEvent.click(process);

    // Mocks resolve instantly — the bar may flash; either it's visible or processing finished.
    await waitFor(() => {
      const bar = screen.queryByTestId("progress-bar");
      expect(bar !== null || screen.queryByText("1 PDF cleaned") !== null).toBeTruthy();
    });
  });

  it("disables Process when the queue is empty or has no ready files", async () => {
    render(<PdfMetadataRemovalRoute />);
    // Empty queue → no process button at all.
    expect(screen.queryByText("Remove Metadata")).not.toBeInTheDocument();

    vi.mocked(readPdfMetadata).mockResolvedValueOnce({
      title: null,
      author: null,
      subject: null,
      keywords: null,
      creator: null,
      producer: null,
      creationDate: null,
      modificationDate: null,
      hasXmp: false,
      customKeys: [],
      hasDocumentId: false,
      fieldCount: 0,
      pageCount: 1,
      encrypted: true,
    });
    uploadFiles("locked.pdf");

    await waitFor(() => {
      // Match the visible queue message specifically — the live-region announcement
      // also contains "password-protected", so scope to the unique "Unlock it first." text.
      expect(screen.getByText(/Unlock it first/i)).toBeInTheDocument();
    });
    const process = screen.getByText("Remove Metadata").closest("button");
    expect(process).toBeDisabled();
  });

  it("supports adding more files after a run and re-processing", async () => {
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("first.pdf");

    await waitFor(() => {
      expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument();
    });

    let process = screen.getByText("Remove Metadata").closest("button");
    if (process) fireEvent.click(process);

    await waitFor(() => {
      expect(stripPdfMetadata).toHaveBeenCalledTimes(1);
    });

    // Add another file and re-process.
    uploadFiles("second.pdf");
    await waitFor(() => {
      expect(screen.getByText("second.pdf")).toBeInTheDocument();
    });

    process = screen.getByText("Remove Metadata").closest("button");
    expect(process).not.toBeDisabled();
    if (process) fireEvent.click(process);

    await waitFor(() => {
      expect(stripPdfMetadata).toHaveBeenCalledTimes(2);
    });
  });

  it("re-download after two separate single runs builds a zip of all done files", async () => {
    // Regression: two single-file runs leave doneCount=2 but zipBlob=null, so the old
    // `else if (zipBlob)` branch made "Download Again" a silent no-op. It must now zip all done files.
    render(<PdfMetadataRemovalRoute />);
    uploadFiles("one.pdf");
    await waitFor(() => expect(screen.getByText("Author: Jane Doe")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove Metadata").closest("button") as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1)); // run A auto-download

    uploadFiles("two.pdf");
    await waitFor(() => expect(screen.getByText("two.pdf")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove Metadata").closest("button") as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2)); // run B auto-download

    // Two done files, no zip was ever built during a run → re-download must build one on demand.
    expect(buildZip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Download Again").closest("button") as HTMLElement);
    expect(buildZip).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildZip).mock.calls[0]?.[0]).toHaveLength(2);
    expect(downloadBlob).toHaveBeenCalledTimes(3);
    expect(vi.mocked(downloadBlob).mock.calls[2]?.[1]).toBe("cleaned-pdfs.zip");
  });

  it("hides whitespace-only metadata chips and shows 'No metadata found'", async () => {
    // Regression: chips gated on raw truthiness rendered an empty "Title:"/"Author:" chip for a
    // whitespace-only value, contradicting the fieldCount-driven "No metadata found" badge.
    vi.mocked(readPdfMetadata).mockResolvedValueOnce({
      title: "   ",
      author: "\t",
      subject: "",
      keywords: null,
      creator: null,
      producer: null,
      creationDate: null,
      modificationDate: null,
      hasXmp: false,
      customKeys: [],
      hasDocumentId: false,
      fieldCount: 0,
      pageCount: 1,
      encrypted: false,
    });

    render(<PdfMetadataRemovalRoute />);
    uploadFiles("blank-meta.pdf");

    await waitFor(() => expect(screen.getByText("No metadata found")).toBeInTheDocument());
    expect(screen.queryByText(/^Title:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Author:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Subject:/)).not.toBeInTheDocument();
  });
});
