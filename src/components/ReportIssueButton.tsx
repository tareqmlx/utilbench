import { type ScrubbedError, buildIssueUrl, latestError } from "@/lib/errorReport";
import { cn } from "@/lib/utils";
import { Bug } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  /** Visual slot. "menu" matches the mobile Sheet nav items. */
  variant?: "header" | "footer" | "menu" | "error";
  /**
   * Contextual error. OMIT it (global header/footer buttons) to report the
   * buffer's latest. Pass it explicitly (error screens) to report exactly that
   * error — an explicit `null` (not yet captured) yields an env-only report and
   * never falls back to stale global state.
   */
  error?: ScrubbedError | null;
  className?: string;
}

/**
 * Opens a prefilled GitHub new-issue URL in a new tab on click. The prefilled
 * body is strictly anonymous (see errorReport.ts).
 */
export function ReportIssueButton({ variant = "footer", error, className }: Props) {
  const handleClick = () => {
    // `undefined` = prop omitted → report the global latest. Explicit `null` =
    // caller has no captured error yet → env-only, no stale-global fallback.
    const resolved = error === undefined ? latestError() : error;
    const url = buildIssueUrl({ error: resolved });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (variant === "error") {
    return (
      <Button variant="outline" onClick={handleClick} className={className}>
        <Bug className="size-4" />
        Report an issue
      </Button>
    );
  }

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label="Report an issue"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border-2 border-ink bg-lemon px-3.5 py-2 text-[13px] font-semibold text-ink transition-[background,transform] duration-200 hover:-translate-y-px hover:bg-mint",
          className,
        )}
      >
        <Bug className="size-3.5" strokeWidth={2.5} />
        <span>Report</span>
      </button>
    );
  }

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-md px-3 py-3 text-left text-[15px] font-medium text-foreground transition-colors hover:bg-muted",
          className,
        )}
      >
        <Bug className="size-4" />
        Report an issue
      </button>
    );
  }

  // footer
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex min-h-11 items-center text-left text-paper transition-colors hover:text-lemon sm:min-h-0",
        className,
      )}
    >
      Report an issue
    </button>
  );
}
