import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QRCode from "qrcode";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrGeneratorRoute from "../Route";

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn(),
    toDataURL: vi.fn(),
  },
}));

const qrMock = vi.mocked(QRCode);

describe("QrGeneratorRoute", () => {
  const clipboardMock = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  };

  beforeEach(() => {
    localStorage.removeItem("utilbench:prefs:qr-generator");
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardMock,
      writable: true,
      configurable: true,
    });
    clipboardMock.writeText.mockClear().mockResolvedValue(undefined);
    clipboardMock.readText.mockClear().mockResolvedValue("");
    qrMock.toString.mockReset().mockResolvedValue("<svg>mock-svg</svg>");
    qrMock.toDataURL.mockReset().mockResolvedValue("data:image/png;base64,mock-png");
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  async function flushDebounce() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  /** Click a Radix Tab trigger using mouseDown (Radix listens on onMouseDown). */
  function clickTab(name: string) {
    const tab = screen.getByRole("tab", { name });
    // Radix TabsTrigger activates via onMouseDown with button === 0 and ctrlKey === false
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.mouseUp(tab, { button: 0 });
    fireEvent.click(tab);
  }

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "URL" })).toBeInTheDocument();
  });

  it("renders content type tabs", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "URL" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "WiFi" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "vCard" })).toBeInTheDocument();
  });

  it("switches content type tabs", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );

    await clickTab("WiFi");
    expect(screen.getByLabelText("Network SSID")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    await clickTab("vCard");
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization")).toBeInTheDocument();
  });

  it("shows text input for URL and Text tabs", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("https://yourlink.com")).toBeInTheDocument();

    await clickTab("Text");
    expect(screen.getByPlaceholderText("Enter text content...")).toBeInTheDocument();
  });

  it("hides text input for WiFi and vCard tabs", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );

    await clickTab("WiFi");
    expect(screen.queryByPlaceholderText("https://yourlink.com")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Enter text content...")).not.toBeInTheDocument();
  });

  it("WiFi fields are controlled inputs", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("WiFi");

    const ssid = screen.getByLabelText("Network SSID") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;

    fireEvent.change(ssid, { target: { value: "TestNetwork" } });
    fireEvent.change(password, { target: { value: "pass123" } });

    expect(ssid).toHaveValue("TestNetwork");
    expect(password).toHaveValue("pass123");
  });

  it("vCard fields are controlled inputs", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("vCard");

    const name = screen.getByLabelText("Full Name") as HTMLInputElement;
    const org = screen.getByLabelText("Organization") as HTMLInputElement;

    fireEvent.change(name, { target: { value: "Jane Doe" } });
    fireEvent.change(org, { target: { value: "Acme Corp" } });

    expect(name).toHaveValue("Jane Doe");
    expect(org).toHaveValue("Acme Corp");
  });

  it("size select renders with default value", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    // Radix Select renders a combobox trigger showing the current value
    const triggers = screen.getAllByRole("combobox");
    const sizeTrigger = triggers.find((t) => t.textContent?.includes("512"));
    expect(sizeTrigger).toBeDefined();
  });

  it("correction select renders with default value", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    // Radix Select renders a combobox trigger showing the current value
    const triggers = screen.getAllByRole("combobox");
    const correctionTrigger = triggers.find((t) => t.textContent?.includes("Medium"));
    expect(correctionTrigger).toBeDefined();
  });

  it("format toggle switches between SVG and PNG", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const pngTab = screen.getByRole("tab", { name: "PNG" });

    await clickTab("PNG");

    expect(pngTab).toHaveAttribute("data-state", "active");
  });

  it("quiet zone slider updates label", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText("4px")).toBeInTheDocument();

    const slider = screen.getByRole("slider");
    // Use keyboard events to change the value
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(screen.getByText("7px")).toBeInTheDocument();
  });

  it("generates QR code after debounce", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();
    expect(qrMock.toString).toHaveBeenCalled();
  });

  it("generates PNG when format is PNG", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("PNG");
    await flushDebounce();
    expect(qrMock.toDataURL).toHaveBeenCalled();
  });

  it("shows placeholder when input is empty", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText("https://yourlink.com") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    await flushDebounce();
    expect(screen.getByText("Enter content to generate QR code")).toBeInTheDocument();
  });

  it("shows error badge on generation failure", async () => {
    qrMock.toString.mockRejectedValueOnce(new Error("Data too long"));
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Data too long")).toBeInTheDocument();
  });

  it("download button is disabled when no output", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText("https://yourlink.com") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    await flushDebounce();
    const downloadBtn = screen.getByRole("button", { name: /Generate & Download/i });
    expect(downloadBtn).toBeDisabled();
  });

  it("download button is enabled when output exists", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();
    const downloadBtn = screen.getByRole("button", { name: /Generate & Download/i });
    expect(downloadBtn).not.toBeDisabled();
  });

  it("copy button triggers clipboard write", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();
    expect(screen.getByLabelText("Copy QR code")).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy QR code"));
    });

    vi.useRealTimers();
    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalledWith("<svg>mock-svg</svg>");
    });
  });

  it("color input shows red ring for invalid hex", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );

    const fgInput = screen.getByLabelText("Foreground") as HTMLInputElement;
    fireEvent.change(fgInput, { target: { value: "not-a-color" } });

    const container = fgInput.closest("div");
    expect(container?.className).toContain("ring-");
    expect(container?.className).toContain("destructive");
  });

  it("shows ACTIVE SYNC badge when generation succeeds", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();
    expect(screen.getByText("ACTIVE SYNC")).toBeInTheDocument();
  });

  it("displays current payload text in preview", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText("https://utilbench.io")).toBeInTheDocument();
  });

  it("download button triggers download for SVG format", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await flushDebounce();

    const downloadBtn = screen.getByRole("button", { name: /Generate & Download/i });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });
    // Should not throw
  });

  it("download button triggers download for PNG format", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("PNG");
    await flushDebounce();

    const downloadBtn = screen.getByRole("button", { name: /Generate & Download/i });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });
    // Should not throw
  });

  it("background color input shows red ring for invalid hex", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const bgInput = screen.getByLabelText("Background") as HTMLInputElement;
    fireEvent.change(bgInput, { target: { value: "invalid" } });
    const container = bgInput.closest("div");
    expect(container?.className).toContain("ring-");
    expect(container?.className).toContain("destructive");
  });

  it("WiFi tab generates correct payload through UI", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("WiFi");

    const ssid = screen.getByLabelText("Network SSID") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(ssid, { target: { value: "HomeNet" } });
    fireEvent.change(password, { target: { value: "pass123" } });

    await flushDebounce();

    expect(qrMock.toString).toHaveBeenCalled();
    const lastCall = qrMock.toString.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("WIFI:S:HomeNet");
  });

  it("vCard tab generates correct payload through UI", async () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    await clickTab("vCard");

    const name = screen.getByLabelText("Full Name") as HTMLInputElement;
    const org = screen.getByLabelText("Organization") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "John Smith" } });
    fireEvent.change(org, { target: { value: "Acme Inc" } });

    await flushDebounce();

    expect(qrMock.toString).toHaveBeenCalled();
    const lastCall = qrMock.toString.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("BEGIN:VCARD");
    expect(lastCall?.[0]).toContain("FN:John Smith");
  });

  it("updates foreground color", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const fgInput = screen.getByLabelText("Foreground") as HTMLInputElement;
    fireEvent.change(fgInput, { target: { value: "#ff0000" } });
    expect(fgInput).toHaveValue("#ff0000");
  });

  it("updates background color", () => {
    render(
      <MemoryRouter>
        <QrGeneratorRoute />
      </MemoryRouter>,
    );
    const bgInput = screen.getByLabelText("Background") as HTMLInputElement;
    fireEvent.change(bgInput, { target: { value: "#000000" } });
    expect(bgInput).toHaveValue("#000000");
  });
});
