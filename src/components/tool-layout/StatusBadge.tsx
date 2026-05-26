import { cn } from "@/lib/utils";

export type StatusTone = "valid" | "invalid" | "neutral";

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

const toneClasses: Record<StatusTone, { surface: string; dot: string }> = {
  valid: { surface: "bg-mint text-ink", dot: "bg-grass" },
  invalid: { surface: "bg-paper text-tomato", dot: "bg-tomato" },
  neutral: { surface: "bg-paper-2 text-ink-2", dot: "bg-ink-3" },
};

export function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  const { surface, dot } = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider",
        surface,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
