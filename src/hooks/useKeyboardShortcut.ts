import { useEffect } from "react";

export interface KeyboardShortcut {
  key: string;
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcut(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      for (const shortcut of shortcuts) {
        if (shortcut.enabled === false) continue;
        if (shortcut.meta && !(e.metaKey || e.ctrlKey)) continue;
        if (!shortcut.meta && (e.metaKey || e.ctrlKey)) continue;
        if (shortcut.shift && !e.shiftKey) continue;
        if (!shortcut.shift && e.shiftKey) continue;
        if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;

        // Skip non-meta shortcuts when focus is in input/textarea
        if (!shortcut.meta && isInput) continue;

        e.preventDefault();
        shortcut.handler();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
