import { SearchModal } from "@/components/SearchModal";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

function renderSearchModal(isOpen: boolean) {
  return render(
    <MemoryRouter>
      <SearchModal isOpen={isOpen} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("SearchModal accessibility", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a dialog when open", () => {
    renderSearchModal(true);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });

  it("has search input with accessible placeholder", () => {
    renderSearchModal(true);

    const inputs = screen.getAllByPlaceholderText("Search utilities...");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    expect(inputs[0]).toBeInTheDocument();
  });

  it("does not expose a visible dialog when closed", () => {
    renderSearchModal(false);

    // Radix Dialog does not render portal content when open={false},
    // so no dialog role element should be present
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeInTheDocument();
  });

  it("passes axe accessibility scan when open", async () => {
    const { container } = renderSearchModal(true);

    const results = await axe(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(results).toHaveNoViolations();
  });
});
