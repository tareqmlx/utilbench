import { useEffect, useRef, useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";

type Phase = "enter" | "exit";

const EXIT_DURATION_MS = 200;

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();

  const [displayed, setDisplayed] = useState(() => ({
    outlet,
    key: location.pathname,
  }));
  const [phase, setPhase] = useState<Phase>("enter");
  const pendingRef = useRef<{ outlet: typeof outlet; key: string } | null>(null);

  useEffect(() => {
    if (location.pathname === displayed.key) return;

    if (prefersReducedMotion()) {
      setDisplayed({ outlet, key: location.pathname });
      window.scrollTo(0, 0);
      return;
    }

    pendingRef.current = { outlet, key: location.pathname };
    setPhase("exit");
  }, [location.pathname, outlet, displayed.key]);

  useEffect(() => {
    if (phase !== "exit") return;
    const timer = window.setTimeout(() => {
      const next = pendingRef.current;
      if (!next) {
        setPhase("enter");
        return;
      }
      pendingRef.current = null;
      setDisplayed(next);
      setPhase("enter");
      window.scrollTo(0, 0);
    }, EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div key={displayed.key} className="wb-page" data-phase={phase}>
      {displayed.outlet}
    </div>
  );
}
