import { useEffect, useRef } from "react";

interface ScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  delay?: number;
}

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.12,
  rootMargin = "0px 0px -8% 0px",
  delay = 0,
}: ScrollRevealOptions = {}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-revealed");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            if (delay > 0) {
              window.setTimeout(() => target.classList.add("is-revealed"), delay);
            } else {
              target.classList.add("is-revealed");
            }
            observer.unobserve(target);
          }
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, delay]);

  return ref;
}
