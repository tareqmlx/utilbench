import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaneHeader } from "../PaneHeader";

describe("PaneHeader", () => {
  afterEach(cleanup);

  it("renders label as span when htmlFor is not set", () => {
    render(<PaneHeader label="Output" />);
    const el = screen.getByText("Output");
    expect(el.tagName).toBe("SPAN");
  });

  it("renders label as label element when htmlFor is set", () => {
    render(<PaneHeader label="Input" htmlFor="my-input" />);
    const el = screen.getByText("Input");
    expect(el.tagName).toBe("LABEL");
    expect(el).toHaveAttribute("for", "my-input");
  });

  it("renders icon when provided", () => {
    render(<PaneHeader label="Input" icon={<span data-testid="icon">IC</span>} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders actions when provided", () => {
    render(<PaneHeader label="Input" actions={<button type="button">Copy</button>} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("renders label with icon and htmlFor together", () => {
    render(<PaneHeader label="Field" htmlFor="field" icon={<span data-testid="icon">IC</span>} />);
    const label = screen.getByText("Field");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "field");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("applies className pass-through", () => {
    const { container } = render(<PaneHeader label="Test" className="h-10" />);
    expect(container.firstChild).toHaveClass("h-10");
  });
});
