import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PaneHeaderProps {
  label: string;
  icon?: ReactNode;
  actions?: ReactNode;
  htmlFor?: string;
  className?: string;
}

export function PaneHeader({ label, icon, actions, htmlFor, className }: PaneHeaderProps) {
  const labelClasses = "font-mono uppercase tracking-wider text-[11px] text-ink-3";

  const labelContent = icon ? (
    <span className="flex items-center gap-2 text-ink-2">
      {icon}
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClasses}>
          {label}
        </label>
      ) : (
        <span className={labelClasses}>{label}</span>
      )}
    </span>
  ) : htmlFor ? (
    <label htmlFor={htmlFor} className={labelClasses}>
      {label}
    </label>
  ) : (
    <span className={labelClasses}>{label}</span>
  );

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b-2 border-ink bg-paper px-[18px] py-[14px]",
        className,
      )}
    >
      {labelContent}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
