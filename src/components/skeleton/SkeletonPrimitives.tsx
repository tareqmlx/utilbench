import { cn } from "../../lib/utils";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-[14px] border-2 border-ink/20 bg-paper-2", className)}
    />
  );
}

export function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className = "",
}: { width?: string; height?: string; className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-paper-3", width, height, className)} />;
}

export function SkeletonTextArea({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn("rounded-[18px] border-2 border-ink bg-paper p-5", className)}
      style={{ boxShadow: "var(--pop-2)" }}
    >
      <div className="space-y-3">
        <div className="h-3 w-full animate-pulse rounded-md bg-paper-3" />
        <div className="h-3 w-11/12 animate-pulse rounded-md bg-paper-3" />
        <div className="h-3 w-4/5 animate-pulse rounded-md bg-paper-3" />
        <div className="h-3 w-full animate-pulse rounded-md bg-paper-3" />
        <div className="h-3 w-3/4 animate-pulse rounded-md bg-paper-3" />
        <div className="h-3 w-5/6 animate-pulse rounded-md bg-paper-3" />
      </div>
    </div>
  );
}

export function SkeletonButton({
  width = "w-24",
  className = "",
}: { width?: string; className?: string }) {
  return (
    <div
      className={cn(
        "h-10 animate-pulse rounded-[14px] border-2 border-ink bg-paper-2",
        width,
        className,
      )}
    />
  );
}

export function SkeletonCircle({
  size = "size-10",
  className = "",
}: { size?: string; className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-full border-2 border-ink bg-paper-2", size, className)}
    />
  );
}
