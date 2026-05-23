import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Component as ToolPage } from "../ToolPage";

function renderAt(path: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tools/:toolSlug" element={<ToolPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("ToolPage", () => {
  afterEach(cleanup);

  it("renders not-found UI for an unknown slug", () => {
    renderAt("/tools/__no_such_tool__");
    expect(screen.getByText(/Tool not/i)).toBeInTheDocument();
    expect(screen.getByText("__no_such_tool__")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse all tools/i })).toHaveAttribute(
      "href",
      "/tools",
    );
  });

  it("renders breadcrumb + hero for a real tool slug", async () => {
    renderAt("/tools/base64-encoder");
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Utilbench/i })).toHaveAttribute("href", "/");
    // Title contains the tool name (split across spans)
    expect(screen.getAllByText(/Base64/i).length).toBeGreaterThan(0);
    // Lazy-loaded route eventually renders
    await waitFor(() => {
      expect(screen.getByText(/all-local/i)).toBeInTheDocument();
    });
  });
});
