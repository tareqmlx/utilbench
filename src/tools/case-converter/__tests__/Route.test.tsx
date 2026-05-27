import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CaseConverterRoute from "../Route";

describe("CaseConverterRoute", () => {
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
    return screen.getByPlaceholderText(/paste or type text/i) as HTMLTextAreaElement;
  }

  function getOutput() {
    return screen.getByPlaceholderText(/result/i) as HTMLTextAreaElement;
  }

  function getCaseChip(name: string) {
    return screen.getByRole("button", { name });
  }

  function getCopyButton() {
    return screen.getByRole("button", { name: /copy/i });
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    expect(getInput()).toBeInTheDocument();
  });

  it("input textarea accepts text", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    expect(getInput()).toHaveValue("hello world");
  });

  it("UPPERCASE chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(getCaseChip("UPPERCASE"));
    expect(getOutput()).toHaveValue("HELLO WORLD");
  });

  it("lowercase chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("HELLO WORLD");
    fireEvent.click(getCaseChip("lowercase"));
    expect(getOutput()).toHaveValue("hello world");
  });

  it("Title Case chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(getCaseChip("Title Case"));
    expect(getOutput()).toHaveValue("Hello World");
  });

  it("Sentence case chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world. foo bar");
    fireEvent.click(getCaseChip("Sentence case"));
    expect(getOutput()).toHaveValue("Hello world. Foo bar");
  });

  it("camelCase chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(getCaseChip("camelCase"));
    expect(getOutput()).toHaveValue("helloWorld");
  });

  it("snake_case chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(getCaseChip("snake_case"));
    expect(getOutput()).toHaveValue("hello_world");
  });

  it("kebab-case chip converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(getCaseChip("kebab-case"));
    expect(getOutput()).toHaveValue("hello-world");
  });

  it("selected chip reflects active state via aria-pressed", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    const chip = getCaseChip("UPPERCASE");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.className).toContain("on");
  });

  it("output updates live when input changes with a case selected", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello");
    fireEvent.click(getCaseChip("UPPERCASE"));
    expect(getOutput()).toHaveValue("HELLO");

    setInput("hello world");
    expect(getOutput()).toHaveValue("HELLO WORLD");
  });

  it("copy button calls clipboard.writeText with output", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello");
    fireEvent.click(getCaseChip("UPPERCASE"));
    fireEvent.click(getCopyButton());
    expect(clipboardMock.writeText).toHaveBeenCalledWith("HELLO");
  });

  it("copy button is disabled when output is empty", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    expect(getCopyButton()).toBeDisabled();
  });

  it("empty input produces empty output", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    fireEvent.click(getCaseChip("UPPERCASE"));
    expect(getOutput()).toHaveValue("");
  });

  it("Clear button empties input", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello");
    fireEvent.click(getCaseChip("UPPERCASE"));
    fireEvent.click(screen.getByRole("button", { name: /clear input/i }));
    expect(getInput()).toHaveValue("");
    expect(getOutput()).toHaveValue("");
  });
});
