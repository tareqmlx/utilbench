import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ImageResizerRoute from "../Route";

// Radix Slider uses ResizeObserver which is not available in jsdom
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Radix Select uses pointer capture APIs not available in jsdom
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
});

vi.mock("../resizer", async () => {
  const actual = await vi.importActual("../resizer");
  return {
    ...actual,
    resizeImage: vi.fn().mockResolvedValue(new Blob(["mock"], { type: "image/jpeg" })),
    getImageDimensions: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    isFormatSupported: vi.fn().mockReturnValue(true),
    createBatchZip: vi.fn().mockResolvedValue(new Blob(["zip"], { type: "application/zip" })),
    downloadBlob: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:image-resizer");
});

afterEach(() => {
  cleanup();
});

describe("ImageResizerRoute", () => {
  it("renders without crashing", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Drag and drop images here")).toBeInTheDocument();
  });

  it("shows upload zone initially", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Drag and drop images here")).toBeInTheDocument();
    expect(screen.getByText("Browse Files")).toBeInTheDocument();
  });

  it("has a file input element with correct accept", () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  });

  it("rejects invalid file types", () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
  });

  it("rejects oversized files", () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const bigData = new Uint8Array(20 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/File too large/)).toBeInTheDocument();
  });

  it("shows empty queue message initially", () => {
    render(<ImageResizerRoute />);
    expect(
      screen.getByText("No images in queue. Upload files to get started."),
    ).toBeInTheDocument();
  });

  it("displays 0 Files count when queue is empty", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("0 Files")).toBeInTheDocument();
  });

  it("has resize button disabled when queue is empty", () => {
    render(<ImageResizerRoute />);
    const button = screen.getByText("Resize & Download").closest("button");
    expect(button).toBeDisabled();
  });

  it("renders mode toggle buttons", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Single")).toBeInTheDocument();
    expect(screen.getByText("Batch")).toBeInTheDocument();
  });

  it("defaults to single mode with active styling", () => {
    render(<ImageResizerRoute />);
    const singleTab = screen.getByRole("tab", { name: "Single" });
    expect(singleTab).toHaveAttribute("data-state", "active");
  });

  it("toggles to batch mode", async () => {
    const user = userEvent.setup();
    render(<ImageResizerRoute />);
    await user.click(screen.getByRole("tab", { name: "Batch" }));
    const batchTab = screen.getByRole("tab", { name: "Batch" });
    expect(batchTab).toHaveAttribute("data-state", "active");
  });

  it("renders dimension inputs with default values", () => {
    render(<ImageResizerRoute />);
    const widthInput = screen.getByLabelText("Width (px)") as HTMLInputElement;
    const heightInput = screen.getByLabelText("Height (px)") as HTMLInputElement;
    expect(widthInput.value).toBe("1920");
    expect(heightInput.value).toBe("1080");
  });

  it("updates width input value", () => {
    render(<ImageResizerRoute />);
    const widthInput = screen.getByLabelText("Width (px)") as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "800" } });
    expect(widthInput.value).toBe("800");
  });

  it("updates height input value", () => {
    render(<ImageResizerRoute />);
    const heightInput = screen.getByLabelText("Height (px)") as HTMLInputElement;
    fireEvent.change(heightInput, { target: { value: "600" } });
    expect(heightInput.value).toBe("600");
  });

  it("renders format select with all options", async () => {
    render(<ImageResizerRoute />);
    // Radix Select renders as a combobox trigger
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("JPEG");

    // Open select to verify options exist (Radix listens to pointerdown)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(await screen.findByRole("option", { name: "PNG" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "WebP" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /AVIF/ })).toBeInTheDocument();
  });

  it("changes format selection", async () => {
    render(<ImageResizerRoute />);
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const pngOption = await screen.findByRole("option", { name: "PNG" });
    fireEvent.pointerUp(pngOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(pngOption);
    expect(trigger).toHaveTextContent("PNG");
  });

  it("shows quality as N/A for PNG format", async () => {
    render(<ImageResizerRoute />);
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const pngOption = await screen.findByRole("option", { name: "PNG" });
    fireEvent.pointerUp(pngOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(pngOption);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("disables quality slider for PNG format", async () => {
    render(<ImageResizerRoute />);
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const pngOption = await screen.findByRole("option", { name: "PNG" });
    fireEvent.pointerUp(pngOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(pngOption);
    // Radix Slider uses role="slider" and data-disabled attribute when disabled
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("data-disabled", "");
  });

  it("shows quality percentage for lossy formats", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("renders aspect ratio lock button", () => {
    render(<ImageResizerRoute />);
    const lockBtn = screen.getByTestId("aspect-lock");
    expect(lockBtn).toBeInTheDocument();
  });

  it("shows live preview panel", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Live Preview")).toBeInTheDocument();
  });

  it("displays dimension badge in preview header", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("1920 x 1080")).toBeInTheDocument();
  });

  it("shows placeholder when no image is selected", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Upload an image to see preview")).toBeInTheDocument();
  });

  it("shows processing queue section", () => {
    render(<ImageResizerRoute />);
    expect(screen.getByText("Processing Queue")).toBeInTheDocument();
  });

  it("renders file input as not multiple in single mode", () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).not.toHaveAttribute("multiple");
  });

  it("renders file input as multiple in batch mode", async () => {
    const user = userEvent.setup();
    render(<ImageResizerRoute />);
    await user.click(screen.getByRole("tab", { name: "Batch" }));
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("multiple");
  });

  it("adds valid file to queue", async () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
      expect(screen.getByText("1 File")).toBeInTheDocument();
    });
  });

  it("enables resize button after file upload", async () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const button = screen.getByText("Resize & Download").closest("button");
      expect(button).not.toBeDisabled();
    });
  });

  it("handles drop event with valid file", async () => {
    render(<ImageResizerRoute />);
    const dropTarget = screen.getByText("Drag and drop images here");
    const file = new File(["data"], "drop.png", { type: "image/png" });
    fireEvent.drop(dropTarget, { dataTransfer: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("drop.png")).toBeInTheDocument();
    });
  });

  it("removes item from queue when close button is clicked", async () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "removable.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("removable.png")).toBeInTheDocument();
    });
    const removeBtn = screen.getByTitle("Remove");
    fireEvent.click(removeBtn);
    expect(screen.queryByText("removable.png")).not.toBeInTheDocument();
    expect(screen.getByText("0 Files")).toBeInTheDocument();
  });

  it("handles dragover styling", () => {
    render(<ImageResizerRoute />);
    const dropTarget = screen.getByText("Drag and drop images here");
    fireEvent.dragOver(dropTarget);
    // Should not throw
    fireEvent.dragLeave(dropTarget);
  });

  it("switches to batch mode and keeps queue trimmed in single", async () => {
    const user = userEvent.setup();
    render(<ImageResizerRoute />);
    // Switch to batch mode first
    await user.click(screen.getByRole("tab", { name: "Batch" }));

    const input = screen.getByTestId("file-input");
    const file1 = new File(["data1"], "a.png", { type: "image/png" });
    const file2 = new File(["data2"], "b.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(screen.getByText("2 Files")).toBeInTheDocument();
    });

    // Switch back to single mode - queue should be trimmed to 1
    await user.click(screen.getByRole("tab", { name: "Single" }));
    await waitFor(() => {
      expect(screen.getByText("1 File")).toBeInTheDocument();
    });
  });

  it("triggers resize and download flow", async () => {
    render(<ImageResizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "resize-me.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("resize-me.png")).toBeInTheDocument();
    });

    const resizeBtn = screen.getByText("Resize & Download");
    await act(async () => {
      fireEvent.click(resizeBtn);
    });

    // Should process without error
    await waitFor(() => {
      // After resize, download should be triggered (downloadBlob is mocked)
      expect(screen.getByText("resize-me.png")).toBeInTheDocument();
    });
  });

  it("handles quality slider change for lossy formats", () => {
    render(<ImageResizerRoute />);
    // Radix Slider renders with role="slider" and uses aria-valuenow
    const slider = screen.getByRole("slider");
    // Fire keyboard event to change the value
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    // Slider decrements by step=1, so 85 -> 84
    expect(screen.getByText("84%")).toBeInTheDocument();
  });

  it("aspect ratio lock button is present and toggleable", () => {
    render(<ImageResizerRoute />);
    const lockBtn = screen.getByTestId("aspect-lock");
    expect(lockBtn).toBeInTheDocument();

    // Click to toggle lock state
    fireEvent.click(lockBtn);
    // Click again to toggle back
    fireEvent.click(lockBtn);
    // Should not throw
  });

  it("uploads multiple files in batch mode", async () => {
    const user = userEvent.setup();
    render(<ImageResizerRoute />);
    await user.click(screen.getByRole("tab", { name: "Batch" }));

    const input = screen.getByTestId("file-input");
    const file1 = new File(["data1"], "batch1.png", { type: "image/png" });
    const file2 = new File(["data2"], "batch2.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(screen.getByText("2 Files")).toBeInTheDocument();
      expect(screen.getByText("batch1.png")).toBeInTheDocument();
      expect(screen.getByText("batch2.png")).toBeInTheDocument();
    });
  });
});
