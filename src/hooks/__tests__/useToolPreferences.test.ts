import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToolPreferences } from "../useToolPreferences";

const SLUG = "test-tool";
const KEY = `utilbench:prefs:${SLUG}`;
const DEFAULTS = { format: "jpeg", quality: 85, verbose: false } as const;

describe("useToolPreferences", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns defaults when localStorage is empty", () => {
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("reads and merges stored values on mount", () => {
    localStorage.setItem(KEY, JSON.stringify({ format: "png", quality: 60 }));
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0]).toEqual({ format: "png", quality: 60, verbose: false });
  });

  it("forward compatibility — new keys get defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ format: "webp" }));
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0].quality).toBe(85);
    expect(result.current[0].verbose).toBe(false);
    expect(result.current[0].format).toBe("webp");
  });

  it("stale key cleanup — ignores keys not in defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ format: "png", oldKey: "stale" }));
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0]).toEqual({ format: "png", quality: 85, verbose: false });
    expect("oldKey" in result.current[0]).toBe(false);
  });

  it("patch setter updates single field, preserves others", () => {
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    act(() => result.current[1]({ quality: 50 }));
    expect(result.current[0]).toEqual({ format: "jpeg", quality: 50, verbose: false });
  });

  it("writes to localStorage after debounce", () => {
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    act(() => result.current[1]({ quality: 50 }));

    // Before debounce fires — still has old value (or none)
    expect(localStorage.getItem(KEY)).toBeNull();

    act(() => vi.advanceTimersByTime(300));
    const stored = JSON.parse(localStorage.getItem(KEY) as string);
    expect(stored.quality).toBe(50);
  });

  it("multiple rapid calls produce only one write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));

    act(() => result.current[1]({ quality: 10 }));
    act(() => result.current[1]({ quality: 20 }));
    act(() => result.current[1]({ quality: 30 }));
    act(() => vi.advanceTimersByTime(300));

    const calls = spy.mock.calls.filter(([k]) => k === KEY);
    expect(calls.length).toBe(1);
    const stored = JSON.parse(calls[0]?.[1] as string);
    expect(stored.quality).toBe(30);
    spy.mockRestore();
  });

  it("reset clears storage and returns defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ format: "png", quality: 10 }));
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0].format).toBe("png");

    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("graceful fallback for corrupt/malformed JSON", () => {
    localStorage.setItem(KEY, "not{json");
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("handles localStorage unavailable (thrown exceptions)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { result } = renderHook(() => useToolPreferences(SLUG, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    spy.mockRestore();
  });
});
