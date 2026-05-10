import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { getIcon } from "../lib/icons";
import { JsonLd, SEOHead, buildOrganizationSchema, buildWebSiteSchema } from "../seo";
import { getAllTools, getFeaturedTools } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";

const flavorCycle = [
  "wb-tile--pink",
  "wb-tile--lilac",
  "wb-tile--mint",
  "wb-tile--sky",
  "wb-tile--bg2",
  "wb-tile--bg3",
] as const;

function tileFlavor(index: number, isFeatured: boolean) {
  if (isFeatured && index === 0) return "wb-tile--lemon";
  return flavorCycle[index % flavorCycle.length];
}

function TileIcon({ icon }: { icon: string }) {
  const Icon = getIcon(icon);
  return (
    <span className="icn">
      <Icon className="size-[22px]" strokeWidth={2} />
    </span>
  );
}

function HomeTile({
  tool,
  index,
  size = "m",
  showStar = false,
}: {
  tool: ToolDefinition;
  index: number;
  size?: "l" | "m" | "q" | "s";
  showStar?: boolean;
}) {
  const flavor = tileFlavor(index, showStar && index === 0);
  const colSpan =
    size === "l"
      ? "lg:col-span-6"
      : size === "m"
        ? "lg:col-span-4"
        : size === "q"
          ? "lg:col-span-4"
          : "lg:col-span-3";

  const ref = useScrollReveal<HTMLAnchorElement>({ delay: Math.min(index * 40, 240) });
  return (
    <Link
      ref={ref}
      to={`/tools/${tool.slug}`}
      className={`wb-tile wb-reveal ${flavor} col-span-1 sm:col-span-3 ${colSpan}`}
    >
      {showStar ? <span className="pin">{index === 0 ? "★ FEATURED" : "★"}</span> : null}
      <TileIcon icon={tool.icon} />
      <h3 style={size === "l" ? { fontSize: 32 } : undefined}>{tool.name}</h3>
      <p>{tool.description}</p>
      <span className="arrow">Open →</span>
    </Link>
  );
}

function FeatBlock({
  feat,
  index,
}: {
  feat: { num: string; title: string; body: string };
  index: number;
}) {
  const ref = useScrollReveal<HTMLDivElement>({ delay: index * 80 });
  return (
    <div
      ref={ref}
      className="wb-reveal border-2 border-ink p-6"
      style={{ background: "var(--bg-2)", borderRadius: 18 }}
    >
      <div className="wb-display" style={{ fontSize: 64, color: "var(--tomato)" }}>
        {feat.num}
      </div>
      <h4 className="wb-h3 mt-2" style={{ fontSize: 22 }}>
        {feat.title}
      </h4>
      <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {feat.body}
      </p>
    </div>
  );
}

