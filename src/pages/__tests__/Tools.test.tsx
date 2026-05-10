import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { getAllTools } from "../../tools/registry";
import { Component as ToolsPage } from "../Tools";

function renderAt(initialUrl: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialUrl]}>
        <ToolsPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("Tools page — category URL sync", () => {
  afterEach(cleanup);

  it("filters to media tools when ?cat=media", () => {
    renderAt("/tools?cat=media");
    const all = getAllTools();
    const media = all.filter((t) => t.category === "media");
    const nonMedia = all.filter((t) => t.category !== "media");

    for (const t of media) {
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
    for (const t of nonMedia) {
      expect(screen.queryByText(t.name)).toBeNull();
    }
  });

  it("falls back to all when ?cat is missing", () => {
    renderAt("/tools");
    for (const t of getAllTools()) {
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
  });

  it("falls back to all when ?cat is invalid", () => {
    renderAt("/tools?cat=bogus");
    for (const t of getAllTools()) {
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
  });
});
