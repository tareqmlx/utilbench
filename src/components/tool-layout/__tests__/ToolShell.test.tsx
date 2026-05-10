import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolShell } from "../ToolShell";

describe("ToolShell", () => {
  afterEach(cleanup);

  it("renders children inside the shell section", () => {
    render(<ToolShell>Hello</ToolShell>);
    const shell = screen.getByTestId("tool-shell");
    expect(shell).toHaveTextContent("Hello");
  });

  it("does not render its own <main> landmark", () => {
    render(<ToolShell>Content</ToolShell>);
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("applies default wb-shell width", () => {
    render(<ToolShell>Content</ToolShell>);
    const shell = screen.getByTestId("tool-shell");
    expect(shell.className).toContain("wb-shell");
  });

  it("applies wide variant", () => {
    render(<ToolShell variant="wide">Content</ToolShell>);
    const shell = screen.getByTestId("tool-shell");
    expect(shell.className).toContain("max-w-300");
    expect(shell.className).not.toContain("wb-shell");
  });

  it("applies className pass-through", () => {
    render(<ToolShell className="extra-class">Content</ToolShell>);
    const shell = screen.getByTestId("tool-shell");
    expect(shell.className).toContain("extra-class");
  });

  it("always includes base padding classes", () => {
    render(<ToolShell>Content</ToolShell>);
    const shell = screen.getByTestId("tool-shell");
    expect(shell.className).toContain("py-8");
  });
});
