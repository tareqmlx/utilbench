import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WatermarkPdfRoute from "../Route";

// jsdom has no object-URL impl; the image preview + revoke paths need it.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

// Single mock for the watermarker module (logic + re-exported pdf helpers).
vi.mock("../watermarker", () => ({
  applyWatermark: vi.fn(async () => new Uint8Array([4, 2])),
  prepareImageBytes: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    type: "image/png" as const,
  })),
  validateWinAnsi: vi.fn(() => ({ ok: true })),
  buildWatermarkedFilename: vi.fn(() => "x-watermarked.pdf"),
  countTargetPages: vi.fn(() => 3),
  parsePageRanges: vi.fn((spec: string) => {
    const t = spec.trim();
    if (t === "") return { ranges: [] };
    if (/^[\d\s,-]+$/.test(t)) return { ranges: [{ start: 1, end: 1, indices: [0] }] };
    return { ranges: [], error: `Invalid range "${t}".` };
  }),
  // pdf-lib rgb stub: deterministic so the config color is assertable.
  rgb: (r: number, g: number, b: number) => ({ r, g, b, type: "RGB" }),
  validatePdfFile: vi.fn(() => ({ valid: true })),
  readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  getPdfMeta: vi.fn(async () => ({ pageCount: 3, encrypted: false })),
  downloadBlob: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  applyWatermark,
  countTargetPages,
  downloadBlob,
  getPdfMeta,
  parsePageRanges,
  validateWinAnsi,
} from "../watermarker";

function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function makeImage(name: string, type = "image/png"): File {
  return new File(["\x89PNG"], name, { type });
}

async function uploadPdf(file: File) {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getByText("3 pages")).toBeInTheDocument();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Restore the default valid WinAnsi result after per-test overrides.
  vi.mocked(validateWinAnsi).mockReturnValue({ ok: true });
  vi.mocked(countTargetPages).mockReturnValue(3);
  vi.mocked(parsePageRanges).mockImplementation((spec: string) => {
    const t = spec.trim();
    if (t === "") return { ranges: [] };
    if (/^[\d\s,-]+$/.test(t)) return { ranges: [{ start: 1, end: 1, indices: [0] }] };
    return { ranges: [], error: `Invalid range "${t}".` };
  });
});

