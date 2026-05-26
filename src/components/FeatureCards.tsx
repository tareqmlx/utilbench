import { useScrollReveal } from "../hooks/useScrollReveal";
import { getIcon } from "../lib/icons";
import type { ToolFeature } from "../tools/types";

const flavorCycle = ["bg-mint", "bg-sky", "bg-pink", "bg-lilac", "bg-paper-2"] as const;

interface FeatureCardsProps {
  features: ToolFeature[];
}

function FeatureCard({ feature, index }: { feature: ToolFeature; index: number }) {
  const Icon = getIcon(feature.icon);
  const ref = useScrollReveal<HTMLDivElement>({ delay: index * 60 });
  return (
    <div
      ref={ref}
      className={`wb-reveal relative rounded-lg border-2 border-ink p-6 shadow-pop-3 ${flavorCycle[index % flavorCycle.length]}`}
    >
      <div className="mb-3 grid size-12 place-items-center rounded-[12px] border-2 border-ink bg-paper text-ink">
        <Icon className="size-6" strokeWidth={2} />
      </div>
      <h3 className="font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {feature.title}
      </h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{feature.description}</p>
    </div>
  );
}

export function FeatureCards({ features }: FeatureCardsProps) {
  return (
    <section className="mt-14 grid grid-cols-1 gap-[18px] md:grid-cols-3">
      {features.map((feature, i) => (
        <FeatureCard key={feature.title} feature={feature} index={i} />
      ))}
    </section>
  );
}
