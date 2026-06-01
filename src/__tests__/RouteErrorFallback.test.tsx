import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestError } from "../lib/errorReport";
import { RouteErrorFallback } from "../router";

function Boom(): never {
  throw new Error("route boom");
}

describe("RouteErrorFallback", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("captures router-level errors and renders a Report button", async () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RouteErrorFallback /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /report an issue/i })).toBeInTheDocument();
    expect(latestError()?.message).toContain("route boom");
    expect(latestError()?.source).toBe("RouteErrorFallback");
  });
});
