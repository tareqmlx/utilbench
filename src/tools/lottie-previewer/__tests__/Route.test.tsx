import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LottiePreviewerRoute from "../Route";

vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      destroy: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      goToAndPlay: vi.fn(),
      goToAndStop: vi.fn(),
      setSpeed: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      currentFrame: 0,
      loop: true,
    })),
  },
}));

vi.mock("../lottie", async () => {
  const actual = await vi.importActual("../lottie");
  return {
    ...actual,
    exportFrameAsPng: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
    exportAsGif: vi.fn().mockResolvedValue(new Blob(["gif"], { type: "image/gif" })),
  };
});

afterEach(() => {
  cleanup();
});

describe("LottiePreviewerRoute", () => {
  it("renders without crashing", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("Drag your animation here")).toBeInTheDocument();
  });

  it("shows upload zone initially", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("Drag your animation here")).toBeInTheDocument();
    expect(screen.getByText("Browse Files")).toBeInTheDocument();
  });

  it("has a file input with correct accept attribute", () => {
    render(<LottiePreviewerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".json,.lottie");
  });

  it("shows metadata placeholders initially", () => {
    render(<LottiePreviewerRoute />);
    const dashes = screen.getAllByText("--");
    expect(dashes.length).toBeGreaterThanOrEqual(7);
  });

  it("shows empty features message initially", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("Upload a file to detect features.")).toBeInTheDocument();
  });

  it("has action buttons disabled without file", () => {
    render(<LottiePreviewerRoute />);
    const dotLottieBtn = screen.getByText("Download .dotLottie").closest("button");
    const gifBtn = screen.getByText("Export as GIF").closest("button");
    const embedBtn = screen.getByText("Get Embed Code").closest("button");

    expect(dotLottieBtn).toBeDisabled();
    expect(gifBtn).toBeDisabled();
    expect(embedBtn).toBeDisabled();
  });

  it("has play/pause and replay buttons disabled without file", () => {
    render(<LottiePreviewerRoute />);
    const pauseBtn = screen.getByLabelText("Pause");
    const replayBtn = screen.getByLabelText("Replay");
    expect(pauseBtn).toBeDisabled();
    expect(replayBtn).toBeDisabled();
  });

  it("renders speed buttons", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("1x")).toBeInTheDocument();
    expect(screen.getByText("1.5x")).toBeInTheDocument();
    expect(screen.getByText("2x")).toBeInTheDocument();
  });

  it("renders background swatches", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByLabelText("White background")).toBeInTheDocument();
    expect(screen.getByLabelText("Black background")).toBeInTheDocument();
    expect(screen.getByLabelText("Transparent background")).toBeInTheDocument();
  });

  it("renders timeline with time labels", () => {
    render(<LottiePreviewerRoute />);
    const labels = screen.getAllByText("0:00");
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders metadata section", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("Filename")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.getByText("Frame Rate")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
  });

  it("renders upload zone", () => {
    render(<LottiePreviewerRoute />);
    expect(screen.getByText("Browse Files")).toBeInTheDocument();
  });

  it("has file input element", () => {
    render(<LottiePreviewerRoute />);
    const input = screen.getByTestId("file-input");
    expect(input).toHaveAttribute("type", "file");
  });

  it("rejects invalid file types", () => {
    render(<LottiePreviewerRoute />);
    const input = screen.getByTestId("file-input");
    const file = new File(["data"], "test.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
  });

  it("speed buttons render correctly", () => {
    render(<LottiePreviewerRoute />);
    const btn1x = screen.getByText("1x");
    const btn15x = screen.getByText("1.5x");
    const btn2x = screen.getByText("2x");
    expect(btn1x).toBeInTheDocument();
    expect(btn15x).toBeInTheDocument();
    expect(btn2x).toBeInTheDocument();
  });

  it("changes background when swatch is clicked", () => {
    render(<LottiePreviewerRoute />);
    const blackBtn = screen.getByLabelText("Black background");
    fireEvent.click(blackBtn);
    expect(blackBtn.className).toContain("ring-2");
  });

  it("has timeline with time labels", () => {
    render(<LottiePreviewerRoute />);
    const labels = screen.getAllByText("0:00");
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("has settings toggle button", () => {
    render(<LottiePreviewerRoute />);
    const settingsBtn = screen.getByTitle("Settings");
    expect(settingsBtn).toBeInTheDocument();
  });

  it("opens settings dropdown on toggle click", () => {
    render(<LottiePreviewerRoute />);
    const settingsBtn = screen.getByTitle("Settings");
    fireEvent.click(settingsBtn);
    expect(screen.getByText("Loop")).toBeInTheDocument();
  });

  it("uploads a valid .json file and shows filename", async () => {
    render(<LottiePreviewerRoute />);
    const input = screen.getByTestId("file-input");
    const lottieData = JSON.stringify({
      w: 512,
      h: 512,
      fr: 30,
      ip: 0,
      op: 60,
      layers: [{ ty: 4 }],
      v: "5.7.0",
      nm: "Test",
    });
    const file = new File([lottieData], "anim.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      const matches = screen.getAllByText("anim.json");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows remove button after file upload", async () => {
    render(<LottiePreviewerRoute />);
    const input = screen.getByTestId("file-input");
    const lottieData = JSON.stringify({
      w: 100,
      h: 100,
      fr: 24,
      ip: 0,
      op: 48,
      layers: [],
    });
    const file = new File([lottieData], "test.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      const matches = screen.getAllByText("test.json");
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Remove")).toBeInTheDocument();
    });
  });

  it("handles drag events without crashing", () => {
    render(<LottiePreviewerRoute />);
    const dropZone = screen.getByText("Drag your animation here").closest("div") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    // Should not throw
  });
});
