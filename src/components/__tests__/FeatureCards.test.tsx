import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeatureCards } from "../FeatureCards";

describe("FeatureCards", () => {
  afterEach(cleanup);

  it("renders one card per feature", () => {
    render(
      <FeatureCards
        features={[
          { icon: "Braces", title: "Alpha", description: "first feature" },
          { icon: "Braces", title: "Beta", description: "second feature" },
          { icon: "Braces", title: "Gamma", description: "third feature" },
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("first feature")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("renders an empty section when given no features", () => {
    const { container } = render(<FeatureCards features={[]} />);
    expect(container.querySelector("section")).toBeInTheDocument();
    expect(container.querySelectorAll("h3")).toHaveLength(0);
  });
});
