import { act, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useUrlState } from "../useUrlState";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, { initialEntries: ["/"] }, children);
}

function wrapperWithSearch(search: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [`/${search}`] }, children);
}

const SCHEMA = {
  expression: { type: "string" as const, defaultValue: "0 * * * *" },
  count: { type: "number" as const, defaultValue: 5 },
  verbose: { type: "boolean" as const, defaultValue: false },
};

describe("useUrlState", () => {
  it("returns default values when URL has no params", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), { wrapper });
    expect(result.current[0]).toEqual({
      expression: "0 * * * *",
      count: 5,
      verbose: false,
    });
  });

  it("reads string values from URL", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?expression=*/5+*+*+*+*"),
    });
    expect(result.current[0].expression).toBe("*/5 * * * *");
  });

  it("reads number values from URL", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?count=10"),
    });
    expect(result.current[0].count).toBe(10);
  });

  it("reads boolean values from URL", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?verbose=1"),
    });
    expect(result.current[0].verbose).toBe(true);
  });

  it("falls back to default for invalid number", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?count=abc"),
    });
    expect(result.current[0].count).toBe(5);
  });

  it("treats boolean 0 as false", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?verbose=0"),
    });
    expect(result.current[0].verbose).toBe(false);
  });

  it("setState updates values", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), { wrapper });
    act(() => {
      result.current[1]({ expression: "*/5 * * * *" });
    });
    expect(result.current[0].expression).toBe("*/5 * * * *");
  });

  it("setState with default value removes from URL (clean URLs)", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?count=10"),
    });
    expect(result.current[0].count).toBe(10);

    act(() => {
      result.current[1]({ count: 5 });
    });
    expect(result.current[0].count).toBe(5);
  });

  it("does not write values exceeding max length", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), { wrapper });
    const longValue = "x".repeat(2000);

    act(() => {
      result.current[1]({ expression: longValue });
    });
    // Should fall back to default since the long value is not written
    expect(result.current[0].expression).toBe("0 * * * *");
  });

  it("handles partial updates preserving other values", () => {
    const { result } = renderHook(() => useUrlState(SCHEMA), {
      wrapper: wrapperWithSearch("?expression=test&count=10"),
    });

    act(() => {
      result.current[1]({ count: 20 });
    });
    expect(result.current[0].expression).toBe("test");
    expect(result.current[0].count).toBe(20);
  });
});
