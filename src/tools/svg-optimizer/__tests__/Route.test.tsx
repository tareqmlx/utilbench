import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SvgOptimizerRoute from "../Route";

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

vi.mock("svgo/browser", () => ({
  optimize: vi.fn((_content: string) => ({
    data: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
  })),
}));

vi.mock("fflate", () => ({
  zipSync: vi.fn(() => new Uint8Array([80, 75, 3, 4])),
}));

beforeEach(() => {
  localStorage.removeItem("utilbench:prefs:svg-optimizer");
});

afterEach(() => {
  cleanup();
});

describe("SvgOptimizerRoute", () => {
  it("renders without crashing", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.getByText("Drop multiple SVGs here")).toBeInTheDocument();
  });

  it("shows drop zone with buttons", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.getByText("Drop multiple SVGs here")).toBeInTheDocument();
    expect(screen.getByText("Select Files")).toBeInTheDocument();
    expect(screen.getByText("Paste Code")).toBeInTheDocument();
  });

  it("has hidden file input with correct attributes", () => {
    render(<SvgOptimizerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", ".svg,image/svg+xml");
  });

  it("does not show queue when no files are added", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.queryByText("Optimization Queue")).not.toBeInTheDocument();
  });

  it("adds file to queue on upload", async () => {
    render(<SvgOptimizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File([VALID_SVG], "icon.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("icon.svg")).toBeInTheDocument();
      expect(screen.getByText("Optimization Queue")).toBeInTheDocument();
    });
  });

  it("rejects non-SVG files with error message", () => {
    render(<SvgOptimizerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
  });

  it("toggles paste area on Paste Code click", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.queryByTestId("paste-textarea")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Paste Code"));
    expect(screen.getByTestId("paste-textarea")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Paste Code"));
    expect(screen.queryByTestId("paste-textarea")).not.toBeInTheDocument();
  });

  it("adds pasted SVG to queue on Process", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));

    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByText("pasted-svg.svg")).toBeInTheDocument();
    });
  });

  it("shows error for invalid pasted content", () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));

    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: "<div>not svg</div>" } });
    fireEvent.click(screen.getByText("Process"));

    expect(screen.getByText(/No <svg>/)).toBeInTheDocument();
  });

  it("checkbox toggling updates option state", () => {
    render(<SvgOptimizerRoute />);
    const toggle = screen.getByLabelText("Prefix IDs");
    expect(toggle).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("preset clicking updates checkboxes", () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("PRINT"));

    // Print preset: removeMetadata=false, simplifyPaths=false
    const metadataToggle = screen.getByLabelText("Remove Metadata");
    const pathsToggle = screen.getByLabelText("Simplify Path Data");
    expect(metadataToggle).toHaveAttribute("data-state", "unchecked");
    expect(pathsToggle).toHaveAttribute("data-state", "unchecked");
  });

  it("preset button shows active state", () => {
    render(<SvgOptimizerRoute />);
    const mobileBtn = screen.getByText("MOBILE");
    fireEvent.click(mobileBtn);
    expect(mobileBtn).toHaveAttribute("data-active", "true");
    expect(mobileBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders all option sections", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.getByText("Cleanup Options")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("Presets")).toBeInTheDocument();
  });

  it("renders all preset buttons", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.getByText("UI ICONS")).toBeInTheDocument();
    expect(screen.getByText("MOBILE")).toBeInTheDocument();
    expect(screen.getByText("PRINT")).toBeInTheDocument();
    expect(screen.getByText("LEGACY")).toBeInTheDocument();
  });

  it("Process button is disabled when paste textarea is empty", () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const processBtn = screen.getByText("Process");
    expect(processBtn).toBeDisabled();
  });

  it("shows preview button on completed files", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByLabelText("Preview pasted-svg.svg")).toBeInTheDocument();
    });
  });

  it("shows download button on completed files", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByText("Download")).toBeInTheDocument();
    });
  });

  it("removes file from queue when close button clicked", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByText("pasted-svg.svg")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Remove pasted-svg.svg"));
    expect(screen.queryByText("pasted-svg.svg")).not.toBeInTheDocument();
  });

  it("checkbox labels are accessible", () => {
    render(<SvgOptimizerRoute />);
    expect(screen.getByLabelText("Remove Comments")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Metadata")).toBeInTheDocument();
    expect(screen.getByLabelText("Simplify Path Data")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Unused IDs")).toBeInTheDocument();
    expect(screen.getByLabelText("Prefix IDs")).toBeInTheDocument();
    expect(screen.getByLabelText("Convert Colors to Hex")).toBeInTheDocument();
  });

  it("shows download button on completed file and triggers download", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByText("Download")).toBeInTheDocument();
    });

    // Click download
    fireEvent.click(screen.getByText("Download"));
    // Should not throw
  });

  it("opens preview when preview button is clicked", async () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("Paste Code"));
    const textarea = screen.getByTestId("paste-textarea");
    fireEvent.change(textarea, { target: { value: VALID_SVG } });
    fireEvent.click(screen.getByText("Process"));

    await waitFor(() => {
      expect(screen.getByLabelText("Preview pasted-svg.svg")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Preview pasted-svg.svg"));

    // Close button should appear after opening (shadcn Dialog uses sr-only "Close" text)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("handles drag events on drop zone", () => {
    render(<SvgOptimizerRoute />);
    const dropZone = screen.getByText("Drop multiple SVGs here").closest("div") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    // Should not throw
  });

  it("handles drop event with valid SVG file", async () => {
    render(<SvgOptimizerRoute />);
    const dropZone = screen.getByText("Drop multiple SVGs here").closest("div") as HTMLElement;
    const file = new File([VALID_SVG], "dropped.svg", { type: "image/svg+xml" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("dropped.svg")).toBeInTheDocument();
    });
  });

  it("shows Download All button with multiple completed files", async () => {
    render(<SvgOptimizerRoute />);
    const input = screen.getByTestId("file-input");
    const file1 = new File([VALID_SVG], "one.svg", { type: "image/svg+xml" });
    const file2 = new File([VALID_SVG], "two.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(screen.getByText("one.svg")).toBeInTheDocument();
      expect(screen.getByText("two.svg")).toBeInTheDocument();
    });

    // Download All should appear for multiple files
    await waitFor(() => {
      expect(screen.getByText("Download All")).toBeInTheDocument();
    });
  });

  it("resets active preset when manual checkbox change occurs", () => {
    render(<SvgOptimizerRoute />);
    fireEvent.click(screen.getByText("UI ICONS"));
    expect(screen.getByText("UI ICONS")).toHaveAttribute("data-active", "true");

    // Manually toggle a checkbox
    fireEvent.click(screen.getByLabelText("Prefix IDs"));
    // Active preset should be cleared since manual change was made
    expect(screen.getByText("UI ICONS")).toHaveAttribute("data-active", "false");
  });
});
