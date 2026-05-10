import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import FaviconGeneratorRoute from "../Route";

// Radix Select uses pointer capture APIs not available in jsdom
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
});

vi.mock("../favicon", async () => {
  const actual = await vi.importActual("../favicon");
  return {
    ...actual,
    renderPreview: vi.fn().mockResolvedValue("data:image/png;base64,mock"),
    generateFaviconPack: vi.fn().mockResolvedValue(new Blob(["mock"], { type: "application/zip" })),
  };
});

afterEach(() => {
  cleanup();
});

describe("FaviconGeneratorRoute", () => {
  it("renders without crashing", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByText("Drag & Drop Image")).toBeInTheDocument();
  });

  it("shows upload zone initially", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByText("Drag & Drop Image")).toBeInTheDocument();
    expect(screen.getByText("Select File")).toBeInTheDocument();
  });

  it("has a file input element", () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/svg+xml");
  });

  it("rejects invalid file types", () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "test.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
  });

  it("rejects oversized files", () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const bigData = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/File too large/)).toBeInTheDocument();
  });

  it("shows file info after valid upload", () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "icon.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("icon.png")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("removes file when remove button is clicked", () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "icon.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByText("Remove"));
    expect(screen.queryByText("icon.png")).not.toBeInTheDocument();
    expect(screen.getByText("Drag & Drop Image")).toBeInTheDocument();
  });

  it("has download button disabled without image", () => {
    render(<FaviconGeneratorRoute />);
    const button = screen.getByText("Download Favicon Pack").closest("button");
    expect(button).toBeDisabled();
  });

  it("renders corner rounding buttons", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Soft")).toBeInTheDocument();
    expect(screen.getByText("Circle")).toBeInTheDocument();
  });

  it("toggles corner rounding selection", () => {
    render(<FaviconGeneratorRoute />);
    const softBtn = screen.getByRole("button", { name: "Soft" });
    fireEvent.click(softBtn);
    expect(softBtn.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "None" }).className).not.toContain("bg-primary");
  });

  it("renders export format select with all options", async () => {
    render(<FaviconGeneratorRoute />);
    // Radix Select shows the current value via a trigger with role="combobox"
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Recommended Pack (ICO, PNG, SVG)");

    // Open the select to verify options (Radix listens to pointerdown)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(await screen.findByRole("option", { name: /Legacy ICO only/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Modern PNG\/SVG only/ })).toBeInTheDocument();
  });

  it("updates dimension badges when format changes to ico-only", async () => {
    render(<FaviconGeneratorRoute />);

    // Default shows all 8 sizes
    expect(screen.getByText("512x512")).toBeInTheDocument();

    // Open Radix Select and pick "Legacy ICO only"
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const option = await screen.findByRole("option", { name: /Legacy ICO only/ });
    fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
    fireEvent.click(option);

    expect(screen.queryByText("512x512")).not.toBeInTheDocument();
    expect(screen.getByText("16x16")).toBeInTheDocument();
    expect(screen.getByText("32x32")).toBeInTheDocument();
    expect(screen.getByText("48x48")).toBeInTheDocument();
  });

  it("renders preview placeholders", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByText("Browser Tab (16x16)")).toBeInTheDocument();
    expect(screen.getByText("iOS Icon (180x180)")).toBeInTheDocument();
    expect(screen.getByText("Android (192x192)")).toBeInTheDocument();
  });

  it("renders background color swatches", () => {
    render(<FaviconGeneratorRoute />);
    const whiteBtn = screen.getByLabelText("Background color #ffffff");
    const blackBtn = screen.getByLabelText("Background color #000000");
    expect(whiteBtn).toBeInTheDocument();
    expect(blackBtn).toBeInTheDocument();
  });

  it("selects background color on swatch click", () => {
    render(<FaviconGeneratorRoute />);
    const blackBtn = screen.getByLabelText("Background color #000000");
    fireEvent.click(blackBtn);
    expect(blackBtn.className).toContain("ring-2");
  });

  it("enables download button after valid file upload", async () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "icon.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(
      () => {
        const button = screen.getByText("Download Favicon Pack").closest("button");
        expect(button).not.toBeDisabled();
      },
      { timeout: 3000 },
    );
  });

  it("has custom color picker", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByLabelText("Custom color picker")).toBeInTheDocument();
  });

  it("handles drag events without crashing", () => {
    render(<FaviconGeneratorRoute />);
    const dropZone = screen.getByText("Drag & Drop Image").closest("div") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    // Should not throw
  });

  it("renders upload zone", () => {
    render(<FaviconGeneratorRoute />);
    expect(screen.getByTestId("file-input")).toBeInTheDocument();
  });

  it("defaults to none for corner rounding", () => {
    render(<FaviconGeneratorRoute />);
    const noneBtn = screen.getByRole("button", { name: "None" });
    expect(noneBtn.className).toContain("bg-primary");
  });

  it("circle rounding gets active state when clicked", () => {
    render(<FaviconGeneratorRoute />);
    const circleBtn = screen.getByRole("button", { name: "Circle" });
    fireEvent.click(circleBtn);
    expect(circleBtn.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "None" }).className).not.toContain("bg-primary");
  });

  it("triggers download flow after upload and click", async () => {
    render(<FaviconGeneratorRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "dl.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(
      () => {
        const button = screen.getByText("Download Favicon Pack").closest("button");
        expect(button).not.toBeDisabled();
      },
      { timeout: 3000 },
    );

    const downloadBtn = screen
      .getByText("Download Favicon Pack")
      .closest("button") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(downloadBtn);
    });
  });
});