describe("WatermarkPdfRoute", () => {
  it("renders the dropzone and a single-file PDF input (no multiple)", () => {
    render(<WatermarkPdfRoute />);
    expect(screen.getByText("Drop a PDF here or click to browse")).toBeInTheDocument();
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("shows a file summary after uploading a PDF", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    expect(screen.getByText("3 pages")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("disables apply before any PDF is loaded", () => {
    render(<WatermarkPdfRoute />);
    expect(screen.getByTestId("apply-button")).toBeDisabled();
  });

  it("switches between Text and Image tabs to show the right controls", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    // Default: text mode.
    expect(screen.getByTestId("text-input")).toBeInTheDocument();
    expect(screen.queryByTestId("image-input")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("kind-image"));
    expect(screen.getByTestId("image-input")).toBeInTheDocument();
    expect(screen.queryByTestId("text-input")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("kind-text"));
    expect(screen.getByTestId("text-input")).toBeInTheDocument();
  });

  it("shows an inline error and disables apply for a non-WinAnsi character", async () => {
    vi.mocked(validateWinAnsi).mockReturnValue({ ok: false, badChar: "日" });
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    // Force the memo to recompute under the override.
    fireEvent.change(screen.getByTestId("text-input"), { target: { value: "日本語" } });

    expect(screen.getByTestId("text-error")).toHaveTextContent("日");
    expect(screen.getByTestId("apply-button")).toBeDisabled();
  });

  it("disables apply when the text is empty (neutral hint, not an error)", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.change(screen.getByTestId("text-input"), { target: { value: "" } });
    expect(screen.queryByTestId("text-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("apply-button")).toBeDisabled();
  });

  it("loads an image and enables apply in image mode", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    fireEvent.click(screen.getByTestId("kind-image"));

    // No image yet → apply disabled.
    expect(screen.getByTestId("apply-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("image-input"), {
      target: { files: [makeImage("logo.png")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    });
    expect(screen.getByTestId("apply-button")).not.toBeDisabled();
  });

  it("disables apply and shows the hint when opacity is 0 (plan-pinned gate)", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.change(screen.getByTestId("opacity-input"), { target: { value: "0" } });
    expect(screen.getByTestId("apply-button")).toBeDisabled();
    expect(screen.getByText(/invisible at 0% opacity/i)).toBeInTheDocument();
  });

  it("disables apply for an invalid page range spec", async () => {
    vi.mocked(parsePageRanges).mockReturnValue({ ranges: [], error: "Invalid range." });
    vi.mocked(countTargetPages).mockReturnValue(0);

    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("page-mode-ranges"));
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "abc" } });

    expect(screen.getByTestId("range-error")).toHaveTextContent(/invalid/i);
    expect(screen.getByTestId("apply-button")).toBeDisabled();
  });

  it("blocks watermarking an encrypted PDF and shows a warning", async () => {
    vi.mocked(getPdfMeta).mockResolvedValueOnce({ pageCount: 3, encrypted: true });
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("locked.pdf"));

    expect(screen.getByTestId("apply-button")).toBeDisabled();
    expect(screen.getByText(/password-protected/i)).toBeInTheDocument();
  });

  it("applies a text watermark with the expected config + target, then downloads a .pdf", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    const apply = screen.getByTestId("apply-button");
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);

    await waitFor(() => {
      expect(applyWatermark).toHaveBeenCalledTimes(1);
    });

    const call = vi.mocked(applyWatermark).mock.calls[0];
    expect(call?.[1]).toMatchObject({
      kind: "text",
      text: "CONFIDENTIAL",
      fontName: "HelveticaBold",
      fontSize: 48,
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.2,
      rotation: -45,
      layout: "tile",
      anchor: "center",
      tileGap: 80,
    });
    expect(call?.[2]).toEqual({ mode: "all" });

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toMatch(/\.pdf$/);
  });

  it("surfaces applyWatermark's actionable message instead of a generic 'corrupt' error", async () => {
    vi.mocked(applyWatermark).mockRejectedValueOnce(
      new Error("Too many watermark tiles — increase the tile gap or target fewer pages."),
    );
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("apply-button"));

    await waitFor(() => {
      expect(screen.getByText(/Too many watermark tiles/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/may be corrupt or unreadable/)).not.toBeInTheDocument();
  });

  it("falls back to a generic message when applyWatermark throws a non-Error", async () => {
    vi.mocked(applyWatermark).mockRejectedValueOnce("boom");
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("apply-button"));

    await waitFor(() => {
      expect(screen.getByText(/may be corrupt or unreadable/)).toBeInTheDocument();
    });
  });

  it("associates the WinAnsi error with the text input via aria-describedby", async () => {
    vi.mocked(validateWinAnsi).mockReturnValue({ ok: false, badChar: "日" });
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    fireEvent.change(screen.getByTestId("text-input"), { target: { value: "日本語" } });

    const input = screen.getByTestId("text-input");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "wm-text-error");
    expect(screen.getByTestId("text-error")).toHaveAttribute("id", "wm-text-error");
  });

  it("points the text input at the neutral hint (not an error) when empty", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    fireEvent.change(screen.getByTestId("text-input"), { target: { value: "" } });

    const input = screen.getByTestId("text-input");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("aria-describedby", "wm-text-hint");
    expect(document.getElementById("wm-text-hint")).toBeInTheDocument();
  });

  it("associates the range error with the range input via aria-describedby", async () => {
    vi.mocked(parsePageRanges).mockReturnValue({ ranges: [], error: "Invalid range." });
    vi.mocked(countTargetPages).mockReturnValue(0);
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));

    fireEvent.click(screen.getByTestId("page-mode-ranges"));
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "abc" } });

    const input = screen.getByTestId("range-input");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "wm-range-error");
    expect(screen.getByTestId("range-error")).toHaveAttribute("id", "wm-range-error");
  });

  it("exposes the position picker as a labeled group", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    fireEvent.click(screen.getByTestId("layout-single"));

    const grid = screen.getByTestId("anchor-grid");
    expect(grid.tagName).toBe("FIELDSET");
    expect(grid).toHaveAttribute("aria-label", "Position");
  });

  it("applies an image watermark with imageType png", async () => {
    render(<WatermarkPdfRoute />);
    await uploadPdf(makePdf("report.pdf"));
    fireEvent.click(screen.getByTestId("kind-image"));
    fireEvent.change(screen.getByTestId("image-input"), {
      target: { files: [makeImage("logo.png")] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("apply-button"));
    await waitFor(() => {
      expect(applyWatermark).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(applyWatermark).mock.calls[0]?.[1]).toMatchObject({
      kind: "image",
      imageType: "image/png",
      scale: 0.4,
    });
  });
});
