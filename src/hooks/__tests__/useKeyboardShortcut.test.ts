import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcut } from "../useKeyboardShortcut";

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useKeyboardShortcut", () => {
  it("fires handler on matching key", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "Enter", meta: true, handler }]));

    fireKey("Enter", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when meta is required but not pressed", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "Enter", meta: true, handler }]));

    fireKey("Enter");
    expect(handler).not.toHaveBeenCalled();
  });

  it("detects shift modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "c", meta: true, shift: true, handler }]));

    fireKey("c", { metaKey: true }); // no shift
    expect(handler).not.toHaveBeenCalled();

    fireKey("c", { metaKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("respects enabled flag", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "s", meta: true, handler, enabled: false }]));

    fireKey("s", { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports ctrlKey as alternative to metaKey", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "Enter", meta: true, handler }]));

    fireKey("Enter", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips non-meta shortcuts when focus is in an input", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut([{ key: "a", handler }]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });
});
