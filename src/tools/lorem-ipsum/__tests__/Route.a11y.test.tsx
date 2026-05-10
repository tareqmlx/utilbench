import LoremIpsumRoute from "@/tools/lorem-ipsum/Route";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

function renderRoute() {
  return render(<LoremIpsumRoute />);
}

describe("LoremIpsumRoute accessibility", () => {
  it("amount input has an associated label", () => {
    renderRoute();

    const input = screen.getByLabelText("Amount");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id", "lorem-amount");
  });

  it("switches have associated labels", () => {
    renderRoute();

    const startSwitch = screen.getByLabelText(/Start with/);
    expect(startSwitch).toBeInTheDocument();

    const htmlSwitch = screen.getByLabelText("Add HTML tags");
    expect(htmlSwitch).toBeInTheDocument();
  });

  it("tabs are present with accessible triggers", () => {
    renderRoute();

    const tablists = screen.getAllByRole("tablist");
    expect(tablists.length).toBeGreaterThanOrEqual(1);

    // Radix Tabs may render duplicate elements (e.g. in StrictMode), so
    // use getAllByRole and verify at least one of each trigger exists
    const paragraphTabs = screen.getAllByRole("tab", { name: "Paragraphs" });
    expect(paragraphTabs.length).toBeGreaterThanOrEqual(1);

    const wordTabs = screen.getAllByRole("tab", { name: "Words" });
    expect(wordTabs.length).toBeGreaterThanOrEqual(1);

    const byteTabs = screen.getAllByRole("tab", { name: "Bytes" });
    expect(byteTabs.length).toBeGreaterThanOrEqual(1);
  });

  it("passes axe accessibility scan", async () => {
    const { container } = renderRoute();

    const results = await axe(container, {
      rules: {
        "color-contrast": { enabled: false },
        // Radix Tabs without TabsContent causes aria-controls to reference
        // missing IDs; this is a known jsdom/Radix artifact
        "aria-valid-attr-value": { enabled: false },
        // Route is rendered outside ToolPage chrome so heading order (h1->h3)
        // and duplicate main landmarks are expected in isolation
        "heading-order": { enabled: false },
        "landmark-no-duplicate-main": { enabled: false },
      },
    });

    expect(results).toHaveNoViolations();
  });
});
