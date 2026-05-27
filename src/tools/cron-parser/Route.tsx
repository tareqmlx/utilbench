import { Cron } from "croner";
import cronstrue from "cronstrue";
import { Calendar, Check, Clock, Copy } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  ErrorAlert,
  PaneHeader,
  StatusBadge,
  type StatusTone,
  ToolShell,
} from "../../components/tool-layout";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useUrlState } from "../../hooks/useUrlState";

const PRESETS: Record<string, string> = {
  "Every minute": "* * * * *",
  "Every hour": "0 * * * *",
  "Daily at midnight": "0 0 * * *",
  "Every Sunday": "0 0 * * 0",
  "Monthly on the 1st": "0 0 1 * *",
};

const PRESET_ENTRIES = Object.entries(PRESETS);

interface ParseResult {
  description: string | null;
  nextRuns: Date[];
  error: string | null;
}

function parseCron(expr: string): ParseResult {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { description: null, nextRuns: [], error: null };
  }

  try {
    const description = cronstrue.toString(trimmed, {
      throwExceptionOnParseError: true,
      use24HourTimeFormat: true,
    });
    const nextRuns = new Cron(trimmed).nextRuns(5);
    return { description, nextRuns, error: null };
  } catch (e) {
    return {
      description: null,
      nextRuns: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface FormattedExecution {
  dayLabel: string;
  date: string;
  time: string;
}

function formatExecution(date: Date): FormattedExecution {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let dayLabel: string;
  if (target.getTime() === today.getTime()) {
    dayLabel = "Today";
  } else if (target.getTime() === tomorrow.getTime()) {
    dayLabel = "Tomorrow";
  } else {
    dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }

  const dateStr = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);

  const timeStr = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return { dayLabel, date: dateStr, time: timeStr };
}

function getTimezoneDisplay(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const offset =
    minutes > 0 ? `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}` : `UTC${sign}${hours}`;
  return `${tz} (${offset})`;
}

const DEFAULT_EXPRESSION = "0 * * * *";

const URL_SCHEMA = {
  expression: { type: "string" as const, defaultValue: DEFAULT_EXPRESSION },
};

const ERROR_ID = "cron-error";
const DESCRIPTION_ID = "cron-interpretation";

export default function CronParserRoute() {
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const expression = urlState.expression;
  const [description, setDescription] = useState<string | null>(
    () => parseCron(expression).description,
  );
  const [nextRuns, setNextRuns] = useState<Date[]>(() => parseCron(expression).nextRuns);
  const [error, setError] = useState<string | null>(() => parseCron(expression).error);
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useClipboard();

  const activePreset = PRESET_ENTRIES.find(([, v]) => v === expression)?.[0] ?? null;
  const trimmed = expression.trim();
  const runsKey = nextRuns.length > 0 ? (nextRuns[0]?.toISOString() ?? "empty") : "empty";

  const statusTone: StatusTone = !trimmed ? "neutral" : error !== null ? "invalid" : "valid";
  const statusLabel = !trimmed ? "Empty" : error !== null ? "Error" : "Valid";

  const applyExpression = useCallback(
    (value: string) => {
      setUrlState({ expression: value });
      const result = parseCron(value);
      setDescription(result.description);
      setNextRuns(result.nextRuns);
      setError(result.error);
    },
    [setUrlState],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyExpression(e.target.value);
    },
    [applyExpression],
  );

  const handlePresetClick = useCallback(
    (label: string, expr: string) => {
      applyExpression(expr);
      setStatus(`Preset applied: ${label}.`);
    },
    [applyExpression],
  );

  const handleCopy = useCallback(() => {
    if (!expression) return;
    copy(expression);
  }, [copy, expression]);

  useEffect(() => {
    if (copied) setStatus("Expression copied to clipboard.");
  }, [copied]);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "c",
          meta: true,
          shift: true,
          handler: handleCopy,
          enabled: expression.length > 0,
        },
        {
          key: "/",
          meta: true,
          handler: () => inputRef.current?.focus(),
        },
      ],
      [handleCopy, expression.length],
    ),
  );

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="space-y-6 lg:col-span-7">
          <div className="overflow-hidden rounded-lg border-2 border-ink bg-paper shadow-pop-3">
            <PaneHeader
              label="Cron Expression"
              htmlFor="cron-expression-input"
              trailing={
                <span key={statusTone} className="wb-fade-in inline-flex">
                  <StatusBadge tone={statusTone} label={statusLabel} />
                </span>
              }
            />

            <div className="space-y-6 p-5 sm:p-7">
              <div className="relative">
                <input
                  ref={inputRef}
                  id="cron-expression-input"
                  type="text"
                  value={expression}
                  onChange={handleInputChange}
                  placeholder="e.g. */5 * * * *"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-invalid={error !== null}
                  aria-describedby={error !== null ? ERROR_ID : DESCRIPTION_ID}
                  className="h-16 w-full rounded-md border-2 border-ink bg-paper px-5 pr-16 font-mono text-2xl tabular-nums tracking-wider text-ink shadow-pop-1 transition-shadow duration-150 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!expression}
                  aria-label="Copy expression"
                  title="Copy expression (⌘⇧C)"
                  className="absolute top-1/2 right-3 grid size-11 -translate-y-1/2 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-shadow duration-150 hover:shadow-pop-2 focus-visible:shadow-pop-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-pop-1 sm:size-10"
                >
                  <IconSwap swapKey={copied}>
                    {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                  </IconSwap>
                </button>
              </div>

              <div id={DESCRIPTION_ID}>
                <span className="mb-3 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Interpretation
                </span>
                {error ? (
                  <ErrorAlert error={error} id={ERROR_ID} className="!mt-0" testId="cron-error" />
                ) : description ? (
                  <div
                    key={description}
                    className="wb-fade-in rounded-lg border-2 border-ink bg-lemon p-5 shadow-pop-1"
                  >
                    <p
                      data-testid="cron-description"
                      className="text-lg font-medium leading-snug text-ink sm:text-xl"
                    >
                      &ldquo;{description}&rdquo;
                    </p>
                  </div>
                ) : (
                  <div
                    key="placeholder"
                    className="wb-fade-in rounded-lg border-2 border-dashed border-ink/30 bg-paper-2/60 p-5"
                  >
                    <p className="font-mono text-[13px] italic text-ink-3">
                      Enter an expression to see the breakdown.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border-2 border-ink bg-paper-2 shadow-pop-3">
            <PaneHeader
              label="Common Presets"
              trailing={
                <span className="hidden font-mono text-[11px] tabular-nums text-ink-3 sm:inline">
                  {PRESET_ENTRIES.length} ready
                </span>
              }
              className="bg-paper-2"
            />
            <div className="flex flex-wrap gap-2 p-5 sm:p-7">
              {PRESET_ENTRIES.map(([label, expr]) => {
                const isActive = label === activePreset;
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => handlePresetClick(label, expr)}
                    aria-pressed={isActive}
                    className={`wb-chip ${isActive ? "on" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-ink bg-paper shadow-pop-3">
            <PaneHeader
              label="Next 5 Executions"
              trailing={
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-md border-2 border-ink bg-mint text-ink shadow-pop-1"
                >
                  <Calendar className="size-3.5" strokeWidth={2.5} />
                </span>
              }
            />

            <div key={runsKey} className="flex-1 space-y-2 p-5 sm:p-7">
              {nextRuns.length > 0 ? (
                nextRuns.map((run, i) => {
                  const fmt = formatExecution(run);
                  const first = i === 0;
                  return (
                    <div
                      key={run.toISOString()}
                      style={{ "--wb-row-delay": `${i * 40}ms` } as CSSProperties}
                      className={`wb-diff-row flex items-center justify-between rounded-md border-2 border-ink px-4 py-3 transition-shadow duration-150 ${
                        first ? "bg-lemon shadow-pop-1" : "bg-paper-2"
                      }`}
                    >
                      <div className="flex flex-col">
                        <span
                          className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
                            first ? "text-ink" : "text-ink-3"
                          }`}
                        >
                          {fmt.dayLabel}
                        </span>
                        <span className="text-[15px] font-medium tabular-nums text-ink">
                          {fmt.date}
                        </span>
                      </div>
                      <span className="font-mono text-xl tabular-nums text-ink">{fmt.time}</span>
                    </div>
                  );
                })
              ) : (
                <div
                  data-testid="no-executions"
                  className="wb-fade-in rounded-md border-2 border-dashed border-ink/30 bg-paper-2/60 px-4 py-8 text-center"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                    No upcoming executions
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t-2 border-ink bg-paper px-[18px] py-[14px] text-ink-3">
              <Clock className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums">
                Local Time Zone: {getTimezoneDisplay()}
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 hidden items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 lg:flex">
        <span className="inline-flex items-center gap-1.5">
          <KbdHint>⌘⇧C</KbdHint> copy
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          <KbdHint>⌘/</KbdHint> focus expression
        </span>
      </p>
    </ToolShell>
  );
}
