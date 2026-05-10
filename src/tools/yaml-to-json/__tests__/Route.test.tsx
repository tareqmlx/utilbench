import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YamlToJsonRoute from "../Route";
import { SAMPLE_YAML } from "../yaml";

describe("YamlToJsonRoute", () => {
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

  function getTextarea() {
    return screen.getByRole("textbox") as HTMLTextAreaElement;
  }

  function clickConvert() {
    fireEvent.click(screen.getByRole("button", { name: /convert to json/i }));
  }

  it("renders", () => {
    render(<YamlToJsonRoute />);
    expect(screen.getByLabelText(/yaml input/i)).toBeInTheDocument();
  });

  it("shows placeholder initially", () => {
    render(<YamlToJsonRoute />);
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument();
  });

  it("textarea accepts input", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    expect(getTextarea().value).toBe("key: value");
  });

  it("paste example populates textarea with sample", () => {
    render(<YamlToJsonRoute />);
    fireEvent.click(screen.getByRole("button", { name: /paste example/i }));
    expect(getTextarea().value).toBe(SAMPLE_YAML);
  });

  it("convert produces valid JSON output", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "name: test\ncount: 5" } });
    clickConvert();
    const code = screen.getByRole("code");
    const parsed = JSON.parse(code.textContent ?? "");
    expect(parsed).toEqual({ name: "test", count: 5 });
  });

  it("pretty print toggle reformats existing output", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "a: 1\nb: 2" } });
    clickConvert();

    const codeBefore = screen.getByRole("code").textContent ?? "";
    expect(codeBefore).toContain("\n");

    fireEvent.click(screen.getByLabelText(/pretty print/i));
    const codeAfter = screen.getByRole("code").textContent ?? "";
    expect(codeAfter).not.toContain("\n");
  });

  it("delete clears input, output, and error", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    clickConvert();

    // The clear button is an icon-only button (Trash2 icon) rendered with variant="secondary" size="icon"
    // It's the only secondary icon button in the input section
    const allButtons = screen.getAllByRole("button");
    const clearBtn = allButtons.find(
      (btn) => btn.className.includes("bg-secondary") && btn.className.includes("w-10"),
    );
    expect(clearBtn).toBeTruthy();
    if (clearBtn) fireEvent.click(clearBtn);

    expect(getTextarea().value).toBe("");
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument();
  });

  it("copy triggers clipboard writeText", async () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    clickConvert();

    fireEvent.click(screen.getByRole("button", { name: /copy$/i }));
    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalled();
    });
  });

  it("copy shows Copied! feedback", async () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    clickConvert();

    fireEvent.click(screen.getByRole("button", { name: /copy$/i }));
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });

  it("download triggers blob creation", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });

    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    clickConvert();

    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("malformed YAML shows error banner", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: [invalid: {{" } });
    clickConvert();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("error clears on next successful convert", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: [invalid: {{" } });
    clickConvert();

    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    clickConvert();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not auto-convert when typing", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument();
  });
});
