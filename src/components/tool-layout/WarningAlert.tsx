import { cn } from "@/lib/utils";
import { TriangleAlert, X } from "lucide-react";

interface WarningAlertProps {
  warning: string | null;
  className?: string;
  testId?: string;
  onDismiss?: () => void;
}

export function WarningAlert({ warning, className, testId, onDismiss }: WarningAlertProps) {
  if (warning === null) return null;

  return (
    <output
      className={cn(
        "wb-fade-in mt-4 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-lemon px-4 py-3 shadow-pop-2",
        className,
      )}
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-ink"
        strokeWidth={2.5}
      />
      <p data-testid={testId} className="flex-1 font-mono text-[13px] leading-relaxed text-ink">
        {warning}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss warning"
          className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-md text-ink transition-colors hover:text-tomato focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-lemon sm:-mr-1 sm:-mt-1 sm:size-7"
        >
          <X className="size-4" strokeWidth={2.5} />
        </button>
      )}
    </output>
  );
}
