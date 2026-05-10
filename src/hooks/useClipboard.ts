import { useCallback, useEffect, useRef, useState } from "react";

export function useClipboard(resetDelay = 1500) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetDelay);
        return true;
      } catch {
        return false;
      }
    },
    [resetDelay],
  );

  const readClipboard = useCallback(async (): Promise<string | null> => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }, []);

  return { copied, copy, readClipboard };
}
