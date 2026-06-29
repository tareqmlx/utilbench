import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// compressor.ts pulls in pdfjs-render (worker via ?url) + pdf.js + pdf-lib. Mock
// the worker URL and pdf.js so importActual loads cleanly when we spread it.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-url" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  AnnotationMode: { DISABLE: 1 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: vi.fn(),
}));

// Keep the pure helpers + constants real (formatBytes, buildCompressedFilename,
// DEFAULT_STRONG_*, STRONG_DPI_PRESETS); stub the heavy/IO functions.
vi.mock("../compressor", async (orig) => {
  const actual = await orig<typeof import("../compressor")>();
  return {
    ...actual,
    compressPdf: vi.fn(),
    validatePdfFile: vi.fn(() => ({ valid: true })),
    readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    probePdf: vi.fn(),
    downloadBlob: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import CompressPdfRoute from "../Route";
import {
  type CompressResult,
  compressPdf,
  downloadBlob,
  probePdf,
  validatePdfFile,
} from "../compressor";

type CompressHooks = {
  onProgress?: (done: number, total: number) => void;
  onPassword?: (kind: "need" | "incorrect") => Promise<string>;
  signal?: AbortSignal;
};

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

const PROBE = (over: Partial<Awaited<ReturnType<typeof probePdf>>> = {}) => ({
  pageCount: 10,
  encrypted: false,
  pageSizes: Array.from({ length: 10 }, () => ({ width: 612, height: 792 })),
  dimsKnown: true,
  ...over,
});

const RESULT = (over: Partial<CompressResult> = {}): CompressResult => ({
  bytes: new Uint8Array([9, 9, 9]),
  outputSize: 580_000,
  inputSize: 1_000_000,
  ratio: 0.42,
  keptOriginal: false,
  mode: "lossless",
  rasterized: false,
  clampedPages: 0,
  pageCount: 10,
  ...over,
});

async function upload(name = "report.pdf") {
  const input = screen.getByTestId("file-input");
  fireEvent.change(input, { target: { files: [makePdf(name)] } });
  await waitFor(() => {
    expect(screen.getByText(name)).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.mocked(probePdf).mockResolvedValue(PROBE());
  vi.mocked(validatePdfFile).mockReturnValue({ valid: true });
  vi.mocked(compressPdf).mockResolvedValue(RESULT());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CompressPdfRoute", () => {
  it("renders a single-file dropzone", () => {
    render(<CompressPdfRoute />);
    expect(screen.getByText("Drop a PDF here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("shows a summary with page count and size after upload", async () => {
    render(<CompressPdfRoute />);
    await upload();
    expect(screen.getByText("10 pages")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    // %PDF-1.4 file is 8 bytes.
    expect(screen.getByText("8 B")).toBeInTheDocument();
  });

  it("hides the page-count badge but keeps Compress enabled when dims are unknown", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(
      PROBE({ pageCount: 0, pageSizes: [], dimsKnown: false }),
    );
    render(<CompressPdfRoute />);
    await upload("unknown.pdf");
    expect(screen.queryByText("0 pages")).not.toBeInTheDocument();
    expect(screen.getByTestId("compress-button")).not.toBeDisabled();
  });

  it("reveals DPI, quality, and the raster warning only in Strong mode", async () => {
    render(<CompressPdfRoute />);
    await upload();
    expect(screen.queryByTestId("strong-controls")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mode-strong"));
    expect(screen.getByTestId("strong-controls")).toBeInTheDocument();
    expect(screen.getByTestId("dpi-72")).toBeInTheDocument();
    expect(screen.getByTestId("jpeg-quality")).toBeInTheDocument();
    expect(screen.getByTestId("raster-warning")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mode-lossless"));
    expect(screen.queryByTestId("strong-controls")).not.toBeInTheDocument();
  });

  it("forces Strong, disables Lossless, and shows a note for an encrypted PDF", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    render(<CompressPdfRoute />);
    await upload("locked.pdf");
    expect(screen.getByText("Password-protected")).toBeInTheDocument();
    expect(screen.getByTestId("mode-lossless")).toBeDisabled();
    expect(screen.getByTestId("mode-strong")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("encrypted-mode-note")).toBeInTheDocument();
    // Strong is allowed → Compress stays enabled.
    expect(screen.getByTestId("compress-button")).not.toBeDisabled();
  });

  it("prompts for a password (Strong + encrypted) and resolves with the typed value", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    let captured = "";
    vi.mocked(compressPdf).mockImplementationOnce(async (_b, _m, _s, hooks?: CompressHooks) => {
      captured = (await hooks?.onPassword?.("need")) ?? "";
      return RESULT({ mode: "strong", rasterized: true });
    });
    render(<CompressPdfRoute />);
    await upload("locked.pdf");
    fireEvent.click(screen.getByTestId("compress-button"));

    const dialog = await screen.findByTestId("password-dialog");
    fireEvent.change(within(dialog).getByTestId("password-input"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(within(dialog).getByTestId("password-submit"));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(captured).toBe("hunter2");
  });

  it("aborts with Cancelled and no download when the password prompt is dismissed", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    vi.mocked(compressPdf).mockImplementationOnce(async (_b, _m, _s, hooks?: CompressHooks) => {
      try {
        await hooks?.onPassword?.("need");
        return RESULT({ mode: "strong", rasterized: true });
      } catch {
        throw new DOMException("Aborted", "AbortError");
      }
    });
    render(<CompressPdfRoute />);
    await upload("locked.pdf");
    fireEvent.click(screen.getByTestId("compress-button"));

    const dialog = await screen.findByTestId("password-dialog");
    fireEvent.click(within(dialog).getByTestId("password-cancel"));

    await waitFor(() => expect(screen.getByText("Cancelled.")).toBeInTheDocument());
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("re-opens the dialog with the incorrect-password message on a wrong password", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    vi.mocked(compressPdf).mockImplementationOnce(async (_b, _m, _s, hooks?: CompressHooks) => {
      // pdf.js calls onPassword again with "incorrect" after a wrong attempt.
      await hooks?.onPassword?.("incorrect");
      return RESULT({ mode: "strong", rasterized: true });
    });
    render(<CompressPdfRoute />);
    await upload("locked.pdf");
    fireEvent.click(screen.getByTestId("compress-button"));

    const dialog = await screen.findByTestId("password-dialog");
    expect(within(dialog).getByTestId("password-error")).toBeInTheDocument();
    expect(within(dialog).getByText(/That password was incorrect/i)).toBeInTheDocument();
  });

  it("compresses with the chosen mode/dpi/quality and downloads a -compressed.pdf", async () => {
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("mode-strong"));
    fireEvent.click(screen.getByTestId("dpi-72"));
    fireEvent.click(screen.getByTestId("compress-button"));

    await waitFor(() => expect(compressPdf).toHaveBeenCalledTimes(1));
    const call = vi.mocked(compressPdf).mock.calls[0];
    expect(call?.[1]).toBe("strong");
    expect(call?.[2]).toMatchObject({ dpi: 72, jpegQuality: 0.6 });

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("report-compressed.pdf");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Compressed → −42%"));
  });

  it("clears the stale result readout when a compression option changes", async () => {
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("compress-button"));
    // A successful compress shows the −42% readout…
    await waitFor(() => expect(screen.getByTestId("result-readout")).toBeInTheDocument());

    // …but switching mode invalidates it — a strong/lossless toggle must not leave the
    // old percentage on screen implying it applies to the new settings.
    fireEvent.click(screen.getByTestId("mode-strong"));
    expect(screen.queryByTestId("result-readout")).not.toBeInTheDocument();
    expect(screen.getByTestId("result-preview")).toHaveTextContent(/choose a mode and compress/i);
  });

  it("shows the already-optimized notice and downloads under the ORIGINAL name when kept", async () => {
    vi.mocked(compressPdf).mockResolvedValueOnce(
      RESULT({
        keptOriginal: true,
        ratio: 0,
        outputSize: 1_000_000,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    );
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("compress-button"));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    // Original name, NOT report-compressed.pdf.
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe("report.pdf");
    expect(screen.getByTestId("kept-original-notice")).toBeInTheDocument();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Already optimized — your original was kept."),
    );
  });

  it("warns when pages were clamped below the target DPI", async () => {
    vi.mocked(compressPdf).mockResolvedValueOnce(
      RESULT({ mode: "strong", rasterized: true, clampedPages: 2 }),
    );
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("mode-strong"));
    fireEvent.click(screen.getByTestId("compress-button"));
    await waitFor(() =>
      expect(
        screen.getByText(/2 large pages were rendered below the target DPI/i),
      ).toBeInTheDocument(),
    );
  });

  it("does NOT show the clamp warning when the rasterized output was discarded (keptOriginal)", async () => {
    vi.mocked(compressPdf).mockResolvedValueOnce(
      RESULT({ mode: "strong", rasterized: true, clampedPages: 2, keptOriginal: true, ratio: 0 }),
    );
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("mode-strong"));
    fireEvent.click(screen.getByTestId("compress-button"));
    await waitFor(() => expect(screen.getByTestId("kept-original-notice")).toBeInTheDocument());
    expect(screen.queryByText(/rendered below the target DPI/i)).not.toBeInTheDocument();
  });

  it("resets mode to Lossless when a fresh non-encrypted PDF follows an encrypted one", async () => {
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: true }));
    render(<CompressPdfRoute />);
    await upload("locked.pdf");
    expect(screen.getByTestId("mode-strong")).toHaveAttribute("aria-pressed", "true");

    // A subsequent normal PDF must NOT silently stay on lossy Strong.
    vi.mocked(probePdf).mockResolvedValueOnce(PROBE({ encrypted: false }));
    await upload("normal.pdf");
    expect(screen.getByTestId("mode-lossless")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("strong-controls")).not.toBeInTheDocument();
  });

  it("cancels an in-flight Strong run via the Cancel button", async () => {
    let signalRef: AbortSignal | undefined;
    vi.mocked(compressPdf).mockImplementationOnce(
      (_b, _m, _s, hooks?: CompressHooks) =>
        new Promise((_res, rej) => {
          signalRef = hooks?.signal;
          hooks?.signal?.addEventListener("abort", () =>
            rej(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    render(<CompressPdfRoute />);
    await upload();
    fireEvent.click(screen.getByTestId("mode-strong"));
    fireEvent.click(screen.getByTestId("compress-button"));

    const cancel = await screen.findByTestId("cancel-button");
    fireEvent.click(cancel);

    await waitFor(() => expect(screen.getByText("Cancelled.")).toBeInTheDocument());
    expect(signalRef?.aborted).toBe(true);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("shows a Cancel button only for Strong (lossless has no abort checkpoint)", async () => {
    let resolveRun: (v: CompressResult) => void = () => {};
    vi.mocked(compressPdf).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveRun = r;
        }),
    );
    render(<CompressPdfRoute />);
    await upload();
    // Default mode is lossless.
    fireEvent.click(screen.getByTestId("compress-button"));
    await waitFor(() =>
      expect(screen.getByLabelText("Add a PDF: drop here, or click to browse")).toBeDisabled(),
    );
    expect(screen.queryByTestId("cancel-button")).not.toBeInTheDocument();
    resolveRun(RESULT());
  });

  it("shows an error for an invalid PDF and never probes it", async () => {
    vi.mocked(validatePdfFile).mockReturnValueOnce({
      valid: false,
      error: "That's not a valid PDF.",
    });
    render(<CompressPdfRoute />);
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [makePdf("bad.pdf")] } });
    // Visible destructive alert carries the validation message…
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("That's not a valid PDF."),
    );
    // …and the polite sr-only live region mirrors it for screen-reader users.
    expect(document.querySelector("output.sr-only")).toHaveTextContent("That's not a valid PDF.");
    expect(probePdf).not.toHaveBeenCalled();
  });

  it("disables Compress before upload", () => {
    render(<CompressPdfRoute />);
    expect(screen.getByTestId("compress-button")).toBeDisabled();
  });
});
