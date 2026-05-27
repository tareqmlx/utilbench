import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CodePreviewProps {
  children: ReactNode;
  className?: string;
  emptyHint?: string;
  isEmpty?: boolean;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}

export function CodePreview({
  children,
  className,
  emptyHint,
  isEmpty,
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel,
}: CodePreviewProps) {
  const regionProps =
    ariaLabelledBy || ariaLabel
      ? { role: "region" as const, "aria-labelledby": ariaLabelledBy, "aria-label": ariaLabel }
      : {};

  return (
    <div
      {...regionProps}
      className={cn(
        "relative overflow-auto rounded-lg border-2 border-ink bg-ink p-5 shadow-pop-3",
        className,
      )}
    >
      <div key={isEmpty ? "empty" : "filled"} className="animate-in fade-in-0 duration-200">
        {isEmpty && emptyHint ? (
          <p className="font-mono text-[12px] italic text-ink-muted">{emptyHint}</p>
        ) : (
          <pre className="font-mono text-sm leading-relaxed text-paper">{children}</pre>
        )}
      </div>
    </div>
  );
}
