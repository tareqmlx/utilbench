import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CsvToJsonRoute from "../Route";

// Radix Select uses pointer capture APIs not available in jsdom
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
});

describe("CsvToJsonRoute", () => {
  const clipboardMock = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardMock,
      writable: true,
      configurable: true,
    });
    clipboardMock.writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  function getInput() {
    return screen.getByRole("textbox") as HTMLTextAreaElement;
  }

  function getOutput() {
    return screen.getByRole("code");
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  it("renders without crashing", () => {
    render(<CsvToJsonRoute />);
    expect(getInput()).toBeInTheDocument();
  });

  it("shows default output on load", () => {
    render(<CsvToJsonRoute />);
    const output = JSON.parse(getOutput().textContent ?? "");
    expect(output).toEqual([
      { Column1: "Value1", Column2: "Value2", Column3: "Value3" },
      { Column1: "Value4", Column2: "Value5", Column3: "Value6" },
    ]);
  });

  it("live-converts on input change", () => {
    render(<CsvToJsonRoute />);
    setInput("a,b\n1,2");
    const output = JSON.parse(getOutput().textContent ?? "");
    expect(output).toEqual([{ a: "1", b: "2" }]);
  });

  it("toggles header row and re-converts", () => {
    render(<CsvToJsonRoute />);
    setInput("a,b\n1,2");

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    const output = JSON.parse(getOutput().textContent ?? "");
    expect(output).toEqual([
      { "0": "a", "1": "b" },
      { "0": "1", "1": "2" },
    ]);
  });

  it("changes delimiter and re-converts", async () => {
    render(<CsvToJsonRoute />);
    setInput("a;b\n1;2");

    // Open Radix Select by dispatching pointerdown (Radix listens to this)
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const option = await screen.findByRole("option", { name: /Semicolon/ });
    // Radix Select items respond to pointerUp + click for selection
    fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
    fireEvent.click(option);

    const output = JSON.parse(getOutput().textContent ?? "");
    expect(output).toEqual([{ a: "1", b: "2" }]);
  });

  it("clears all state", () => {
    render(<CsvToJsonRoute />);
    setInput("a,b\n1,2");

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    expect(getInput()).toHaveValue("");
    expect(getOutput().textContent).toBe("");
  });

  it("copies output to clipboard", () => {
    render(<CsvToJsonRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(clipboardMock.writeText).toHaveBeenCalled();
  });

  it("shows Copied! feedback after copying", async () => {
    render(<CsvToJsonRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("downloads output as JSON file", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis, "URL", {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
      configurable: true,
    });

    render(<CsvToJsonRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("empty input clears output silently", () => {
    render(<CsvToJsonRoute />);
    setInput("");
    expect(getOutput().textContent).toBe("");
  });

  it("handles file drop", () => {
    const csvContent = "x,y\n1,2";
    const file = new File([csvContent], "test.csv", { type: "text/csv" });

    const mockReadAsText = vi.fn();
    const OriginalFileReader = globalThis.FileReader;
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        onload: (() => void) | null = null;
        readAsText(f: File) {
          mockReadAsText(f);
          this.result = csvContent;
          this.onload?.();
        }
      },
    );

    render(<CsvToJsonRoute />);
    const dropzone = getInput().closest("[class*=relative]") as HTMLElement;

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    expect(mockReadAsText).toHaveBeenCalledWith(file);
    expect(getInput()).toHaveValue(csvContent);

    vi.stubGlobal("FileReader", OriginalFileReader);
  });
});
