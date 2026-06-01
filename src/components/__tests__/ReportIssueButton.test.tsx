import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportIssueButton } from "../ReportIssueButton";

describe("ReportIssueButton", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a GitHub new-issue URL in a new tab on click", () => {
    render(<ReportIssueButton variant="footer" />);
    fireEvent.click(screen.getByRole("button", { name: /report an issue/i }));

    expect(openSpy).toHaveBeenCalledOnce();
    const [url, target, features] = openSpy.mock.calls[0] ?? [];
    expect(url).toContain("https://github.com/tareqmlx/utilbench/issues/new");
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
  });

  it("renders the compact header variant", () => {
    render(<ReportIssueButton variant="header" />);
    expect(screen.getByRole("button", { name: /report an issue/i })).toBeInTheDocument();
  });
});
