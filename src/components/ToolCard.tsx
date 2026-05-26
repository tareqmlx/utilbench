import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { getIcon } from "../lib/icons";
import type { ToolCategory, ToolDefinition } from "../tools/types";

const categoryLabels: Record<ToolCategory, string> = {
  media: "Media & Assets",
  data: "Data & JSON",
  text: "Text & Code",
};

const flavors = [
  { bg: "bg-pink", icn: "bg-paper" },
  { bg: "bg-lilac", icn: "bg-paper" },
  { bg: "bg-mint", icn: "bg-paper" },
  { bg: "bg-sky", icn: "bg-paper" },
  { bg: "bg-paper-2", icn: "bg-lemon" },
  { bg: "bg-paper-3", icn: "bg-pink" },
] as const;

function flavorForSlug(slug: string) {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) {
    sum += slug.charCodeAt(i);
  }
  const idx = sum % flavors.length;
  return flavors[idx] ?? flavors[0];
}

interface ToolCardProps {
  tool: ToolDefinition;
}

export function ToolCard({ tool }: ToolCardProps) {
  const Icon = getIcon(tool.icon);
  const flavor = flavorForSlug(tool.slug);
  const ref = useScrollReveal<HTMLAnchorElement>();

  return (
    <Link
      ref={ref}
      to={`/tools/${tool.slug}`}
      className={cn(
        "wb-reveal group relative flex h-full flex-col rounded-[18px] border-2 border-ink p-5 shadow-pop-3 transition-transform duration-150 hover:-translate-x-[2px] hover:-translate-y-[2px]",
        flavor.bg,
      )}
    >
      <span className="absolute right-4 top-4 font-mono text-[10px] uppercase tracking-wider text-ink-2">
        {categoryLabels[tool.category]}
      </span>

      <div
        className={cn(
          "mb-4 flex size-12 items-center justify-center rounded-[12px] border-2 border-ink",
          flavor.icn,
        )}
      >
        <Icon className="size-6 text-ink" strokeWidth={2} />
      </div>

      <h3 className="font-display text-[22px] font-bold leading-tight text-ink">{tool.name}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{tool.description}</p>

      <div className="mt-auto flex items-center gap-1.5 pt-4 font-mono text-[12px] uppercase tracking-wider text-ink">
        <span>Open</span>
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2.5}
        />
      </div>
    </Link>
  );
}
