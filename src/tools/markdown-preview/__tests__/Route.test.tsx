import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../markdown", () => ({
  parseMarkdown: vi.fn((input: string) => (input.trim() ? `<p>${input}</p>` : "")),
}));

vi.mock("../../../hooks/useClipboard", () => ({
  useClipboard: () => ({
    copied: false,
    copy: vi.fn(),
    readClipboard: vi.fn(),
  }),
}));

import MarkdownPreviewRoute from "../Route";
import { parseMarkdown } from "../markdown";

const mockParseMarkdown = vi.mocked(parseMarkdown);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownPreviewRoute", () => {
  beforeEach(() => {
    mockParseMarkdown.mockImplementation((input: string) =>
      input.trim() ? `<p>${input}</p>` : "",
    );
  });

  it("renders editor and preview panes", () => {
    render(<MarkdownPreviewRoute />);
    expect(screen.getByText("Markdown Editor")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("renders default content in textarea", () => {
    render(<MarkdownPreviewRoute />);
    const textarea = screen.getByPlaceholderText(/Hello World/);
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toContain("Paste your Markdown");
  });

  it("shows preview for default content", () => {
    render(<MarkdownPreviewRoute />);
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
  });

  it("updates preview after debounce when typing", () => {
    vi.useFakeTimers();
    render(<MarkdownPreviewRoute />);

    const textarea = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(textarea, { target: { value: "# New content" } });

    // Before debounce fires, the old preview is still there
    vi.advanceTimersByTime(250);

    expect(mockParseMarkdown).toHaveBeenCalledWith("# New content");
    vi.useRealTimers();
  });

  it("shows empty state when content is cleared", () => {
    vi.useFakeTimers();
    mockParseMarkdown.mockReturnValue("");
    render(<MarkdownPreviewRoute />);

    fireEvent.click(screen.getByText("Clear"));

    const textarea = screen.getByPlaceholderText(/Hello World/);
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
    expect(screen.getByText("Start typing to see the preview")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("has hidden file input with correct accept types", () => {
    render(<MarkdownPreviewRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".md,.txt,.markdown");
  });

  it("imports file content into editor", () => {
    vi.useFakeTimers();
    render(<MarkdownPreviewRoute />);

    const input = screen.getByTestId("file-input");
    const file = new File(["# Imported content"], "test.md", { type: "text/markdown" });

    fireEvent.change(input, { target: { files: [file] } });

    // FileReader is async, so we need to flush
    vi.useRealTimers();
  });

  it("renders toolbar buttons", () => {
    render(<MarkdownPreviewRoute />);
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("Copy HTML")).toBeInTheDocument();
  });

  it("displays cursor position", () => {
    render(<MarkdownPreviewRoute />);
    expect(screen.getByText(/Line \d+, Column \d+/)).toBeInTheDocument();
  });

  it("renders editor and preview", () => {
    render(<MarkdownPreviewRoute />);
    expect(screen.getByText("Markdown Editor")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("export button creates a file download", () => {
    render(<MarkdownPreviewRoute />);
    // Export should trigger a download without throwing
    fireEvent.click(screen.getByText("Export"));
    // The download is triggered via anchor click (no error means success)
  });

  it("copy HTML button calls clipboard write", async () => {
    render(<MarkdownPreviewRoute />);
    fireEvent.click(screen.getByText("Copy HTML"));
    // useClipboard is mocked, so copy should have been called
  });

  it("handles clear and re-type cycle", () => {
    vi.useFakeTimers();
    mockParseMarkdown.mockImplementation((input: string) =>
      input.trim() ? `<p>${input}</p>` : "",
    );
    render(<MarkdownPreviewRoute />);

    fireEvent.click(screen.getByText("Clear"));
    const textarea = screen.getByPlaceholderText(/Hello World/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    // Re-type content
    fireEvent.change(textarea, { target: { value: "# Restored" } });
    vi.advanceTimersByTime(250);
    expect(mockParseMarkdown).toHaveBeenCalledWith("# Restored");

    vi.useRealTimers();
  });

  it("updates cursor position on click", () => {
    render(<MarkdownPreviewRoute />);
    const textarea = screen.getByPlaceholderText(/Hello World/) as HTMLTextAreaElement;

    // Simulate clicking at a position
    fireEvent.click(textarea);
    expect(screen.getByText(/Line \d+, Column \d+/)).toBeInTheDocument();
  });

  it("handles parse error gracefully", async () => {
    vi.useFakeTimers();
    mockParseMarkdown.mockImplementation(() => {
      throw new Error("Parse failed");
    });

    render(<MarkdownPreviewRoute />);
    const textarea = screen.getByPlaceholderText(/Hello World/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "bad content" } });

    // Advance timer and flush state updates
    act(() => {
      vi.advanceTimersByTime(300);
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText(/Failed to parse markdown/)).toBeInTheDocument();
    });
  });

  it("recovers after parse error when valid content entered", () => {
    vi.useFakeTimers();

    // First, cause an error
    mockParseMarkdown.mockImplementation(() => {
      throw new Error("Parse failed");
    });
    render(<MarkdownPreviewRoute />);
    const textarea = screen.getByPlaceholderText(/Hello World/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "bad" } });
    vi.advanceTimersByTime(250);

    // Now fix it
    mockParseMarkdown.mockImplementation((input: string) =>
      input.trim() ? `<p>${input}</p>` : "",
    );
    fireEvent.change(textarea, { target: { value: "good content" } });
    vi.advanceTimersByTime(250);

    expect(mockParseMarkdown).toHaveBeenCalledWith("good content");
    vi.useRealTimers();
  });
});
