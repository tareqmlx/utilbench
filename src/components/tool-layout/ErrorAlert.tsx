import { cn } from "@/lib/utils";
import { CircleAlert } from "lucide-react";

interface ErrorAlertProps {
  error: string | null;
  className?: string;
}

export function ErrorAlert({ error, className }: ErrorAlertProps) {
  if (error === null) return null;

  return (
    <div
      role="alert"
      className={cn(
        "wb-fade-in mt-4 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-paper px-4 py-3",
        className,
      )}
      style={{ boxShadow: "5px 5px 0 var(--tomato)" }}
    >
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-tomato" strokeWidth={2.5} />
      <p className="font-mono text-[13px] leading-relaxed text-ink">{error}</p>
    </div>
  );
}
