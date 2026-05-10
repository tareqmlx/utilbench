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
    return screen.getByPlaceholderText(/Paste or type your text here/) as HTMLTextAreaElement;
  }

  function getOutput() {
    return screen.getByPlaceholderText(/Converted text will appear here/) as HTMLTextAreaElement;
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

  it("UPPERCASE button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(screen.getByRole("button", { name: "UPPERCASE" }));
    expect(getOutput()).toHaveValue("HELLO WORLD");
  });

  it("lowercase button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("HELLO WORLD");
    fireEvent.click(screen.getByRole("button", { name: "lowercase" }));
    expect(getOutput()).toHaveValue("hello world");
  });

  it("Title Case button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(screen.getByRole("button", { name: "Title Case" }));
    expect(getOutput()).toHaveValue("Hello World");
  });

  it("Sentence case button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world. foo bar");
    fireEvent.click(screen.getByRole("button", { name: "Sentence case" }));
    expect(getOutput()).toHaveValue("Hello world. Foo bar");
  });

  it("camelCase button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(screen.getByRole("button", { name: "camelCase" }));
    expect(getOutput()).toHaveValue("helloWorld");
  });

  it("snake_case button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(screen.getByRole("button", { name: "snake_case" }));
    expect(getOutput()).toHaveValue("hello_world");
  });

  it("kebab-case button converts correctly", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello world");
    fireEvent.click(screen.getByRole("button", { name: "kebab-case" }));
    expect(getOutput()).toHaveValue("hello-world");
  });

  it("selected button gets active styling", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "UPPERCASE" });
    fireEvent.click(btn);
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).toContain("text-primary-foreground");
  });

  it("output updates live when input changes with a case selected", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    setInput("hello");
    fireEvent.click(screen.getByRole("button", { name: "UPPERCASE" }));
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
    fireEvent.click(screen.getByRole("button", { name: "UPPERCASE" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy Text/ }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith("HELLO");
  });

  it("copy button is disabled when output is empty", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    const copyBtn = screen.getByRole("button", { name: /Copy Text/ });
    expect(copyBtn).toBeDisabled();
  });

  it("empty input produces empty output", () => {
    render(
      <MemoryRouter>
        <CaseConverterRoute />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "UPPERCASE" }));
    expect(getOutput()).toHaveValue("");
  });
});
