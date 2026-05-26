import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { SEOHead } from "../seo";

export function Component() {
  const iconRef = useScrollReveal<HTMLDivElement>();
  const headingRef = useScrollReveal<HTMLHeadingElement>({ delay: 80 });
  const bodyRef = useScrollReveal<HTMLParagraphElement>({ delay: 160 });
  const ctaRef = useScrollReveal<HTMLDivElement>({ delay: 240 });

  return (
    <div className="wb-shell py-16 text-center sm:py-24">
      <SEOHead title="Page Not Found | Utilbench" noIndex />
      <div
        ref={iconRef}
        className="wb-reveal mx-auto mb-6 grid size-24 -rotate-[4deg] place-items-center rounded-lg border-2 border-ink bg-lemon shadow-pop-3"
      >
        <Compass className="size-11" strokeWidth={2} />
      </div>
      <h1 ref={headingRef} className="wb-reveal wb-h1" style={{ fontSize: "clamp(40px,6vw,72px)" }}>
        Page <em className="text-tomato">missing</em>.
      </h1>
      <p
        ref={bodyRef}
        className="wb-reveal mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-2"
      >
        The page you&apos;re looking for isn&apos;t on this workbench. Try the toolbox instead.
      </p>
      <div ref={ctaRef} className="wb-reveal mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link to="/" className="wb-btn">
          Back to home →
        </Link>
        <Link to="/tools" className="wb-btn wb-btn--ghost">
          Browse tools
        </Link>
      </div>
    </div>
  );
}
