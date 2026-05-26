import { Cron } from "croner";
import cronstrue from "cronstrue";
import { Calendar, Check, Clock, Copy } from "lucide-react";
import { useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { useClipboard } from "../../hooks/useClipboard";
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

export default function CronParserRoute() {
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const expression = urlState.expression;
  const [description, setDescription] = useState<string | null>(
    () => parseCron(expression).description,
  );
  const [nextRuns, setNextRuns] = useState<Date[]>(() => parseCron(expression).nextRuns);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  const activePreset = PRESET_ENTRIES.find(([, v]) => v === expression)?.[0] ?? null;

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setUrlState({ expression: value });
    const result = parseCron(value);
    setDescription(result.description);
    setNextRuns(result.nextRuns);
    setError(result.error);
  }

  function handlePresetClick(expr: string) {
    setUrlState({ expression: expr });
    const result = parseCron(expr);
    setDescription(result.description);
    setNextRuns(result.nextRuns);
    setError(result.error);
  }

  function handleCopy() {
    copy(expression);
  }

  return (
    <ToolShell>
      <div className="space-y-10">
        <section className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-lg border-2 border-ink bg-paper p-5 shadow-pop-3 sm:p-7">
              <label
                htmlFor="cron-expression-input"
                className="mb-3 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
              >
                Cron Expression
              </label>
              <div className="relative">
                <input
                  id="cron-expression-input"
                  type="text"
                  value={expression}
                  onChange={handleInputChange}
                  placeholder="e.g. */5 * * * *"
                  className="h-16 w-full rounded-md border-2 border-ink bg-paper px-5 pr-16 font-mono text-2xl tracking-wider text-ink shadow-pop-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy expression"
                  className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-transform hover:-translate-y-[calc(50%+2px)]"
                >
                  <IconSwap swapKey={copied}>
                    {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                  </IconSwap>
                </button>
              </div>

              <div className="mt-6">
                <span className="mb-3 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Interpretation
                </span>
                {error ? (
                  <ErrorAlert error={error} className="!mt-0" testId="cron-error" />
                ) : description ? (
                  <div className="rounded-lg border-2 border-ink bg-lemon p-5 shadow-pop-1">
                    <p
                      data-testid="cron-description"
                      className="text-lg font-medium leading-snug text-ink sm:text-xl"
                    >
                      &ldquo;{description}&rdquo;
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border-2 border-ink bg-paper-2 p-5 shadow-pop-1">
                    <p className="font-mono text-[13px] italic text-ink-3">
                      Enter an expression to see the breakdown.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border-2 border-ink bg-paper-2 p-5 shadow-pop-3 sm:p-7">
              <span className="mb-4 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                Common Presets
              </span>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_ENTRIES.map(([label, expr]) => {
                  const isActive = label === activePreset;
                  return (
                    <button
                      type="button"
                      key={label}
                      onClick={() => handlePresetClick(expr)}
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
            <div className="h-full rounded-lg border-2 border-ink bg-paper p-5 shadow-pop-3 sm:p-7">
              <div className="mb-6 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Next 5 Executions
                </span>
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-md border-2 border-ink bg-mint text-ink shadow-pop-1"
                >
                  <Calendar className="size-4" strokeWidth={2.5} />
                </span>
              </div>

              <div className="space-y-2.5">
                {nextRuns.length > 0 ? (
                  nextRuns.map((run, i) => {
                    const fmt = formatExecution(run);
                    const first = i === 0;
                    return (
                      <div
                        key={run.toISOString()}
                        className={`flex items-center justify-between rounded-md border-2 border-ink px-4 py-3 ${
                          first ? "bg-lemon shadow-pop-1" : "bg-paper-2"
                        }`}
                      >
                        <div className="flex flex-col">
                          <span
                            className={`font-mono text-[10.5px] uppercase tracking-[0.12em] ${
                              first ? "text-ink" : "text-ink-3"
                            }`}
                          >
                            {fmt.dayLabel}
                          </span>
                          <span className="text-[15px] font-medium text-ink">{fmt.date}</span>
                        </div>
                        <span className="font-mono text-xl text-ink">{fmt.time}</span>
                      </div>
                    );
                  })
                ) : (
                  <p
                    data-testid="no-executions"
                    className="font-mono text-[13px] italic text-ink-3"
                  >
                    No upcoming executions
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center gap-2 border-t-2 border-ink pt-5 text-ink-3">
                <Clock className="size-3.5" strokeWidth={2.5} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">
                  Local Time Zone: {getTimezoneDisplay()}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </ToolShell>
  );
}
