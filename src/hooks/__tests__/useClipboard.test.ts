import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClipboard } from "../useClipboard";

describe("useClipboard", () => {
  const clipboardMock = {
    writeText: vi.fn(),
    readText: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardMock,
      writable: true,
      configurable: true,
    });
    clipboardMock.writeText.mockResolvedValue(undefined);
    clipboardMock.readText.mockResolvedValue("clipboard text");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("copy writes text and sets copied to true", async () => {
    const { result } = renderHook(() => useClipboard());

    expect(result.current.copied).toBe(false);

    await act(async () => {
      const success = await result.current.copy("hello");
      expect(success).toBe(true);
    });

    expect(clipboardMock.writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);
  });

  it("copied resets after delay", async () => {
    const { result } = renderHook(() => useClipboard(1000));

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.copied).toBe(false);
  });

  it("copy returns false on failure", async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error("denied"));

    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      const success = await result.current.copy("hello");
      expect(success).toBe(false);
    });

    expect(result.current.copied).toBe(false);
  });

  it("readClipboard returns text", async () => {
    const { result } = renderHook(() => useClipboard());

    let text: string | null = null;
    await act(async () => {
      text = await result.current.readClipboard();
    });

    expect(text).toBe("clipboard text");
  });

  it("readClipboard returns null on failure", async () => {
    clipboardMock.readText.mockRejectedValueOnce(new Error("denied"));

    const { result } = renderHook(() => useClipboard());

    let text: string | null = "not null";
    await act(async () => {
      text = await result.current.readClipboard();
    });

    expect(text).toBeNull();
  });
});
