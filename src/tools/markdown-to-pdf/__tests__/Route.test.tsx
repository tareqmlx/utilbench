import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Route from "../Route";
import type { PrintHooks } from "../print";

vi.mock("../print", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../print")>();
  return { ...actual, printMarkdown: vi.fn().mockResolvedValue(undefined) };
});

// Imported after the mock so this is the mocked fn.
import { printMarkdown } from "../print";

const mockedPrint = vi.mocked(printMarkdown);

function typeMarkdown(value: string) {
  const textarea = screen.getByLabelText("Markdown") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value } });
  return textarea;
}

beforeEach(() => {
  localStorage.clear();
  mockedPrint.mockReset();
  mockedPrint.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("MarkdownToPdfRoute", () => {
  it("renders the preview after typing Markdown (debounced)", async () => {
    render(<Route />);
    typeMarkdown("# Hello Heading");

    const pane = await screen.findByTestId("preview-pane");
    await waitFor(() => {
      expect(pane.querySelector("h1")?.textContent).toContain("Hello Heading");
    });
  });

  it("has an accessible label tying the editor to its <label>", () => {
    render(<Route />);
    const textarea = screen.getByLabelText("Markdown");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("id", "md-input");
  });

  it("disables Download when empty and enables it once there is content", async () => {
    render(<Route />);
    const button = screen.getByTestId("download-pdf");
    expect(button).toBeDisabled();

    typeMarkdown("# Something");
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("imports a .md file, populating the editor and the document title", async () => {
    render(<Route />);
    const fileInput = screen.getByTestId("md-input-file") as HTMLInputElement;
    const file = new File(["# Hi"], "notes.md", { type: "text/markdown" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    const textarea = screen.getByLabelText("Markdown") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain("# Hi"));
    expect((screen.getByTestId("doc-title") as HTMLInputElement).value).toBe("notes");
  });

  it("loads the example into the editor and preview", async () => {
    render(<Route />);
    fireEvent.click(screen.getByTestId("load-example"));

    const textarea = screen.getByLabelText("Markdown") as HTMLTextAreaElement;
    expect(textarea.value).toContain("# Project Brief");

    const pane = await screen.findByTestId("preview-pane");
    await waitFor(() => {
      expect(pane.querySelector("h1")?.textContent).toContain("Project Brief");
    });
  });

  it("keeps Download disabled and never calls print when empty", async () => {
    render(<Route />);
    // The button stays disabled while empty (the in-handler guard is defensive only).
    const button = screen.getByTestId("download-pdf");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockedPrint).not.toHaveBeenCalled();
  });

  it("calls printMarkdown with default options on Download", async () => {
    render(<Route />);
    typeMarkdown("# Doc");
    const button = screen.getByTestId("download-pdf");
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => expect(mockedPrint).toHaveBeenCalledTimes(1));
    expect(mockedPrint).toHaveBeenCalledWith(
      "# Doc",
      expect.objectContaining({
        pageSize: "A4",
        orientation: "portrait",
        margin: "normal",
        fontFamily: "sans",
      }),
      expect.anything(),
    );
  });

  it("passes a changed page size through to printMarkdown", async () => {
    render(<Route />);
    typeMarkdown("# Doc");
    await waitFor(() => expect(screen.getByTestId("download-pdf")).toBeEnabled());

    fireEvent.click(screen.getByTestId("page-size-trigger"));
    fireEvent.click(await screen.findByRole("option", { name: "Letter" }));

    fireEvent.click(screen.getByTestId("download-pdf"));

    await waitFor(() => expect(mockedPrint).toHaveBeenCalledTimes(1));
    expect(mockedPrint).toHaveBeenCalledWith(
      "# Doc",
      expect.objectContaining({ pageSize: "Letter" }),
      expect.anything(),
    );
  });

  it("includes the document title in the print options when provided", async () => {
    render(<Route />);
    typeMarkdown("# Doc");
    await waitFor(() => expect(screen.getByTestId("download-pdf")).toBeEnabled());

    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "My Report" } });
    fireEvent.click(screen.getByTestId("download-pdf"));

    await waitFor(() => expect(mockedPrint).toHaveBeenCalledTimes(1));
    expect(mockedPrint).toHaveBeenCalledWith(
      "# Doc",
      expect.objectContaining({ title: "My Report" }),
      expect.anything(),
    );
  });

  it("shows the dialog-open hint while the print dialog is open", async () => {
    // Mock that stops at "dialog-open" so the intermediate state renders.
    mockedPrint.mockImplementation((_src, _opts, hooks?: PrintHooks) => {
      hooks?.onStatus?.("dialog-open");
      return Promise.resolve();
    });

    render(<Route />);
    typeMarkdown("# Doc");
    await waitFor(() => expect(screen.getByTestId("download-pdf")).toBeEnabled());

    fireEvent.click(screen.getByTestId("download-pdf"));

    const hint = await screen.findByTestId("dialog-hint");
    expect(hint.textContent).toContain("Save as PDF");
    // Button is disabled while the dialog is open.
    expect(screen.getByTestId("download-pdf")).toBeDisabled();
  });

  it("re-enables Download and hides the hint after print completes", async () => {
    mockedPrint.mockImplementation((_src, _opts, hooks?: PrintHooks) => {
      hooks?.onStatus?.("dialog-open");
      hooks?.onStatus?.("done");
      return Promise.resolve();
    });

    render(<Route />);
    typeMarkdown("# Doc");
    const button = screen.getByTestId("download-pdf");
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-hint")).not.toBeInTheDocument();
      expect(button).toBeEnabled();
    });

    // A second Download works.
    fireEvent.click(button);
    await waitFor(() => expect(mockedPrint).toHaveBeenCalledTimes(2));
  });

  it("shows guidance copy when printMarkdown rejects", async () => {
    mockedPrint.mockRejectedValue(new Error("Could not open a print frame."));

    render(<Route />);
    typeMarkdown("# Doc");
    await waitFor(() => expect(screen.getByTestId("download-pdf")).toBeEnabled());

    fireEvent.click(screen.getByTestId("download-pdf"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not open a print frame.");
    // Status reset to idle on error → button re-enabled.
    await waitFor(() => expect(screen.getByTestId("download-pdf")).toBeEnabled());
  });
});
