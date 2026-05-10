import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorAlert } from "../ErrorAlert";

describe("ErrorAlert", () => {
  afterEach(cleanup);

  it("renders nothing when error is null", () => {
    const { container } = render(<ErrorAlert error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders alert with error message", () => {
    render(<ErrorAlert error="Something went wrong" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("applies destructive variant", () => {
    render(<ErrorAlert error="Bad input" />);
    const alert = screen.getByRole("alert");
    // Workbench error styling: tomato hard-offset shadow signals destructive intent
    expect(alert.style.boxShadow).toContain("var(--tomato)");
  });

  it("applies className pass-through", () => {
    render(<ErrorAlert error="Error" className="mt-8" />);
    expect(screen.getByRole("alert")).toHaveClass("mt-8");
  });
});
