interface KbdHintProps {
  children: string;
}

export function KbdHint({ children }: KbdHintProps) {
  return (
    <kbd className="pointer-events-none hidden select-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-block">
      {children}
    </kbd>
  );
}
