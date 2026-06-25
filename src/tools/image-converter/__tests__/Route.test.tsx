import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAllMocks } from "../../../test/canvas-mock";
import ImageConverterRoute from "../Route";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../converter", async () => {
  const actual = await vi.importActual<typeof import("../converter")>("../converter");
  return {
    ...actual,
    validateImageFile: vi.fn(() => ({ valid: true })),
    readImageMeta: vi.fn().mockResolvedValue({ format: "png", width: 100, height: 100 }),
    convertImage: vi.fn().mockResolvedValue({
      blob: new Blob(["out"], { type: "image/png" }),
      type: "image/png",
      width: 100,
      height: 100,
      downscaled: false,
    }),
    canEncode: vi.fn(() => true),
    canDecodeAvif: vi.fn().mockResolvedValue(true),
    downloadBlob: vi.fn(),
    createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
    buildOutputFilename: vi.fn((name: string, format: string) => {
      const ext = format === "jpeg" ? "jpg" : format;
      const base = name.replace(/\.[^.]+$/, "");
      return `${base || "image"}.${ext}`;
    }),
  };
});

import * as converter from "../converter";

const mockConverter = vi.mocked(converter);

function makeFile(name: string, type = "image/png"): File {
  return new File(["data"], name, { type });
}

function pngFile(name: string): File {
  return makeFile(name, "image/png");
}

