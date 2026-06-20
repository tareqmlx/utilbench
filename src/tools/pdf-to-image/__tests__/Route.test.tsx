import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// renderer.ts imports the pdf.js worker via a `?url` query Vitest can't resolve,
// and imports pdf.js / pdf-lib. Mock the worker URL so importActual loads cleanly.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-url" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  AnnotationMode: { DISABLE: 1 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: vi.fn(),
}));

// Keep the pure helpers (computeOutputDims/resolvePageList/maxOutputPages/
// buildBaseName + constants) real; mock the heavy/IO functions.
vi.mock("../renderer", async (orig) => {
  const actual = await orig<typeof import("../renderer")>();
  return {
    ...actual,
    probePdf: vi.fn(),
    renderPdfToImages: vi.fn(),
    zipImages: vi.fn(),
    downloadBlob: vi.fn(),
    validatePdfFile: vi.fn(() => ({ valid: true })),
    readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import PdfToImageRoute from "../Route";
import { downloadBlob, probePdf, renderPdfToImages, validatePdfFile, zipImages } from "../renderer";

type RenderHooks = {
  onProgress?: (done: number, total: number) => void;
  onPassword?: (kind: "need" | "incorrect") => Promise<string>;
  signal?: AbortSignal;
};

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function fakePage(pageNumber: number, filename: string, clamped = false) {
  return {
    pageNumber,
    blob: new Blob(["x"], { type: "image/png" }),
    filename,
    width: 1275,
    height: 1650,
    clamped,
  };
}

const PROBE = (over: Partial<Awaited<ReturnType<typeof probePdf>>> = {}) => ({
  pageCount: 10,
  encrypted: false,
  pageSizes: Array.from({ length: 10 }, () => ({ width: 612, height: 792 })),
  dimsKnown: true,
  ...over,
});

async function upload(name = "report.pdf") {
  const input = screen.getByTestId("file-input");
  fireEvent.change(input, { target: { files: [makePdf(name)] } });
  await waitFor(() => {
    expect(screen.getByText("10 pages")).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.mocked(probePdf).mockResolvedValue(PROBE());
  vi.mocked(validatePdfFile).mockReturnValue({ valid: true });
  vi.mocked(zipImages).mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PdfToImageRoute", () => {
  it("renders a single-file dropzone", () => {
    render(<PdfToImageRoute />);
    expect(screen.getByText("Drop a PDF here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("shows a summary with page count after upload", async () => {
    render(<PdfToImageRoute />);
    await upload();
    expect(screen.getByText("10 pages")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("shows an encrypted badge but still allows converting", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    render(<PdfToImageRoute />);
    await upload("locked.pdf");
    expect(screen.getByText("Password-protected")).toBeInTheDocument();
    // Encrypted does NOT disable convert (diverges from split-pdf).
    expect(screen.getByTestId("convert-button")).not.toBeDisabled();
  });

  it("allows converting when the probe can't read dims (unknown page count) — §5.6", async () => {
    // pdf-lib couldn't parse (e.g. AES): unknown page count, marked encrypted.
    vi.mocked(probePdf).mockResolvedValueOnce(
      PROBE({ pageCount: 0, encrypted: true, pageSizes: [], dimsKnown: false }),
    );
    render(<PdfToImageRoute />);
    const input = screen.getByTestId("file-input");
    fireEvent.change(input, { target: { files: [makePdf("aes.pdf")] } });
    await waitFor(() => expect(screen.getByText("aes.pdf")).toBeInTheDocument());
    // No "0 pages" badge — page count is unknown until unlock.
    expect(screen.queryByText("0 pages")).not.toBeInTheDocument();
    expect(screen.getByText("Password-protected")).toBeInTheDocument();
    // Convert stays enabled so pdf.js can drive the password prompt + render.
    expect(screen.getByTestId("convert-button")).not.toBeDisabled();
  });

  it("shows the live output-dims readout and updates with DPI", async () => {
    render(<PdfToImageRoute />);
    await upload();
    // 612×792 pt @150 DPI → 1275×1650.
    expect(screen.getByTestId("dims-readout")).toHaveTextContent("1275×1650 px at 150 DPI");
    fireEvent.click(screen.getByTestId("dpi-300"));
    // @300 DPI → 2550×3300.
    expect(screen.getByTestId("dims-readout")).toHaveTextContent("2550×3300 px at 300 DPI");
  });

  it("shows the JPEG quality slider only when JPEG is selected", async () => {
    render(<PdfToImageRoute />);
    await upload();
    expect(screen.queryByTestId("jpeg-quality")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("format-jpeg"));
    expect(screen.getByTestId("jpeg-quality")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("format-png"));
    expect(screen.queryByTestId("jpeg-quality")).not.toBeInTheDocument();
  });

  it("downloads a single image directly (no zip) for a one-page result", async () => {
    vi.mocked(renderPdfToImages).mockResolvedValueOnce({
      pages: [fakePage(1, "report-page-1.png")],
      failures: [],
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(zipImages).not.toHaveBeenCalled();
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("report-page-1.png");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rendered 1 image"));
  });

  it("zips multi-page results and downloads the archive", async () => {
    vi.mocked(renderPdfToImages).mockResolvedValueOnce({
      pages: [fakePage(1, "report-page-01.png"), fakePage(2, "report-page-02.png")],
      failures: [],
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => expect(zipImages).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("report-images.zip");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rendered 2 images"));
  });

  it("warns when some pages are clamped", async () => {
    vi.mocked(renderPdfToImages).mockResolvedValueOnce({
      pages: [fakePage(1, "report-page-01.png", true), fakePage(2, "report-page-02.png")],
      failures: [],
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("convert-button"));
    await waitFor(() => expect(screen.getByText(/lower effective DPI/i)).toBeInTheDocument());
  });

  it("warns when some pages fail to render (partial success)", async () => {
    vi.mocked(renderPdfToImages).mockResolvedValueOnce({
      pages: [fakePage(1, "report-page-01.png")],
      failures: [{ pageNumber: 2, message: "boom" }],
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("convert-button"));
    await waitFor(() =>
      expect(
        screen.getByText(/Rendered 1 of 2 pages; 1 could not be rendered/i),
      ).toBeInTheDocument(),
    );
  });

  it("prompts for a password and resolves with the typed value", async () => {
    let captured = "";
    vi.mocked(renderPdfToImages).mockImplementationOnce(async (_b, _n, _o, hooks?: RenderHooks) => {
      captured = (await hooks?.onPassword?.("need")) ?? "";
      return { pages: [fakePage(1, "report-page-1.png")], failures: [] };
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("convert-button"));

    const dialog = await screen.findByTestId("password-dialog");
    fireEvent.change(within(dialog).getByTestId("password-input"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(within(dialog).getByTestId("password-submit"));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(captured).toBe("hunter2");
  });

  it("aborts with a Cancelled message when the password prompt is dismissed", async () => {
    vi.mocked(renderPdfToImages).mockImplementationOnce(async (_b, _n, _o, hooks?: RenderHooks) => {
      try {
        await hooks?.onPassword?.("need");
        return { pages: [fakePage(1, "report-page-1.png")], failures: [] };
      } catch {
        throw new DOMException("Aborted", "AbortError");
      }
    });
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("convert-button"));

    const dialog = await screen.findByTestId("password-dialog");
    fireEvent.click(within(dialog).getByTestId("password-cancel"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancelled."));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("shows an error for an invalid PDF", async () => {
    vi.mocked(validatePdfFile).mockReturnValueOnce({
      valid: false,
      error: "That's not a valid PDF.",
    });
    render(<PdfToImageRoute />);
    const input = screen.getByTestId("file-input");
    fireEvent.change(input, { target: { files: [makePdf("bad.pdf")] } });
    await waitFor(() => expect(screen.getByText("That's not a valid PDF.")).toBeInTheDocument());
    expect(probePdf).not.toHaveBeenCalled();
  });

  it("disables Convert for a bad page range", async () => {
    render(<PdfToImageRoute />);
    await upload();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "abc" } });
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("disables Convert before upload", () => {
    render(<PdfToImageRoute />);
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });
});
