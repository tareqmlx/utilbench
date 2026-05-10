import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface IconSwapProps {
  swapKey: string | number | boolean;
  children: ReactNode;
  className?: string;
}

export function IconSwap({ swapKey, children, className }: IconSwapProps) {
  return (
    <span
      key={String(swapKey)}
      className={cn(
        "inline-flex items-center gap-2 animate-in fade-in-0 zoom-in-95 duration-200",
        className,
      )}
    >
      {children}
    </span>
  );
}
