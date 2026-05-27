import { cn } from "@/lib/utils";
import { CircleAlert, X } from "lucide-react";

interface ErrorAlertProps {
  error: string | null;
  className?: string;
  testId?: string;
  id?: string;
  onDismiss?: () => void;
}

export function ErrorAlert({ error, className, testId, id, onDismiss }: ErrorAlertProps) {
  if (error === null) return null;

  return (
    <div
      role="alert"
      id={id}
      className={cn(
        "wb-fade-in mt-4 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-paper px-4 py-3 shadow-pop-cta",
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-tomato" strokeWidth={2.5} />
      <p data-testid={testId} className="flex-1 font-mono text-[13px] leading-relaxed text-ink">
        {error}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:-mr-1 sm:-mt-1 sm:size-7"
        >
          <X className="size-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
