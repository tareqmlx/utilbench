import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsonFormatterRoute from "../Route";

describe("JsonFormatterRoute", () => {
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
    clipboardMock.readText.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
  });

  function getInput() {
    return screen.getByPlaceholderText(/Paste your raw JSON here/) as HTMLTextAreaElement;
  }

  function getOutput() {
    return screen.getByPlaceholderText(
      /Your beautified JSON will appear here/,
    ) as HTMLTextAreaElement;
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  it("renders without crashing", () => {
    render(<JsonFormatterRoute />);
    expect(getInput()).toBeInTheDocument();
  });

  it("typing updates input textarea", () => {
    render(<JsonFormatterRoute />);
    setInput("hello");
    expect(getInput()).toHaveValue("hello");
  });

  it("formats valid JSON with indentation", () => {
    render(<JsonFormatterRoute />);
    setInput('{"a":1}');

    fireEvent.click(screen.getByRole("button", { name: /Format JSON/ }));

    expect(getOutput()).toHaveValue(JSON.stringify({ a: 1 }, null, 2));
  });

  it("formats JSONC input (comments and trailing commas)", async () => {
    render(<JsonFormatterRoute />);

    const jsonc = '{\n  // comment\n  "a": 1,\n  "b": 2,\n}';
    clipboardMock.readText.mockResolvedValueOnce(jsonc);

    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));

    await waitFor(() => {
      expect(getInput()).toHaveValue(jsonc);
    });

    fireEvent.click(screen.getByRole("button", { name: /Format JSON/ }));

    expect(getOutput()).toHaveValue(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it("minifies formatted JSON to compact single-line", async () => {
    render(<JsonFormatterRoute />);

    const jsonInput = '{\n  "name": "test",\n  "value": 42\n}';
    clipboardMock.readText.mockResolvedValueOnce(jsonInput);

    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));

    await waitFor(() => {
      expect(getInput()).toHaveValue(jsonInput);
    });

    fireEvent.click(screen.getByRole("button", { name: /Minify/ }));

    expect(getOutput()).toHaveValue('{"name":"test","value":42}');
  });

  it("shows error banner for invalid JSON", () => {
    render(<JsonFormatterRoute />);
    setInput("not json");

    expect(screen.getByText(/at line/)).toBeInTheDocument();
  });

  it("clears error when input becomes valid", () => {
    render(<JsonFormatterRoute />);

    setInput("invalid");
    expect(screen.getByText(/at line/)).toBeInTheDocument();

    setInput('{"a":1}');
    expect(screen.queryByText(/at line/)).not.toBeInTheDocument();
  });

  it("clear resets all fields", () => {
    render(<JsonFormatterRoute />);

    setInput('{"a":1}');
    fireEvent.click(screen.getByRole("button", { name: /Format JSON/ }));
    expect(getOutput()).not.toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    expect(getInput()).toHaveValue("");
    expect(getOutput()).toHaveValue("");
    expect(screen.queryByText(/at line/)).not.toBeInTheDocument();
  });

  it("copy calls clipboard.writeText with output", () => {
    render(<JsonFormatterRoute />);

    setInput('{"a":1}');
    fireEvent.click(screen.getByRole("button", { name: /Format JSON/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    expect(clipboardMock.writeText).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
  });

  it("paste reads clipboard and populates input", async () => {
    render(<JsonFormatterRoute />);

    clipboardMock.readText.mockResolvedValueOnce('{"hello":"world"}');

    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));

    await waitFor(() => {
      expect(getInput()).toHaveValue('{"hello":"world"}');
    });
  });

  it("format is a no-op on empty input", () => {
    render(<JsonFormatterRoute />);

    fireEvent.click(screen.getByRole("button", { name: /Format JSON/ }));

    expect(getOutput()).toHaveValue("");
  });

  it("minify is a no-op on empty input", () => {
    render(<JsonFormatterRoute />);

    fireEvent.click(screen.getByRole("button", { name: /Minify/ }));

    expect(getOutput()).toHaveValue("");
  });
});
