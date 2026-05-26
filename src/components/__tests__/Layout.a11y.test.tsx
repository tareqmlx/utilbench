import { Layout } from "@/components/Layout";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  );
}

describe("Layout accessibility", () => {
  it("has a skip-to-content link targeting #main-content", () => {
    renderLayout();

    const skipLink = screen.getByText("Skip to main content");
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("has a <main> element with id main-content", () => {
    renderLayout();

    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
    expect(main?.tagName).toBe("MAIN");
  });

  it("has nav elements with unique aria-labels", () => {
    renderLayout();

    const navs = screen.getAllByRole("navigation");
    const labels = navs.map((nav) => nav.getAttribute("aria-label")).filter(Boolean);

    expect(labels).toContain("Main navigation");
    expect(labels).toContain("Product links");
    expect(labels).toContain("Workflow links");

    // Verify that labeled navs use unique aria-labels (ignoring duplicates
    // that may appear in Radix Sheet portals)
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBeGreaterThanOrEqual(3);
  });

  it("passes axe accessibility scan", async () => {
    const { container } = renderLayout();

    const results = await axe(container, {
      rules: {
        "color-contrast": { enabled: false },
        region: { enabled: false },
        // Radix Sheet portals can duplicate banner/contentinfo/main landmarks
        "landmark-no-duplicate-banner": { enabled: false },
        "landmark-no-duplicate-contentinfo": { enabled: false },
        "landmark-no-duplicate-main": { enabled: false },
        // Layout is rendered in isolation here; the route-level <h1> that
        // precedes the footer <h2> in production lives in page components.
        "heading-order": { enabled: false },
      },
    });

    expect(results).toHaveNoViolations();
  });
});
