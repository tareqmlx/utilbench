import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../tools/types";
import { ToolCard } from "../ToolCard";

const TOOL: ToolDefinition = {
  name: "Sample Tool",
  slug: "sample-tool",
  description: "demo description",
  category: "data",
  tags: [],
  featured: false,
  icon: "Braces",
  route: () => Promise.resolve({ default: () => null }),
};

describe("ToolCard", () => {
  afterEach(cleanup);

  it("renders the tool name, description, and category label", () => {
    render(
      <MemoryRouter>
        <ToolCard tool={TOOL} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Sample Tool")).toBeInTheDocument();
    expect(screen.getByText("demo description")).toBeInTheDocument();
    expect(screen.getByText(/Data & JSON/i)).toBeInTheDocument();
  });

  it("renders a link pointing to /tools/<slug>", () => {
    render(
      <MemoryRouter>
        <ToolCard tool={TOOL} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tools/sample-tool");
  });

  it("uses correct category label for each category", () => {
    for (const [cat, label] of [
      ["media", /Media & Assets/i],
      ["data", /Data & JSON/i],
      ["text", /Text & Code/i],
    ] as const) {
      cleanup();
      render(
        <MemoryRouter>
          <ToolCard tool={{ ...TOOL, category: cat }} />
        </MemoryRouter>,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
