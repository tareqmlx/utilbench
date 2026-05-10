import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JwtDecoderRoute from "../Route";

function makeToken(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${encode(header)}.${encode(payload)}.test-signature`;
}

describe("JwtDecoderRoute", () => {
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

  function getTextarea() {
    return screen.getByPlaceholderText(/Paste your JWT here/) as HTMLTextAreaElement;
  }

  function setTokenValue(value: string) {
    fireEvent.change(getTextarea(), { target: { value } });
  }

  it("renders without crashing", () => {
    render(<JwtDecoderRoute />);
    expect(getTextarea()).toBeInTheDocument();
  });

  it("loads with sample token decoded by default", () => {
    render(<JwtDecoderRoute />);
    expect(screen.getByText("Valid Token Format Detected")).toBeInTheDocument();
    expect(screen.getByText("alg")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(/Issued At/)).toBeInTheDocument();
  });

  it("textarea is editable", () => {
    render(<JwtDecoderRoute />);
    setTokenValue("hello");
    expect(getTextarea()).toHaveValue("hello");
  });

  it("decodes in real-time on input change", () => {
    render(<JwtDecoderRoute />);
    const token = makeToken({ alg: "HS256", typ: "JWT" }, { sub: "realtime-test", role: "admin" });
    setTokenValue(token);
    expect(screen.getByText("Valid Token Format Detected")).toBeInTheDocument();
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("role")).toBeInTheDocument();
  });

  it("shows error for invalid base64 token", () => {
    render(<JwtDecoderRoute />);
    setTokenValue("not.valid-base64!.token");
    expect(screen.getByText(/Invalid JWT/)).toBeInTheDocument();
  });

  it("shows error for wrong part count", () => {
    render(<JwtDecoderRoute />);
    setTokenValue("only.two");
    expect(screen.getByText(/expected 3 parts separated by dots/)).toBeInTheDocument();
  });

  it("clear button resets all state", () => {
    render(<JwtDecoderRoute />);
    expect(screen.getByText("Valid Token Format Detected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    expect(getTextarea()).toHaveValue("");
    expect(screen.getByText("Waiting for token input")).toBeInTheDocument();
    expect(screen.getByText("Enter a token to see the header")).toBeInTheDocument();
  });

  it("paste reads from clipboard and decodes", async () => {
    render(<JwtDecoderRoute />);
    const token = makeToken({ alg: "HS256" }, { sub: "pasted-user" });
    clipboardMock.readText.mockResolvedValueOnce(token);

    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));

    await waitFor(() => {
      expect(getTextarea()).toHaveValue(token);
    });
    expect(screen.getByText("Valid Token Format Detected")).toBeInTheDocument();
  });

  it("copy header writes header JSON to clipboard", () => {
    render(<JwtDecoderRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Copy header/ }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith(
      JSON.stringify({ alg: "HS256", typ: "JWT" }, null, 2),
    );
  });

  it("copy payload writes payload JSON to clipboard", () => {
    render(<JwtDecoderRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Copy payload/ }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith(
      JSON.stringify({ sub: "1234567890", name: "John Doe", iat: 1516239022 }, null, 2),
    );
  });

  it("displays time claims for iat", () => {
    render(<JwtDecoderRoute />);
    expect(screen.getByText(/Issued At/)).toBeInTheDocument();
  });

  it("shows expired indicator for expired token", () => {
    render(<JwtDecoderRoute />);
    const expiredToken = makeToken({ alg: "HS256", typ: "JWT" }, { sub: "test", exp: 1000000 });
    setTokenValue(expiredToken);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("shows signature algorithm dynamically", () => {
    render(<JwtDecoderRoute />);
    expect(screen.getByText(/HMACSHA256/)).toBeInTheDocument();

    const rs256Token = makeToken({ alg: "RS256", typ: "JWT" }, { sub: "test" });
    setTokenValue(rs256Token);
    expect(screen.getByText(/RSASHA256/)).toBeInTheDocument();
  });

  it("error clears when valid token is re-entered", () => {
    render(<JwtDecoderRoute />);
    setTokenValue("invalid.token");
    expect(screen.getByText(/Invalid JWT/)).toBeInTheDocument();

    const validToken = makeToken({ alg: "HS256" }, { sub: "test" });
    setTokenValue(validToken);
    expect(screen.queryByText(/Invalid JWT/)).not.toBeInTheDocument();
    expect(screen.getByText("Valid Token Format Detected")).toBeInTheDocument();
  });

  it("empty input shows neutral status, not error", () => {
    render(<JwtDecoderRoute />);
    setTokenValue("");
    expect(screen.getByText("Waiting for token input")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid JWT/)).not.toBeInTheDocument();
    expect(screen.queryByText("Valid Token Format Detected")).not.toBeInTheDocument();
  });
});
