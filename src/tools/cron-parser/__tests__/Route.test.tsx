import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CronParserRoute from "../Route";

describe("CronParserRoute", () => {
  const clipboardMock = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardMock,
      writable: true,
      configurable: true,
    });
    clipboardMock.writeText.mockResolvedValue(undefined);
    clipboardMock.readText.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
  });

  function getInput() {
    return screen.getByPlaceholderText(/e\.g\. \*\/5/) as HTMLInputElement;
  }

  function setInput(value: string) {
    fireEvent.change(getInput(), { target: { value } });
  }

  function getDescription() {
    return screen.queryByTestId("cron-description");
  }

  function getError() {
    return screen.queryByTestId("cron-error");
  }

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    expect(getInput()).toBeInTheDocument();
  });

  it("shows initial parsed state for default expression", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    expect(getInput()).toHaveValue("0 * * * *");
    // cronstrue returns "Every hour" for "0 * * * *"
    expect(getDescription()).toHaveTextContent(/Every hour/i);
  });

  it("input field is editable", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("*/5 * * * *");
    expect(getInput()).toHaveValue("*/5 * * * *");
  });

  it("typing triggers live parsing with correct description", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("0 0 * * *");
    expect(getDescription()).toHaveTextContent(/At 00:00/i);
  });

  it("invalid expression shows error message", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("not a cron");
    expect(getError()).toBeInTheDocument();
    expect(getDescription()).not.toBeInTheDocument();
  });

  it("error clears on valid re-parse", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );

    setInput("invalid-cron");
    expect(getError()).toBeInTheDocument();

    setInput("*/5 * * * *");
    expect(getError()).not.toBeInTheDocument();
    expect(getDescription()).toHaveTextContent(/Every 5 minutes/i);
  });

  it("preset buttons set expression and auto-parse", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Every Sunday" }));
    expect(getInput()).toHaveValue("0 0 * * 0");
    expect(getDescription()).toHaveTextContent(/At 00:00, only on Sunday/i);
  });

  it("active preset gets highlighted styling", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    // Default is "0 * * * *" which matches "Every hour"
    const everyHourBtn = screen.getByRole("button", { name: "Every hour" });
    expect(everyHourBtn.className).toContain("bg-primary");
    expect(everyHourBtn.className).toContain("text-primary-foreground");

    // Other presets should not be active (they use outline variant)
    const everySundayBtn = screen.getByRole("button", { name: "Every Sunday" });
    expect(everySundayBtn.className).not.toContain("text-primary-foreground");
  });

  it("copy button calls clipboard.writeText", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy expression/ }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith("0 * * * *");
  });

  it("next 5 executions display after parse", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    // Initial parse of "0 * * * *" should show 5 execution entries with day labels
    const execEntries = screen.getAllByText(
      /Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/,
    );
    expect(execEntries.length).toBeGreaterThanOrEqual(5);
  });

  it("timezone shows local timezone", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(screen.getByText(new RegExp(tz))).toBeInTheDocument();
  });

  it("typing parses live without explicit submit", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("0 0 1 * *");
    expect(getDescription()).toHaveTextContent(/At 00:00, on day 1 of the month/i);
  });

  it("empty expression shows placeholder", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("");
    expect(screen.getByText(/Enter an expression/)).toBeInTheDocument();
  });

  it("shows no upcoming executions for empty input", () => {
    render(
      <MemoryRouter>
        <CronParserRoute />
      </MemoryRouter>,
    );
    setInput("");
    expect(screen.getByTestId("no-executions")).toBeInTheDocument();
  });
});