async function uploadFiles(files: File[]) {
  const input = screen.getByTestId("file-input");
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:image-converter");
  setupAllMocks();
  // vi.clearAllMocks() resets call counts but not implementations, so re-establish
  // the happy-path mocks here to keep each test isolated from a previous override.
  mockConverter.convertImage.mockResolvedValue({
    blob: new Blob(["out"], { type: "image/png" }),
    type: "image/png",
    width: 100,
    height: 100,
    downscaled: false,
  });
  mockConverter.canEncode.mockReturnValue(true);
  mockConverter.readImageMeta.mockResolvedValue({ format: "png", width: 100, height: 100 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageConverterRoute", () => {
  it("renders the file input with the full accept list and multiple", () => {
    render(<ImageConverterRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/x-ms-bmp,image/avif",
    );
    expect(input).toHaveAttribute("multiple");
  });

  it("renders a queue row per uploaded image", async () => {
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    await waitFor(() => {
      expect(screen.getByText("a.png")).toBeInTheDocument();
      expect(screen.getByText("b.png")).toBeInTheDocument();
      expect(screen.getByText("c.png")).toBeInTheDocument();
      expect(screen.getByText("3 Images")).toBeInTheDocument();
    });
  });

  it("shows the quality slider only for JPG/WebP and hides it for PNG", async () => {
    render(<ImageConverterRoute />);
    // Default is PNG → no quality slider.
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();

    const trigger = screen.getByTestId("format-trigger");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const jpg = await screen.findByRole("option", { name: "JPG" });
    fireEvent.pointerUp(jpg, { button: 0, pointerType: "mouse" });
    fireEvent.click(jpg);

    await waitFor(() => {
      expect(screen.getByRole("slider")).toBeInTheDocument();
    });
  });

  it("shows the background color input only for JPG with an alpha-capable input", async () => {
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    // PNG output → no bg color.
    expect(screen.queryByTestId("bg-color-input")).not.toBeInTheDocument();

    const trigger = screen.getByTestId("format-trigger");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const jpg = await screen.findByRole("option", { name: "JPG" });
    fireEvent.pointerUp(jpg, { button: 0, pointerType: "mouse" });
    fireEvent.click(jpg);

    await waitFor(() => {
      expect(screen.getByTestId("bg-color-input")).toBeInTheDocument();
    });
  });

  it("hides the WebP option when canEncode returns false", async () => {
    mockConverter.canEncode.mockReturnValue(false);
    render(<ImageConverterRoute />);
    const trigger = screen.getByTestId("format-trigger");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    await screen.findByRole("option", { name: "PNG" });
    expect(screen.getByRole("option", { name: "JPG" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "WebP" })).not.toBeInTheDocument();
  });

  it("downloads a single file (no zip) when one image is converted", async () => {
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("solo.png")]);
    await waitFor(() => expect(screen.getByText("solo.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => {
      expect(mockConverter.convertImage).toHaveBeenCalledTimes(1);
      expect(mockConverter.downloadBlob).toHaveBeenCalledTimes(1);
    });
    expect(mockConverter.createBatchZip).not.toHaveBeenCalled();
    expect(mockConverter.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "solo.png");
  });

  it("creates a zip then downloads it when multiple images are converted", async () => {
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    await waitFor(() => expect(screen.getByText("c.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => {
      expect(mockConverter.createBatchZip).toHaveBeenCalledTimes(1);
    });
    expect(mockConverter.createBatchZip).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ filename: "a.png" })]),
    );
    expect(mockConverter.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "images-converted-3.zip",
    );
  });

  it("shows a warning when an image is downscaled", async () => {
    mockConverter.convertImage.mockResolvedValue({
      blob: new Blob(["out"], { type: "image/png" }),
      type: "image/png",
      width: 8192,
      height: 8192,
      downscaled: true,
    });
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("big.png")]);
    await waitFor(() => expect(screen.getByText("big.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("warning")).toHaveTextContent(/downscaled to fit canvas limits/);
    });
  });

  it("zips the successes and warns about the failure on partial success", async () => {
    mockConverter.convertImage.mockImplementation(async (file: File) => {
      if (file.name === "bad.png") throw new Error("Conversion failed");
      return {
        blob: new Blob(["out"], { type: "image/png" }),
        type: "image/png",
        width: 100,
        height: 100,
        downscaled: false,
      };
    });
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("good1.png"), pngFile("bad.png"), pngFile("good2.png")]);
    await waitFor(() => expect(screen.getByText("good2.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => {
      expect(mockConverter.createBatchZip).toHaveBeenCalledTimes(1);
    });
    const zipItems = mockConverter.createBatchZip.mock.calls[0]?.[0];
    expect(zipItems).toHaveLength(2);
    expect(screen.getByTestId("warning")).toHaveTextContent(/Couldn't convert: bad\.png/);
  });

  it("does not download and shows an error when zero images convert", async () => {
    mockConverter.convertImage.mockRejectedValue(new Error("Conversion failed"));
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png")]);
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("No images could be converted.")).toBeInTheDocument();
    });
    expect(mockConverter.downloadBlob).not.toHaveBeenCalled();
    expect(mockConverter.createBatchZip).not.toHaveBeenCalled();
  });

  it("re-converts the same queue after a successful run", async () => {
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png")]);
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });
    // The download proves the entry actually reached "done" (not "error").
    await waitFor(() => {
      expect(mockConverter.convertImage).toHaveBeenCalledTimes(1);
      expect(mockConverter.downloadBlob).toHaveBeenCalledTimes(1);
    });

    // Change format, then convert again — entries are now "done" but must still be convertible.
    const trigger = screen.getByTestId("format-trigger");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const jpg = await screen.findByRole("option", { name: "JPG" });
    fireEvent.pointerUp(jpg, { button: 0, pointerType: "mouse" });
    fireEvent.click(jpg);

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });
    await waitFor(() => expect(mockConverter.convertImage).toHaveBeenCalledTimes(2));
  });

  it("coerces a persisted unsupported format (webp) back to PNG when encode is unavailable", async () => {
    localStorage.setItem(
      "utilbench:prefs:image-converter",
      JSON.stringify({ format: "webp", quality: 92, bgColor: "#ffffff" }),
    );
    mockConverter.canEncode.mockReturnValue(false);
    render(<ImageConverterRoute />);

    // Without coercion the Select would render blank (no matching item) and every convert would fail.
    await waitFor(() => {
      expect(screen.getByTestId("format-trigger")).toHaveTextContent("PNG");
    });
    const trigger = screen.getByTestId("format-trigger");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    await screen.findByRole("option", { name: "PNG" });
    expect(screen.queryByRole("option", { name: "WebP" })).not.toBeInTheDocument();
  });

  it("excludes a row removed after it already converted (mid-batch) from the zip", async () => {
    mockConverter.convertImage.mockImplementation(async (file: File) => {
      // a.png has already converted; remove it while b.png is converting.
      if (file.name === "b.png") {
        fireEvent.click(screen.getByLabelText("Remove a.png"));
      }
      return {
        blob: new Blob(["out"], { type: "image/png" }),
        type: "image/png",
        width: 100,
        height: 100,
        downscaled: false,
      };
    });
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    await waitFor(() => expect(screen.getByText("c.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => expect(mockConverter.createBatchZip).toHaveBeenCalledTimes(1));
    const zipItems = mockConverter.createBatchZip.mock.calls[0]?.[0] ?? [];
    const names = zipItems.map((z) => z.filename);
    expect(names).toEqual(["b.png", "c.png"]);
    expect(names).not.toContain("a.png");
  });

  it("excludes a row removed before it converts (mid-batch) from the zip", async () => {
    let removed = false;
    mockConverter.convertImage.mockImplementation(async (file: File) => {
      // While the first image is converting, the user removes the second row.
      if (file.name === "a.png" && !removed) {
        removed = true;
        fireEvent.click(screen.getByLabelText("Remove b.png"));
      }
      return {
        blob: new Blob(["out"], { type: "image/png" }),
        type: "image/png",
        width: 100,
        height: 100,
        downscaled: false,
      };
    });
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    await waitFor(() => expect(screen.getByText("c.png")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("convert-button"));
    });

    await waitFor(() => expect(mockConverter.createBatchZip).toHaveBeenCalledTimes(1));
    const zipItems = mockConverter.createBatchZip.mock.calls[0]?.[0] ?? [];
    const names = zipItems.map((z) => z.filename);
    expect(names).toEqual(["a.png", "c.png"]);
    expect(names).not.toContain("b.png");
  });

  it("removes an image and revokes its object URL", async () => {
    const { revokeObjectURL } = setupAllMocks();
    render(<ImageConverterRoute />);
    await uploadFiles([pngFile("remove-me.png")]);
    await waitFor(() => expect(screen.getByText("remove-me.png")).toBeInTheDocument());

    revokeObjectURL.mockClear();
    fireEvent.click(screen.getByTitle("Remove"));

    expect(screen.queryByText("remove-me.png")).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});
