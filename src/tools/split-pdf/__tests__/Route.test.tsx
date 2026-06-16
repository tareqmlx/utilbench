import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SplitPdfRoute from "../Route";

// Mock the splitter module so tests don't touch pdf-lib / real PDF parsing.
vi.mock("../splitter", () => ({
  MAX_OUTPUT_FILES: 500,
  validatePdfFile: vi.fn(() => ({ valid: true })),
  readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  getPdfMeta: vi.fn(async () => ({ pageCount: 10, encrypted: false })),
  parsePageRanges: vi.fn((spec: string) => {
    const groups = spec
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (groups.length === 0) return { ranges: [] };
    const ranges: Array<{ start: number; end: number; indices: number[] }> = [];
    for (const g of groups) {
      const [a, b] = g.split("-");
      const start = Number(a);
      const end = b ? Number(b) : start;
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return { ranges: [], error: `Invalid "${g}".` };
      }
      ranges.push({ start, end, indices: [] });
    }
    return { ranges };
  }),
  splitByRanges: vi.fn(async () => [
    { filename: "doc-pages-1-3.pdf", bytes: new Uint8Array([1]) },
    { filename: "doc-page-5.pdf", bytes: new Uint8Array([2]) },
  ]),
  splitEveryN: vi.fn(async () => [
    { filename: "doc-part-1.pdf", bytes: new Uint8Array([1]) },
    { filename: "doc-part-2.pdf", bytes: new Uint8Array([2]) },
  ]),
  splitPerPage: vi.fn(async () =>
    Array.from({ length: 10 }, (_, i) => ({
      filename: `doc-page-${i + 1}.pdf`,
      bytes: new Uint8Array([i]),
    })),
  ),
  zipOutputs: vi.fn(async () => new Uint8Array([9, 9, 9])),
  buildBaseName: vi.fn(() => "doc"),
  buildZipName: vi.fn(() => "doc-split.zip"),
  downloadBlob: vi.fn(),
}));

// sonner toasts are not under test — stub them.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  downloadBlob,
  getPdfMeta,
  splitByRanges,
  splitEveryN,
  splitPerPage,
  zipOutputs,
} from "../splitter";

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

async function uploadFile(file: File) {
  const input = screen.getByTestId("file-input");
  fireEvent.change(input, { target: { files: [file] } });
  // File summary renders when status === "ready" (page badge appears).
  await waitFor(() => {
    expect(screen.getByText("10 pages")).toBeInTheDocument();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SplitPdfRoute", () => {
  it("renders the dropzone and a single-file input", () => {
    render(<SplitPdfRoute />);
    expect(screen.getByText("Drop a PDF here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("shows the idle empty state initially", () => {
    render(<SplitPdfRoute />);
    expect(screen.getByText("No PDF yet. Upload a file to get started.")).toBeInTheDocument();
  });

  it("shows a file summary after uploading", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));
    expect(screen.getByText("10 pages")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("disables the split button before upload", () => {
    render(<SplitPdfRoute />);
    expect(screen.getByTestId("split-button")).toBeDisabled();
  });

  it("enables split in ranges mode only with a valid range", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    // Empty range → nothing to split.
    expect(screen.getByTestId("split-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3, 5" } });

    expect(screen.getByTestId("split-button")).not.toBeDisabled();
    expect(screen.getByTestId("output-preview")).toHaveTextContent("→ 2 files");
  });

  it("splits by ranges → splitByRanges, zipOutputs, downloadBlob", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3, 5" } });
    fireEvent.click(screen.getByTestId("split-button"));

    await waitFor(() => {
      expect(splitByRanges).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(zipOutputs).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
  });

  it("splits every N pages → splitEveryN, zipOutputs, downloadBlob", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("mode-every"));
    expect(screen.getByTestId("every-input")).toBeInTheDocument();
    expect(screen.getByTestId("split-button")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("split-button"));

    await waitFor(() => {
      expect(splitEveryN).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(zipOutputs).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
  });

  it("splits one per page → splitPerPage, zipOutputs, downloadBlob", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("mode-perPage"));
    expect(screen.queryByTestId("range-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("every-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("split-button")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("split-button"));

    await waitFor(() => {
      expect(splitPerPage).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(zipOutputs).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
  });

  it("downloads a single .pdf directly (no zip) when there is exactly one output", async () => {
    // One range "1-3" on a 10-page doc → one SUBSET output → skip the zip (§5.4).
    vi.mocked(splitByRanges).mockResolvedValueOnce([
      { filename: "doc-pages-1-3.pdf", bytes: new Uint8Array([1]) },
    ]);

    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    expect(screen.getByTestId("output-preview")).toHaveTextContent("→ 1 file");
    fireEvent.click(screen.getByTestId("split-button"));

    await waitFor(() => {
      expect(splitByRanges).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    // No archive for a single output.
    expect(zipOutputs).not.toHaveBeenCalled();
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("doc-pages-1-3.pdf");
  });

  it("blocks splitting an encrypted PDF and shows a warning", async () => {
    vi.mocked(getPdfMeta).mockResolvedValueOnce({ pageCount: 10, encrypted: true });

    render(<SplitPdfRoute />);
    await uploadFile(makePdf("locked.pdf"));

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3, 5" } });
    expect(screen.getByTestId("split-button")).toBeDisabled();
    expect(screen.getByText(/password-protected/i)).toBeInTheDocument();
  });

  it("shows an error and disables split for an invalid range spec", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "abc" } });
    expect(screen.getByTestId("split-button")).toBeDisabled();
    expect(screen.getByTestId("output-preview")).toHaveTextContent(/invalid/i);
  });

  it("treats a whole-document range as nothing to split", async () => {
    render(<SplitPdfRoute />);
    await uploadFile(makePdf("report.pdf"));

    // "1-10" on a 10-page doc = the whole unchanged document.
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-10" } });
    expect(screen.getByTestId("split-button")).toBeDisabled();
    expect(screen.getByTestId("output-preview")).toHaveTextContent(/nothing to split/i);
  });
});
