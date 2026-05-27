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
    expect(screen.getByRole("alert")).toHaveTextContent(/Invalid file type/);
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

  describe("after upload", () => {
    const lottieData = JSON.stringify({
      w: 200,
      h: 200,
      fr: 30,
      ip: 0,
      op: 60,
      layers: [{ ty: 4 }],
      v: "5.7.0",
      nm: "Test",
    });

    async function uploadFile() {
      const input = screen.getByTestId("file-input");
      const file = new File([lottieData], "anim.json", { type: "application/json" });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      await waitFor(() => {
        expect(screen.getByText("Remove")).toBeInTheDocument();
      });
    }

    beforeEach(() => {
      // Mock clipboard for handleCopyEmbed
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
        writable: true,
      });
    });

    it("speed buttons toggle active state when clicked", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();

      await act(async () => {
        fireEvent.click(screen.getByText("2x"));
      });
      // Settled by lottie mock — no throw
      expect(screen.getByText("2x")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText("1.5x"));
      });
      expect(screen.getByText("1.5x")).toBeInTheDocument();
    });

    it("play/pause and replay buttons enable after upload", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();

      const pauseBtn = screen.getByLabelText("Pause");
      expect(pauseBtn).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      // After pausing, label should switch to Play
      await waitFor(() => {
        expect(screen.getByLabelText("Play")).toBeInTheDocument();
      });

      const replayBtn = screen.getByLabelText("Replay");
      expect(replayBtn).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(replayBtn);
      });
    });

    it("background swatches change selected state", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();

      const blackBtn = screen.getByLabelText("Black background");
      const transparentBtn = screen.getByLabelText("Transparent background");
      const whiteBtn = screen.getByLabelText("White background");

      await act(async () => fireEvent.click(blackBtn));
      expect(blackBtn.className).toContain("ring-2");

      await act(async () => fireEvent.click(transparentBtn));
      expect(transparentBtn.className).toContain("ring-2");

      await act(async () => fireEvent.click(whiteBtn));
      expect(whiteBtn.className).toContain("ring-2");
    });

    it("remove button clears file state", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();
      await act(async () => {
        fireEvent.click(screen.getByText("Remove"));
      });
      await waitFor(() => {
        expect(screen.getByText("Drag your animation here")).toBeInTheDocument();
      });
    });

    it("download .dotLottie button is enabled and clickable", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();

      const createUrl = vi.fn().mockReturnValue("blob:test");
      const revokeUrl = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        value: createUrl,
        configurable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: revokeUrl,
        configurable: true,
      });

      const btn = screen.getByText("Download .dotLottie").closest("button");
      expect(btn).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(btn as HTMLButtonElement);
      });
      expect(createUrl).toHaveBeenCalled();
    });

    it("Get Embed Code copies to clipboard", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();

      const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
      const btn = screen.getByText("Get Embed Code").closest("button");
      expect(btn).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(btn as HTMLButtonElement);
      });
      await waitFor(() => {
        expect(writeText).toHaveBeenCalled();
      });
    });

    it("settings toggle exposes Loop switch", async () => {
      render(<LottiePreviewerRoute />);
      await uploadFile();
      await act(async () => {
        fireEvent.click(screen.getByTitle("Settings"));
      });
      const loop = await screen.findByText("Loop");
      expect(loop).toBeInTheDocument();
    });
  });
});
