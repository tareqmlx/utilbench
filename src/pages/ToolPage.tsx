import { Suspense, lazy, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { FeatureCards } from "../components/FeatureCards";
import { APP_NAME } from "../config";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { getIcon } from "../lib/icons";
import { JsonLd, SEOHead, buildBreadcrumbSchema, buildSoftwareApplicationSchema } from "../seo";
import { getToolBySlug, getToolsByCategory } from "../tools/registry";
import { getSkeletonForSlug } from "../tools/skeletonRegistry";
import type { ToolCategory, ToolDefinition } from "../tools/types";

const categoryLabel: Record<ToolCategory, string> = {
  media: "Media",
  data: "Data",
  text: "Text",
};

const flavorCycle = [
  "wb-tile--pink",
  "wb-tile--lilac",
  "wb-tile--mint",
  "wb-tile--sky",
  "wb-tile--bg2",
  "wb-tile--bg3",
] as const;

function RelatedTile({ tool, index }: { tool: ToolDefinition; index: number }) {
  const Icon = getIcon(tool.icon);
  const ref = useScrollReveal<HTMLAnchorElement>({ delay: index * 60 });
  return (
    <Link
      ref={ref}
      to={`/tools/${tool.slug}`}
      className={`wb-tile wb-reveal ${flavorCycle[index % flavorCycle.length]}`}
    >
      <span className="icn">
        <Icon className="size-[22px]" strokeWidth={2} />
      </span>
      <h3>{tool.name}</h3>
      <p>{tool.description}</p>
      <span className="arrow">Open →</span>
    </Link>
  );
}

export function Component() {
  const { toolSlug } = useParams<{ toolSlug: string }>();
  const tool = toolSlug ? getToolBySlug(toolSlug) : undefined;
  const ToolRoute = useMemo(() => (tool ? lazy(tool.route) : null), [tool]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scroll on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [toolSlug]);

  const ToolSkeleton = toolSlug ? getSkeletonForSlug(toolSlug) : null;

  const relatedTools = useMemo(() => {
    if (!tool) return [];
    return getToolsByCategory(tool.category)
      .filter((t) => t.slug !== tool.slug)
      .slice(0, 3);
  }, [tool]);

  if (!tool) {
    return (
      <div className="wb-shell py-24 text-center">
        <SEOHead title={`Tool Not Found | ${APP_NAME}`} noIndex />
        <h1 className="wb-h1" style={{ fontSize: "clamp(36px,5vw,56px)" }}>
          Tool not <em style={{ color: "var(--tomato)" }}>found</em>.
        </h1>
        <p className="mt-4 text-[15px]" style={{ color: "var(--ink-2)" }}>
          We couldn&apos;t find a tool called <code className="wb-kbd">{toolSlug}</code>.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/tools" className="wb-btn">
            Browse all tools →
          </Link>
        </div>
      </div>
    );
  }

  const seoDescription = tool.seoDescription ?? tool.description;
  const ToolIcon = getIcon(tool.icon);

  return (
    <>
      <SEOHead
        title={`${tool.name} | ${APP_NAME}`}
        description={seoDescription}
        canonicalPath={`/tools/${tool.slug}`}
      />
      <JsonLd data={buildSoftwareApplicationSchema(tool)} />
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
          { name: tool.name },
        ])}
      />

      <div className="wb-shell pt-9">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]"
          style={{ color: "var(--ink-3)" }}
        >
          <Link to="/" className="wb-link-soft hover:text-ink">
            Utilbench
          </Link>
          <span style={{ opacity: 0.4 }}>/</span>
          <Link to="/tools" className="wb-link-soft hover:text-ink">
            Tools
          </Link>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: "var(--ink-3)" }}>{categoryLabel[tool.category]}</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span className="font-medium" style={{ color: "var(--ink)" }}>
            {tool.name}
          </span>
        </nav>

        {/* page hero */}
        <section
          className="mt-5 grid gap-7 pb-9 lg:grid-cols-[auto_1fr] lg:items-center"
          style={{ borderBottom: "2px solid var(--ink)" }}
        >
          <div
            className="wb-fade-in grid place-items-center border-2 border-ink"
            style={{
              width: 96,
              height: 96,
              borderRadius: 18,
              background: "var(--lemon)",
              boxShadow: "var(--pop-3)",
              transform: "rotate(-4deg)",
            }}
          >
            <ToolIcon className="size-11" strokeWidth={2} />
          </div>
          <div className="wb-fade-in" style={{ animationDelay: "80ms" }}>
            <h1 className="wb-h1 mb-3" style={{ fontSize: "clamp(40px,6.5vw,72px)" }}>
              {tool.name.split(" ")[0]}
              {tool.name.split(" ").length > 1 && (
                <em style={{ color: "var(--tomato)" }}>
                  {" "}
                  {tool.name.split(" ").slice(1).join(" ")}
                </em>
              )}
              {tool.name.split(" ").length === 1 && <em style={{ color: "var(--tomato)" }}>.</em>}
            </h1>
            <p
              className="max-w-[60ch] text-[16px] leading-relaxed"
              style={{ color: "var(--ink-2)" }}
            >
              {tool.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className="wb-sticker wb-sticker--mint">
                <span className="dot" style={{ background: "var(--grass)" }} />
                all-local
              </span>
              <span className="wb-sticker wb-sticker--sky">
                <span className="dot" />
                {categoryLabel[tool.category]}
              </span>
            </div>
          </div>
        </section>
      </div>

      <Suspense
        key={toolSlug}
        fallback={
          ToolSkeleton ? (
            <ToolSkeleton tool={tool} />
          ) : (
            <div className="wb-shell py-12 text-center">
              <p className="wb-mono-sm" style={{ color: "var(--ink-2)" }}>
                Loading {tool.name}…
              </p>
            </div>
          )
        }
      >
        {ToolRoute ? <ToolRoute /> : null}
      </Suspense>

      {tool.features && tool.features.length > 0 && (
        <div className="wb-shell">
          <FeatureCards features={tool.features} />
        </div>
      )}

      {relatedTools.length > 0 && (
        <section className="wb-shell pt-12 pb-12" style={{ borderTop: "2px solid var(--ink)" }}>
          <div className="mb-7 flex flex-wrap items-center gap-3.5">
            <span
              className="rounded-full bg-ink px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-paper"
              style={{ border: "2px solid var(--ink)" }}
            >
              Sibling tools
            </span>
            <h2 className="wb-h2" style={{ fontSize: "clamp(28px,3.5vw,36px)" }}>
              You might also <em style={{ color: "var(--ink-3)" }}>need</em>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {relatedTools.map((related, i) => (
              <RelatedTile key={related.slug} tool={related} index={i} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
