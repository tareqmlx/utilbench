import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function ProblemChild() {
  throw new Error("Test error");
}

function GoodChild() {
  return <div>All good</div>;
}

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <RootErrorBoundary>
        <GoodChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("catches error and shows fallback UI", () => {
    render(
      <RootErrorBoundary>
        <ProblemChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload Page/ })).toBeInTheDocument();
  });

  it("shows error details in DEV mode", () => {
    render(
      <RootErrorBoundary>
        <ProblemChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("reload button calls window.location.reload", () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    render(
      <RootErrorBoundary>
        <ProblemChild />
      </RootErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reload Page/ }));

    expect(reloadMock).toHaveBeenCalledOnce();
  });
});
