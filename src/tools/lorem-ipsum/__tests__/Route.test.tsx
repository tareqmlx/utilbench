import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoremIpsumRoute from "../Route";

describe("LoremIpsumRoute", () => {
  const clipboardMock = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  };

  beforeEach(() => {
    localStorage.removeItem("utilbench:prefs:lorem-ipsum");
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

  function getOutputArea() {
    return screen.getByTestId("output-area");
  }

  it("renders UI elements", () => {
    render(<LoremIpsumRoute />);
    expect(screen.getByText("Paragraphs")).toBeInTheDocument();
    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.getByText("Bytes")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
    expect(screen.getByLabelText(/Start with/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Add HTML tags/)).toBeInTheDocument();
  });

  it("generates text on initial render", () => {
    render(<LoremIpsumRoute />);
    const outputArea = getOutputArea();
    expect(outputArea.textContent).toBeTruthy();
    expect(outputArea.textContent?.length).toBeGreaterThan(0);
  });

  it("initial output starts with Lorem ipsum", () => {
    render(<LoremIpsumRoute />);
    const outputArea = getOutputArea();
    expect(outputArea.textContent).toMatch(/^Lorem ipsum dolor sit amet/);
  });

  it("switching tabs changes generation mode", async () => {
    const user = userEvent.setup();
    render(<LoremIpsumRoute />);

    const initialOutput = getOutputArea().textContent;

    // Switch to Words mode
    await user.click(screen.getByText("Words"));
    const wordsOutput = getOutputArea().textContent;

    // Output should change since mode and default amount changed
    expect(wordsOutput).toBeTruthy();
    expect(wordsOutput).not.toBe(initialOutput);
  });

  it("changing amount regenerates text", () => {
    render(<LoremIpsumRoute />);
    const initialOutput = getOutputArea().textContent;

    const amountInput = screen.getByLabelText("Amount");
    fireEvent.change(amountInput, { target: { value: "5" } });

    const newOutput = getOutputArea().textContent;
    expect(newOutput).toBeTruthy();
    expect(newOutput).not.toBe(initialOutput);
  });

  it("toggling 'Start with Lorem ipsum' affects output", async () => {
    const user = userEvent.setup();
    render(<LoremIpsumRoute />);

    const outputBefore = getOutputArea().textContent;
    expect(outputBefore).toMatch(/^Lorem ipsum/);

    // Toggle off the "Start with Lorem ipsum" switch
    const loremSwitch = screen.getByLabelText(/Start with/);
    await user.click(loremSwitch);

    const outputAfter = getOutputArea().textContent;
    expect(outputAfter).toBeTruthy();
    expect(outputAfter).not.toMatch(/^Lorem ipsum/);
  });

  it("toggling 'Add HTML tags' adds <p> tags to output", async () => {
    const user = userEvent.setup();
    render(<LoremIpsumRoute />);

    // Initially no HTML tags
    const outputBefore = getOutputArea().textContent;
    expect(outputBefore).not.toContain("<p>");

    // Toggle on HTML tags
    const htmlSwitch = screen.getByLabelText(/Add HTML tags/);
    await user.click(htmlSwitch);

    const outputAfter = getOutputArea().textContent;
    expect(outputAfter).toContain("<p>");
    expect(outputAfter).toContain("</p>");
  });

  it("copy button calls clipboard API", async () => {
    render(<LoremIpsumRoute />);

    const copyButton = screen.getByRole("button", { name: /Copy to Clipboard/ });
    fireEvent.click(copyButton);

    // Allow the async clipboard.writeText promise to resolve
    await screen.findByText("Copied!");

    expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
    // Should have been called with the generated output text
    const calledWith = (clipboardMock.writeText.mock.calls[0] as string[])[0] as string;
    expect(calledWith.length).toBeGreaterThan(0);
    expect(calledWith).toMatch(/Lorem ipsum/);
  });

  it("shows 'Copied!' feedback after copy", async () => {
    render(<LoremIpsumRoute />);

    const copyButton = screen.getByRole("button", { name: /Copy to Clipboard/ });
    fireEvent.click(copyButton);

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("amount input defaults to 3 for paragraphs mode", () => {
    render(<LoremIpsumRoute />);
    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(amountInput.value).toBe("3");
  });

  it("switching to words mode updates amount default", async () => {
    const user = userEvent.setup();
    render(<LoremIpsumRoute />);

    await user.click(screen.getByText("Words"));
    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(amountInput.value).toBe("50");
  });

  it("switching to bytes mode updates amount default", async () => {
    const user = userEvent.setup();
    render(<LoremIpsumRoute />);

    await user.click(screen.getByText("Bytes"));
    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(amountInput.value).toBe("500");
  });
});
