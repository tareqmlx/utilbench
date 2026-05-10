import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Base64EncoderRoute from "../Route";

describe("Base64EncoderRoute", () => {
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
    return screen.getByPlaceholderText(/Enter or paste your content here/) as HTMLTextAreaElement;
  }

  function getOutput() {
    return screen.getByPlaceholderText(/Result will appear here/) as HTMLTextAreaElement;
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    expect(getInput()).toBeInTheDocument();
  });

  it("live-encodes on input change", () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("Hello");
    expect(getOutput()).toHaveValue("SGVsbG8=");
  });

  it("encodes Unicode text", () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("\u{1F680}");
    expect(getOutput()).toHaveValue("8J+agA==");
  });

  it("decodes valid Base64 in decode mode", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: /DECODE/ }));
    setInput("SGVsbG8=");
    expect(getOutput()).toHaveValue("Hello");
  });

  it("shows error for invalid Base64 in decode mode", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: /DECODE/ }));
    setInput("!!!invalid!!!");
    expect(screen.getByText(/Invalid Base64/)).toBeInTheDocument();
    expect(getOutput()).toHaveValue("");
  });

  it("mode toggle re-converts existing input", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("Hello");
    expect(getOutput()).toHaveValue("SGVsbG8=");

    await user.click(screen.getByRole("tab", { name: /DECODE/ }));
    // "Hello" is not valid Base64 with that content, so expect error
    expect(screen.getByText(/Invalid Base64/)).toBeInTheDocument();
  });

  it("clear resets all state including errors", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: /DECODE/ }));
    setInput("!!!invalid!!!");
    expect(screen.getByText(/Invalid Base64/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    expect(getInput()).toHaveValue("");
    expect(getOutput()).toHaveValue("");
    expect(screen.queryByText(/Invalid Base64/)).not.toBeInTheDocument();
  });

  it("copy calls clipboard.writeText with output", () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("Hello");
    fireEvent.click(screen.getByRole("button", { name: /Copy Result/ }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith("SGVsbG8=");
  });

  it("shows Copied! feedback after copying", async () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("Hello");
    fireEvent.click(screen.getByRole("button", { name: /Copy Result/ }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("empty input produces no error", () => {
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    setInput("");
    expect(screen.queryByText(/Invalid Base64/)).not.toBeInTheDocument();
    expect(getOutput()).toHaveValue("");
  });

  it("updates labels based on mode", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Base64EncoderRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText("Input String")).toBeInTheDocument();
    expect(screen.getByText("Base64 Result")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /DECODE/ }));
    expect(screen.getByText("Base64 Input")).toBeInTheDocument();
    expect(screen.getByText("Decoded Text")).toBeInTheDocument();
  });
});