export function Component() {
  const featured = getFeaturedTools();
  const all = getAllTools();
  const featuredSlugs = new Set(featured.map((t) => t.slug));
  const rest = all.filter((t) => !featuredSlugs.has(t.slug));
  const totalTools = all.length;
  const workbenchHeaderRef = useScrollReveal<HTMLDivElement>();

  return (
    <div>
      <SEOHead
        title="Utilbench — A workbench for the browser."
        description="A friendly little toolbox of developer utilities — formatters, decoders, generators — all running on your device, none of them phoning home."
        canonicalPath="/"
      />
      <JsonLd data={buildOrganizationSchema()} />
      <JsonLd data={buildWebSiteSchema()} />

      {/* HERO */}
      <section className="wb-shell relative overflow-hidden pt-16 pb-12 sm:pt-20 sm:pb-16">
        {/* floating stickers — desktop only; would overlap headings/CTAs on mobile */}
        <div className="pointer-events-none hidden md:block">
          <span
            className="wb-sticker wb-sticker--pink absolute"
            style={{ top: 56, left: "6%", transform: "rotate(-6deg)" }}
          >
            <span className="dot" />
            {totalTools} utilities
          </span>
          <span
            className="wb-sticker wb-sticker--mint absolute"
            style={{ top: 30, right: "8%", transform: "rotate(5deg)" }}
          >
            <span className="dot" style={{ background: "var(--grass)" }} />
            private by default
          </span>
          <span
            className="wb-sticker wb-sticker--sky absolute"
            style={{ bottom: 24, right: "4%", transform: "rotate(-4deg)" }}
          >
            ★ all free
          </span>
        </div>

        <h1
          className="wb-display relative z-10 text-center"
          style={{
            fontSize: "clamp(40px,9vw,148px)",
            overflowWrap: "anywhere",
          }}
        >
          <span className="block">A workbench</span>
          <span className="block" style={{ color: "var(--tomato)" }}>
            for the <em>browser</em>.
          </span>
          <span className="block">
            <span
              className="inline-block px-4 pb-1 sm:px-5"
              style={{
                background: "var(--lemon)",
                border: "2px solid var(--ink)",
                borderRadius: 18,
                transform: "rotate(-2deg)",
                boxShadow: "4px 4px 0 var(--ink)",
              }}
            >
              No servers needed.
            </span>
          </span>
        </h1>

        <p
          className="mx-auto mt-7 max-w-[62ch] text-center text-base leading-relaxed sm:text-lg"
          style={{ color: "var(--ink-2)" }}
        >
          Utilbench is a friendly little toolbox of{" "}
          <b
            className="font-semibold"
            style={{ background: "var(--mint)", padding: "1px 6px", borderRadius: 6 }}
          >
            {totalTools} developer utilities
          </b>{" "}
          — formatters, decoders, generators — all running on your device, none of them phoning
          home. Pick a sticker and get to work.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/tools" className="wb-btn">
            Browse the workbench →
          </Link>
          <Link to="/privacy" className="wb-btn wb-btn--ghost">
            Read the privacy bit
          </Link>
        </div>
      </section>

      {/* WORKBENCH WALL */}
      <section id="tools" className="wb-shell pb-16">
        <div
          className="flex flex-wrap items-end justify-between gap-4 pt-12 pb-6 wb-reveal"
          ref={workbenchHeaderRef}
        >
          <div className="flex items-baseline gap-3.5">
            <span
              className="rounded-full bg-ink px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-paper"
              style={{ border: "2px solid var(--ink)" }}
            >
              § The workbench
            </span>
            <h2 className="wb-h2" style={{ fontSize: "clamp(32px,4.5vw,48px)" }}>
              Pick a tile, <em style={{ color: "var(--ink-3)" }}>start tinkering.</em>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/tools" className="wb-chip on">
              All · {totalTools}
            </Link>
            <Link to="/tools?cat=media" className="wb-chip">
              Media
            </Link>
            <Link to="/tools?cat=data" className="wb-chip">
              Data
            </Link>
            <Link to="/tools?cat=text" className="wb-chip">
              Text
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6 sm:gap-[18px] lg:grid-cols-12">
          {featured[0] && <HomeTile tool={featured[0]} index={0} size="l" showStar />}
          {featured.slice(1, 4).map((tool, i) => (
            <HomeTile key={tool.slug} tool={tool} index={i + 1} size="m" showStar />
          ))}
          {rest.slice(0, 3).map((tool, i) => {
            const idx = featured.length + i;
            return <HomeTile key={tool.slug} tool={tool} index={idx} size="q" />;
          })}
          {rest.slice(3, 7).map((tool, i) => {
            const idx = featured.length + 3 + i;
            return <HomeTile key={tool.slug} tool={tool} index={idx} size="s" />;
          })}
          {rest.slice(7, 10).map((tool, i) => {
            const idx = featured.length + 7 + i;
            return <HomeTile key={tool.slug} tool={tool} index={idx} size="q" />;
          })}
          {rest.slice(10).map((tool, i) => {
            const idx = featured.length + 10 + i;
            return <HomeTile key={tool.slug} tool={tool} index={idx} size="s" />;
          })}
        </div>

        <div className="mt-10 flex justify-center">
          <Link to="/tools" className="wb-btn wb-btn--ghost">
            View every tool
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </Link>
        </div>

        {/* FEATURES ROW */}
        <div className="mt-16 grid gap-[18px] lg:grid-cols-3">
          {[
            {
              num: "01.",
              title: "Local from byte one",
              body: "Every transform runs on your device. The bundle is the surface area — no hidden round-trips.",
            },
            {
              num: "02.",
              title: "Keyboard-first",
              body: "⌘K opens the palette. Fuzzy search across every tool. Mouse-optional throughout the entire suite.",
            },
            {
              num: "03.",
              title: "Free, MIT",
              body: "Open source forever. Add a tool, file an issue, or fork it for your team — the code is the manifesto.",
            },
          ].map((feat, i) => (
            <FeatBlock key={feat.num} feat={feat} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
