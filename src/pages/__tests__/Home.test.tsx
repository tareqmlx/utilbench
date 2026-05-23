import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Component as Home } from "../Home";

function renderHome() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("Home page", () => {
  afterEach(cleanup);

  it("renders hero headline + privacy CTA", () => {
    renderHome();
    expect(screen.getByText(/A workbench/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /privacy bit/i })).toHaveAttribute("href", "/privacy");
  });

  it("links the Browse CTA to /tools", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /Browse the workbench/i })).toHaveAttribute(
      "href",
      "/tools",
    );
  });

  it("renders category chip links", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /^Media$/i })).toHaveAttribute(
      "href",
      "/tools?cat=media",
    );
    expect(screen.getByRole("link", { name: /^Data$/i })).toHaveAttribute(
      "href",
      "/tools?cat=data",
    );
    expect(screen.getByRole("link", { name: /^Text$/i })).toHaveAttribute(
      "href",
      "/tools?cat=text",
    );
  });

  it("renders feature blocks 01/02/03", () => {
    renderHome();
    expect(screen.getByText("01.")).toBeInTheDocument();
    expect(screen.getByText("02.")).toBeInTheDocument();
    expect(screen.getByText("03.")).toBeInTheDocument();
  });

  it("renders 'View every tool' CTA", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /View every tool/i })).toHaveAttribute(
      "href",
      "/tools",
    );
  });
});
