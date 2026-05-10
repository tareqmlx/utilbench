import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const variantMap = {
  default: "wb-shell",
  wide: "mx-auto w-full max-w-300 px-4 sm:px-6 lg:px-8",
} as const;

interface ToolShellProps {
  variant?: keyof typeof variantMap;
  className?: string;
  children: ReactNode;
}

export function ToolShell({ variant = "default", className, children }: ToolShellProps) {
  return (
    <section
      data-testid="tool-shell"
      className={cn("py-8 sm:py-12", variantMap[variant], className)}
    >
      {children}
    </section>
  );
}
