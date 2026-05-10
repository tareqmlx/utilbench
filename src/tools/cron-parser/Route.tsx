import { Cron } from "croner";
import cronstrue from "cronstrue";
import { Calendar, Check, Clock, Copy } from "lucide-react";
import { useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ToolShell } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
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

const OPACITY_CLASSES = ["", "opacity-90", "opacity-80", "opacity-70", "opacity-60"];

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
      <div className="space-y-12">
        <section className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <Card className="p-4 sm:p-8">
              <div className="mb-6">
                <Label
                  htmlFor="cron-expression-input"
                  className="mb-3 block text-sm font-bold tracking-widest text-muted-foreground uppercase"
                >
                  Cron Expression
                </Label>
                <div className="group relative">
                  <Input
                    id="cron-expression-input"
                    type="text"
                    value={expression}
                    onChange={handleInputChange}
                    placeholder="e.g. */5 * * * *"
                    className="h-16 w-full px-6 font-mono text-2xl tracking-wider"
                  />
                  <div className="absolute top-1/2 right-4 flex -translate-y-1/2 gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopy}
                      aria-label="Copy expression"
                    >
                      <IconSwap swapKey={copied}>
                        {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                      </IconSwap>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <span className="mb-3 block text-sm font-bold tracking-widest text-muted-foreground uppercase">
                    Interpretation
                  </span>
                  {error ? (
                    <div className="rounded-r-lg border-l-4 border-red-500 bg-red-500/5 p-5 dark:bg-red-500/10">
                      <p
                        data-testid="cron-error"
                        className="text-xl font-medium text-red-600 dark:text-red-400"
                      >
                        {error}
                      </p>
                    </div>
                  ) : description ? (
                    <div className="rounded-r-lg border-l-4 border-primary bg-primary/5 p-5 dark:bg-primary/10">
                      <p
                        data-testid="cron-description"
                        className="text-xl font-medium text-foreground"
                      >
                        &ldquo;{description}&rdquo;
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-r-lg border-l-4 border-border bg-muted p-5">
                      <p className="text-xl font-medium text-muted-foreground">
                        Enter an expression to see the breakdown.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-4 sm:p-8">
              <span className="mb-4 block text-sm font-bold tracking-widest text-muted-foreground uppercase">
                Common Presets
              </span>
              <div className="flex flex-wrap gap-3">
                {PRESET_ENTRIES.map(([label, expr]) => {
                  const isActive = label === activePreset;

                  return (
                    <Button
                      key={label}
                      variant={isActive ? "default" : "outline"}
                      className={
                        isActive
                          ? ""
                          : "bg-muted text-foreground hover:border-border hover:bg-muted/80"
                      }
                      onClick={() => handlePresetClick(expr)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-5">
            <div className="group relative h-full overflow-hidden rounded-lg border border-border bg-card p-4 sm:p-8">
              <div className="absolute top-0 right-0 -mt-20 -mr-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl transition-all duration-700 group-hover:bg-primary/20" />

              <div className="relative z-10">
                <div className="mb-8 flex items-center justify-between">
                  <span className="text-sm font-bold tracking-widest text-muted-foreground uppercase">
                    Next 5 Executions
                  </span>
                  <Calendar className="h-5 w-5 text-primary" />
                </div>

                <div className="space-y-4">
                  {nextRuns.length > 0 ? (
                    nextRuns.map((run, i) => {
                      const fmt = formatExecution(run);
                      return (
                        <div
                          key={run.toISOString()}
                          className={`flex items-center justify-between rounded border border-border bg-muted/50 p-4 transition-colors hover:border-primary/50 ${OPACITY_CLASSES[i] ?? ""}`}
                        >
                          <div className="flex flex-col">
                            <span
                              className={`text-xs font-bold tracking-tighter uppercase ${i === 0 ? "text-primary" : "text-muted-foreground"}`}
                            >
                              {fmt.dayLabel}
                            </span>
                            <span className="text-lg font-medium text-foreground">{fmt.date}</span>
                          </div>
                          <span className="font-mono text-2xl text-foreground">{fmt.time}</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-muted-foreground" data-testid="no-executions">
                      No upcoming executions
                    </p>
                  )}
                </div>

                <div className="mt-8 border-t border-border pt-8">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span className="text-xs font-bold tracking-widest uppercase">
                      Local Time Zone: {getTimezoneDisplay()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </ToolShell>
  );
}
