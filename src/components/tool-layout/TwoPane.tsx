import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const gapMap = {
  "6": "gap-6",
  "8": "gap-8",
} as const;

interface TwoPaneProps {
  left: ReactNode;
  right: ReactNode;
  gap?: keyof typeof gapMap;
  className?: string;
}

export function TwoPane({ left, right, gap = "6", className }: TwoPaneProps) {
  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-2", gapMap[gap], className)}>
      {left}
      {right}
    </div>
  );
}
