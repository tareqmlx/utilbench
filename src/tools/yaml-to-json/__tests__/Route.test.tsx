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
    localStorage.removeItem("utilbench:prefs:yaml-to-json");
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
    return screen.getByLabelText(/yaml input/i) as HTMLTextAreaElement;
  }

  function getCodeText(): string {
    const pre = document.querySelector("pre > code");
    return pre?.textContent ?? "";
  }

  it("renders", () => {
    render(<YamlToJsonRoute />);
    expect(getTextarea()).toBeInTheDocument();
  });

  it("shows placeholder initially", () => {
    render(<YamlToJsonRoute />);
    expect(document.body.textContent).toMatch(/waiting for input/i);
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

  it("auto-converts input to JSON output", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "name: test\ncount: 5" } });
    const parsed = JSON.parse(getCodeText());
    expect(parsed).toEqual({ name: "test", count: 5 });
  });

  it("pretty print toggle reformats existing output", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "a: 1\nb: 2" } });

    const codeBefore = getCodeText();
    expect(codeBefore).toContain("\n");

    fireEvent.click(screen.getByLabelText(/pretty print/i));
    const codeAfter = getCodeText();
    expect(codeAfter).not.toContain("\n");
  });

  it("delete clears input, output, and error", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });

    fireEvent.click(screen.getByLabelText(/clear input/i));

    expect(getTextarea().value).toBe("");
    expect(document.body.textContent).toMatch(/waiting for input/i);
  });

  it("copy triggers clipboard writeText", async () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalled();
    });
  });

  it("copy shows Copied! feedback", async () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();
    });
  });

  it("download triggers blob creation", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });

    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: value" } });

    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("malformed YAML shows error banner", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: [invalid: {{" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("error clears on next successful convert", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), { target: { value: "key: [invalid: {{" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copy/download disabled until output exists", () => {
    render(<YamlToJsonRoute />);
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /download/i })).toBeDisabled();

    fireEvent.change(getTextarea(), { target: { value: "key: value" } });
    expect(screen.getByRole("button", { name: /^copy$/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /download/i })).not.toBeDisabled();
  });

  it("multi-doc YAML emits array", () => {
    render(<YamlToJsonRoute />);
    fireEvent.change(getTextarea(), {
      target: { value: "a: 1\n---\nb: 2" },
    });
    const parsed = JSON.parse(getCodeText());
    expect(parsed).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("pretty print disabled produces compact JSON", () => {
    render(<YamlToJsonRoute />);
    // Toggle off pretty print first (default true)
    fireEvent.click(screen.getByLabelText(/pretty print/i));
    fireEvent.change(getTextarea(), { target: { value: "a: 1\nb: 2" } });
    const code = getCodeText();
    expect(code).not.toContain("\n");
    expect(JSON.parse(code)).toEqual({ a: 1, b: 2 });
  });
});
