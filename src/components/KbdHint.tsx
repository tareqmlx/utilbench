interface KbdHintProps {
  children: string;
}

export function KbdHint({ children }: KbdHintProps) {
  return (
    <kbd className="pointer-events-none hidden select-none rounded-md border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-3 shadow-[1px_1px_0_var(--ink)] lg:inline-block">
      {children}
    </kbd>
  );
}
