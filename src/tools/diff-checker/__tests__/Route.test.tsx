import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiffCheckerRoute from "../Route";

vi.mock("../../../workers", () => ({
  workerPool: {
    dispatch: vi.fn(),
  },
}));

import { workerPool } from "../../../workers";

const mockDispatch = vi.mocked(workerPool.dispatch);

function renderRoute() {
  return render(
    <MemoryRouter>
      <DiffCheckerRoute />
    </MemoryRouter>,
  );
}

function getOriginalTextarea() {
  return screen.getByPlaceholderText("Paste original text here...") as HTMLTextAreaElement;
}

function getModifiedTextarea() {
  return screen.getByPlaceholderText("Paste modified text here...") as HTMLTextAreaElement;
}

function getFindButton() {
  return screen.getByRole("button", { name: /Find Differences/i });
}

function makeDiffResult(original: string, modified: string) {
  const { diffLines } = require("diff");
  const { createTwoFilesPatch } = require("diff");
  const changes = diffLines(original, modified);
  const unifiedPatch = createTwoFilesPatch("Original", "Modified", original, modified);
  return { changes, unifiedPatch };
}

describe("DiffCheckerRoute", () => {
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

  it("renders textareas", () => {
    renderRoute();
    expect(getOriginalTextarea()).toBeInTheDocument();
    expect(getModifiedTextarea()).toBeInTheDocument();
  });

  it("textareas are editable", () => {
    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "hello" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "world" } });
    expect(getOriginalTextarea().value).toBe("hello");
    expect(getModifiedTextarea().value).toBe("world");
  });

  it("clear original resets textarea and clears result", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a\n", "b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.queryByText("Computing differences...")).not.toBeInTheDocument();
    });

    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    fireEvent.click(clearButtons[0] as HTMLElement);

    expect(getOriginalTextarea().value).toBe("");
    expect(
      screen.getByText("Enter text in both panels and click Find Differences"),
    ).toBeInTheDocument();
  });

  it("clear modified resets textarea and clears result", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a\n", "b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.queryByText("Computing differences...")).not.toBeInTheDocument();
    });

    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    fireEvent.click(clearButtons[1] as HTMLElement);

    expect(getModifiedTextarea().value).toBe("");
    expect(
      screen.getByText("Enter text in both panels and click Find Differences"),
    ).toBeInTheDocument();
  });

  it("shows 'No differences found' for identical text", async () => {
    const text = "same line\n";
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult(text, text)),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: text } });
    fireEvent.change(getModifiedTextarea(), { target: { value: text } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.getByText("No differences found")).toBeInTheDocument();
    });
  });

  it("shows diff output with added/removed lines", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("old line\n", "new line\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "old line\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "new line\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.getByText("old line")).toBeInTheDocument();
      expect(screen.getByText("new line")).toBeInTheDocument();
    });
  });

  it("side-by-side view shows Original and Modified headers", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a\n", "b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      const headers = screen.getAllByText("Original");
      expect(headers.length).toBeGreaterThan(0);
      expect(screen.getByText("Modified")).toBeInTheDocument();
    });
  });

  it("inline view tab switches to single-panel display", async () => {
    const user = userEvent.setup();
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a\n", "b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.queryByText("Computing differences...")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Inline View" }));

    // Inline view should not have the side-by-side "Original"/"Modified" headers
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });

  it("unified view tab shows unified diff format", async () => {
    const user = userEvent.setup();
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a\n", "b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.queryByText("Computing differences...")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Unified" }));

    await waitFor(() => {
      expect(screen.getByText(/--- Original/)).toBeInTheDocument();
    });
  });

  it("ignore case makes 'Hello' vs 'hello' show no differences", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("hello\n", "hello\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "Hello\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "hello\n" } });
    fireEvent.click(screen.getByLabelText("Ignore case"));
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.getByText("No differences found")).toBeInTheDocument();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      "compute-diff",
      expect.objectContaining({ ignoreCase: true }),
    );
  });

  it("copy result calls clipboard.writeText with unified patch", async () => {
    const result = makeDiffResult("a\n", "b\n");
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(result),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "b\n" } });
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(screen.queryByText("Computing differences...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Copy Result/i }));

    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalledWith(result.unifiedPatch);
    });
  });

  it("does nothing on Find Differences with empty inputs", () => {
    mockDispatch.mockClear();
    renderRoute();
    fireEvent.click(getFindButton());
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("view mode tabs have correct active/inactive styling", async () => {
    const user = userEvent.setup();
    renderRoute();
    const sideBySide = screen.getByRole("tab", { name: "Side-by-Side" });
    const inline = screen.getByRole("tab", { name: "Inline View" });

    expect(sideBySide).toHaveAttribute("data-state", "active");
    expect(inline).toHaveAttribute("data-state", "inactive");

    await user.click(inline);
    expect(inline).toHaveAttribute("data-state", "active");
    expect(sideBySide).toHaveAttribute("data-state", "inactive");
  });

  it("ignore-whitespace switch is inline alongside ignore-case", () => {
    renderRoute();
    expect(screen.getByLabelText("Ignore case")).toBeInTheDocument();
    expect(screen.getByLabelText("Ignore whitespace")).toBeInTheDocument();
  });

  it("ignore whitespace forwards ignoreWhitespace flag to worker", async () => {
    mockDispatch.mockReturnValue({
      promise: Promise.resolve(makeDiffResult("a b\n", "a  b\n")),
      cancel: vi.fn(),
    });

    renderRoute();
    fireEvent.change(getOriginalTextarea(), { target: { value: "a b\n" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "a  b\n" } });
    fireEvent.click(screen.getByLabelText("Ignore whitespace"));
    fireEvent.click(getFindButton());

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        "compute-diff",
        expect.objectContaining({ ignoreWhitespace: true }),
      );
    });
  });
});
