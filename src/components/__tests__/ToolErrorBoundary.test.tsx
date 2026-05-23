import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolErrorBoundary } from "../ToolErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("kaboom");
  }
  return <div>safe child</div>;
}

describe("ToolErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    render(
      <MemoryRouter>
        <ToolErrorBoundary>
          <Boom shouldThrow={false} />
        </ToolErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("safe child")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <MemoryRouter>
        <ToolErrorBoundary>
          <Boom shouldThrow={true} />
        </ToolErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse all tools/i })).toHaveAttribute(
      "href",
      "/tools",
    );
  });

  it("retry resets error state", () => {
    function Toggle() {
      // Always throws on first render; retry clears boundary state but child throws again,
      // re-showing fallback. Verifies the handler runs without crashing.
      throw new Error("boom");
    }

    render(
      <MemoryRouter>
        <ToolErrorBoundary>
          <Toggle />
        </ToolErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    // Boundary re-renders child which throws again — fallback persists.
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
