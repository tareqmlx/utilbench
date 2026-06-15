import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MergePdfRoute from "../Route";

// Mock the merger module so tests don't touch pdf-lib / real PDF parsing.
vi.mock("../merger", () => ({
  ACCEPTED_TYPES: ["application/pdf"],
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  WARN_FILE_SIZE: 25 * 1024 * 1024,
  MAX_TOTAL_SIZE: 250 * 1024 * 1024,
  validatePdfFile: vi.fn(() => ({ valid: true })),
  readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  getPdfMeta: vi.fn(async () => ({ pageCount: 3, encrypted: false })),
  mergePdfs: vi.fn(async () => new Uint8Array([4, 5, 6])),
  downloadBlob: vi.fn(),
  buildMergedFilename: vi.fn((items: { name: string }[]) =>
    items.length > 0 ? "doc-merged.pdf" : "merged.pdf",
  ),
}));

// sonner toasts are not under test — stub them.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { downloadBlob, mergePdfs } from "../merger";

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

async function uploadFiles(files: File[]) {
  const input = screen.getByTestId("file-input");
  fireEvent.change(input, { target: { files } });
  // Wait for all rows to transition loading -> ready (page badge appears).
  await waitFor(() => {
    const badges = screen.getAllByText("3 pages");
    expect(badges.length).toBe(files.length);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MergePdfRoute", () => {
  it("renders the dropzone and file input", () => {
    render(<MergePdfRoute />);
    expect(screen.getByText("Drop PDFs here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).toHaveAttribute("multiple");
  });

  it("shows empty state initially", () => {
    render(<MergePdfRoute />);
    expect(screen.getByText("No PDFs yet. Upload files to get started.")).toBeInTheDocument();
  });

  it("renders a row per uploaded file", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("a.pdf"), makePdf("b.pdf")]);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 Files")).toBeInTheDocument();
  });

  it("removes a row when its remove button is clicked", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("keep.pdf"), makePdf("drop.pdf")]);

    const dropRow = screen.getByText("drop.pdf").closest("div[style]") as HTMLElement;
    const removeBtn = within(dropRow).getByLabelText("Remove drop.pdf");
    fireEvent.click(removeBtn);

    expect(screen.queryByText("drop.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("keep.pdf")).toBeInTheDocument();
  });

  it("reorders rows with the move-down button", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("first.pdf"), makePdf("second.pdf")]);

    const namesBefore = screen.getAllByTitle(/\.pdf$/).map((el) => el.textContent);
    expect(namesBefore).toEqual(["first.pdf", "second.pdf"]);

    fireEvent.click(screen.getByLabelText("Move first.pdf down"));

    const namesAfter = screen.getAllByTitle(/\.pdf$/).map((el) => el.textContent);
    expect(namesAfter).toEqual(["second.pdf", "first.pdf"]);
  });

  it("reorders rows with the move-up button", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("first.pdf"), makePdf("second.pdf")]);

    fireEvent.click(screen.getByLabelText("Move second.pdf up"));

    const names = screen.getAllByTitle(/\.pdf$/).map((el) => el.textContent);
    expect(names).toEqual(["second.pdf", "first.pdf"]);
  });

  it("disables merge with fewer than 2 ready files", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("only.pdf")]);
    expect(screen.getByTestId("merge-button")).toBeDisabled();
    expect(screen.getByText("Add at least one more PDF to merge.")).toBeInTheDocument();
  });

  it("enables merge with 2 or more ready files", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("a.pdf"), makePdf("b.pdf")]);
    expect(screen.getByTestId("merge-button")).not.toBeDisabled();
  });

  it("merges files in list order and triggers download", async () => {
    render(<MergePdfRoute />);
    await uploadFiles([makePdf("one.pdf"), makePdf("two.pdf"), makePdf("three.pdf")]);

    // Reorder: move "three.pdf" to the top via two move-up clicks.
    fireEvent.click(screen.getByLabelText("Move three.pdf up"));
    fireEvent.click(screen.getByLabelText("Move three.pdf up"));

    const names = screen.getAllByTitle(/\.pdf$/).map((el) => el.textContent);
    expect(names).toEqual(["three.pdf", "one.pdf", "two.pdf"]);

    fireEvent.click(screen.getByTestId("merge-button"));

    await waitFor(() => {
      expect(mergePdfs).toHaveBeenCalledTimes(1);
    });

    const inputs = vi.mocked(mergePdfs).mock.calls[0]?.[0] ?? [];
    expect(inputs.map((i) => i.name)).toEqual(["three.pdf", "one.pdf", "two.pdf"]);

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
  });

  // NOTE: dnd-kit pointer-drag reordering is not simulatable in jsdom; drag
  // reordering is verified manually / via e2e. Programmatic reordering is
  // covered here through the accessible move-up / move-down buttons.
});
