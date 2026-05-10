import { useCallback, useEffect, useRef, useState } from "react";

function buildKey(toolSlug: string): string {
  return `utilbench:prefs:${toolSlug}`;
}

function readStored<T extends Record<string, unknown>>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaults;

    // Merge: only keep keys that exist in defaults (forward-compatible)
    const merged = { ...defaults };
    for (const k of Object.keys(defaults)) {
      if (k in parsed && typeof parsed[k] === typeof defaults[k]) {
        merged[k as keyof T] = parsed[k];
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function useToolPreferences<T extends Record<string, unknown>>(
  toolSlug: string,
  defaults: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const key = buildKey(toolSlug);
  const defaultsRef = useRef(defaults);

  const [prefs, setPrefs] = useState<T>(() => readStored(key, defaults));

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Persist to localStorage with 300ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(prefs));
      } catch {
        /* quota or private browsing */
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [key, prefs]);

  const updatePrefs = useCallback((patch: Partial<T>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs(defaultsRef.current);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  return [prefs, updatePrefs, resetPrefs];
}
