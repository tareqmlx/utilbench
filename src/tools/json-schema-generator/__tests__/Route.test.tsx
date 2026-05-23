import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JsonSchemaGeneratorRoute from "../Route";

describe("JsonSchemaGeneratorRoute", () => {
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
    URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function getInput() {
    return screen.getByPlaceholderText(/id.*name.*John Doe/) as HTMLTextAreaElement;
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  it("renders empty output placeholder", () => {
    render(<JsonSchemaGeneratorRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.getByText(/will appear here as you type/)).toBeInTheDocument();
  });

  it("generates schema from valid JSON input", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"id": 1, "name": "John"}');

    expect(screen.getByText(/"type": "object"/)).toBeInTheDocument();
    expect(screen.getByText(/draft-07/)).toBeInTheDocument();
  });

  it("shows error banner for invalid JSON", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput("not json at all");

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("clears error when input becomes valid", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput("invalid");
    expect(screen.getByText(/Unexpected token/i)).toBeInTheDocument();

    setInput('{"a": 1}');
    expect(screen.queryByText(/Unexpected token/i)).not.toBeInTheDocument();
  });

  it("clear button resets everything", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"a": 1}');

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    expect(getInput()).toHaveValue("");
    expect(screen.getByText(/will appear here as you type/)).toBeInTheDocument();
  });

  it("copy calls clipboard API with output", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"id": 1}');

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    expect(clipboardMock.writeText).toHaveBeenCalledWith(expect.stringContaining('"$schema"'));
  });

  it("shows Copied! feedback after copy", async () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"id": 1}');

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("download creates and revokes blob URL", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"id": 1}');

    fireEvent.click(screen.getByRole("button", { name: /Download/ }));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("download button is disabled when no output", () => {
    render(<JsonSchemaGeneratorRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    const btn = screen.getByRole("button", { name: /Download/ });
    expect(btn).toBeDisabled();
  });

  it("toggling 'required' checkbox affects output", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"name": "Alice"}');

    expect(screen.getByText(/"required"/)).toBeInTheDocument();

    const checkbox = screen.getByRole("switch", { name: /required/ });
    fireEvent.click(checkbox);

    expect(screen.queryByText(/"required"/)).not.toBeInTheDocument();
  });

  it("toggling 'includeTitle' checkbox adds title to output", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"firstName": "Alice"}');

    expect(screen.queryByText(/"GeneratedSchema"/)).not.toBeInTheDocument();

    const checkbox = screen.getByRole("switch", { name: /Title/ });
    fireEvent.click(checkbox);

    expect(screen.getByText(/"GeneratedSchema"/)).toBeInTheDocument();
  });

  it("toggling 'inferFormats' checkbox removes formats", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"email": "user@example.com"}');

    expect(screen.getByText(/"format": "email"/)).toBeInTheDocument();

    const checkbox = screen.getByRole("switch", { name: /formats/ });
    fireEvent.click(checkbox);

    expect(screen.queryByText(/"format": "email"/)).not.toBeInTheDocument();
  });

  it("empty input clears output and error", () => {
    render(<JsonSchemaGeneratorRoute />);
    setInput('{"a": 1}');
    expect(screen.getByText(/"type": "object"/)).toBeInTheDocument();

    setInput("");
    expect(screen.getByText(/will appear here as you type/)).toBeInTheDocument();
  });
});
