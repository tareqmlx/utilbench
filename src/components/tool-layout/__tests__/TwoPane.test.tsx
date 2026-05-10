import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TwoPane } from "../TwoPane";

describe("TwoPane", () => {
  afterEach(cleanup);

  it("renders left and right children", () => {
    render(<TwoPane left={<div>Left</div>} right={<div>Right</div>} />);
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
  });

  it("defaults to gap-6", () => {
    const { container } = render(<TwoPane left={<div>L</div>} right={<div>R</div>} />);
    expect(container.firstChild).toHaveClass("gap-6");
  });

  it("applies custom gap", () => {
    const { container } = render(<TwoPane left={<div>L</div>} right={<div>R</div>} gap="8" />);
    expect(container.firstChild).toHaveClass("gap-8");
    expect(container.firstChild).not.toHaveClass("gap-6");
  });

  it("applies className pass-through", () => {
    const { container } = render(
      <TwoPane left={<div>L</div>} right={<div>R</div>} className="min-h-96" />,
    );
    expect(container.firstChild).toHaveClass("min-h-96");
  });

  it("includes responsive grid classes", () => {
    const { container } = render(<TwoPane left={<div>L</div>} right={<div>R</div>} />);
    expect(container.firstChild).toHaveClass("grid-cols-1");
    expect((container.firstChild as HTMLElement).className).toContain("lg:grid-cols-2");
  });
});
