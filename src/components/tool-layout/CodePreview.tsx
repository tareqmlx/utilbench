import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CodePreviewProps {
  children: ReactNode;
  className?: string;
  emptyHint?: string;
  isEmpty?: boolean;
}

export function CodePreview({ children, className, emptyHint, isEmpty }: CodePreviewProps) {
  return (
    <div
      className={cn(
        "relative overflow-auto rounded-lg border-2 border-ink bg-ink p-5 shadow-pop-3",
        className,
      )}
    >
      {isEmpty && emptyHint ? (
        <p className="font-mono text-[12px] italic text-ink-muted">{emptyHint}</p>
      ) : (
        <pre className="font-mono text-sm leading-relaxed text-paper">{children}</pre>
      )}
    </div>
  );
}
