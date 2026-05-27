import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PaneHeaderProps {
  label: string;
  labelId?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  htmlFor?: string;
  className?: string;
}

export function PaneHeader({
  label,
  labelId,
  icon,
  actions,
  trailing,
  htmlFor,
  className,
}: PaneHeaderProps) {
  const labelClasses = "font-mono uppercase tracking-wider text-[11px] text-ink-3";

  const labelContent = icon ? (
    <span className="flex items-center gap-2 text-ink-2">
      {icon}
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className={labelClasses}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={labelClasses}>
          {label}
        </span>
      )}
    </span>
  ) : htmlFor ? (
    <label id={labelId} htmlFor={htmlFor} className={labelClasses}>
      {label}
    </label>
  ) : (
    <span id={labelId} className={labelClasses}>
      {label}
    </span>
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b-2 border-ink bg-paper px-[18px] py-[14px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {labelContent}
        {trailing}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
