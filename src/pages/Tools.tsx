import { Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useUrlState } from "../hooks/useUrlState";
import { getIcon } from "../lib/icons";
import { JsonLd, SEOHead, buildBreadcrumbSchema } from "../seo";
import { getAllTools } from "../tools/registry";
import type { ToolCategory, ToolDefinition } from "../tools/types";

type CategoryKey = ToolCategory | "all";

const categories: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "media", label: "Media" },
  { key: "data", label: "Data" },
  { key: "text", label: "Text" },
];

const VALID_CATEGORIES: ReadonlySet<CategoryKey> = new Set(["all", "media", "data", "text"]);

const URL_SCHEMA = {
  cat: { type: "string" as const, defaultValue: "all" },
};

const flavorCycle = [
  "wb-tile--pink",
  "wb-tile--lilac",
  "wb-tile--mint",
  "wb-tile--sky",
  "wb-tile--bg2",
  "wb-tile--bg3",
] as const;

function tileFlavor(index: number) {
  if (index === 0) return "wb-tile--lemon";
  return flavorCycle[(index - 1) % flavorCycle.length];
}

function ToolTile({ tool, index }: { tool: ToolDefinition; index: number }) {
  const Icon = getIcon(tool.icon);
  const pin = tool.featured ? "★ FEATURED" : tool.category.toUpperCase();
  return (
    <Link
      to={`/tools/${tool.slug}`}
      className={`wb-tile ${tileFlavor(index)}`}
      style={{ ["--i" as string]: Math.min(index, 12) }}
    >
      <span className="pin">{pin}</span>
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
  const allTools = getAllTools();
  const [search, setSearch] = useState("");
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeCategory: CategoryKey = VALID_CATEGORIES.has(urlState.cat as CategoryKey)
    ? (urlState.cat as CategoryKey)
    : "all";
  const setActiveCategory = (next: CategoryKey) => setUrlState({ cat: next });

  const trimmedQuery = search.toLowerCase().trim();

  // Tools that match the search query (ignoring active category) — used to
  // recompute per-category chip counts so they reflect the current search.
  const searchMatchedTools = useMemo(() => {
    if (!trimmedQuery) return allTools;
    return allTools.filter((tool) => {
      const haystack = [tool.name, tool.description, ...tool.tags].join(" ").toLowerCase();
      return haystack.includes(trimmedQuery);
    });
  }, [allTools, trimmedQuery]);

  const filteredTools = useMemo(() => {
    return searchMatchedTools.filter((tool) => {
      if (activeCategory !== "all" && tool.category !== activeCategory) return false;
      return true;
    });
  }, [searchMatchedTools, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      all: searchMatchedTools.length,
      media: 0,
      data: 0,
      text: 0,
    };
    for (const tool of searchMatchedTools) {
      counts[tool.category] += 1;
    }
    return counts;
  }, [searchMatchedTools]);

  const handleClearFilters = () => {
    setSearch("");
    setActiveCategory("all");
  };

  return (
    <div className="wb-shell pt-10 pb-16">
      <SEOHead
        title="All Tools | Utilbench"
        description={`Browse ${allTools.length}+ free online toolbox utilities. JSON formatter, Base64 encoder, image resizer, and more. All running locally with zero data collection.`}
        canonicalPath="/tools"
      />
      <JsonLd data={buildBreadcrumbSchema([{ name: "Home", url: "/" }, { name: "All Tools" }])} />

      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
      >
        <Link to="/" className="wb-link-soft hover:text-ink">
          Home
        </Link>
        <span className="opacity-40">/</span>
        <span className="font-medium text-ink">Tools</span>
      </nav>

      {/* page hero */}
      <section className="grid gap-7 border-b-2 border-ink py-7 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="wb-tools-icon grid size-24 -rotate-[4deg] place-items-center rounded-lg border-2 border-ink bg-lemon shadow-pop-3">
          <Search className="size-11" strokeWidth={2} />
        </div>
        <div>
          <h1 className="wb-tools-rise wb-tools-rise--1 wb-h1 wb-h1--page mb-3.5">
            All <em className="text-tomato">tools</em>.
          </h1>
          <p className="wb-tools-rise wb-tools-rise--2 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            Every utility on the workbench, in one searchable index.{" "}
            <strong className="wb-hl">{allTools.length} tools</strong> across three categories, all
            running on your device.
          </p>
          <div className="wb-tools-rise wb-tools-rise--3 mt-4 flex flex-wrap gap-2.5">
            <span className="wb-sticker wb-sticker--mint">
              <span className="dot bg-grass" />
              all-local
            </span>
            <span className="wb-sticker wb-sticker--sky">
              <span className="dot" />
              ⌘K to search
            </span>
          </div>
        </div>
      </section>

      {/* search + filters */}
      <div className="wb-tools-rise wb-tools-rise--4 mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex w-full max-w-md items-center gap-2.5 rounded-[14px] border-2 border-ink bg-paper px-3 py-2.5 text-[14px] shadow-pop-2">
          <Search className="size-4 shrink-0" strokeWidth={2} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools by name, description, or tag…"
            aria-label="Search tools"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
          />
        </label>

        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Filter by category</legend>
          {categories.map((cat) => {
            const active = activeCategory === cat.key;
            const count = categoryCounts[cat.key];
            const empty = count === 0 && !active;
            return (
              <button
                type="button"
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                aria-pressed={active}
                disabled={empty}
                aria-disabled={empty}
                className={`wb-chip ${active ? "on" : ""}`}
              >
                {cat.label}
                {` · ${count}`}
              </button>
            );
          })}
        </fieldset>
      </div>

      <p aria-live="polite" className="sr-only">
        {filteredTools.length} tool{filteredTools.length === 1 ? "" : "s"} shown
      </p>

      {/* tile wall */}
      <h2 className="sr-only">Tool index</h2>
      {filteredTools.length > 0 ? (
        <div
          key={activeCategory}
          className="wb-tools-grid mt-9 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {filteredTools.map((tool, i) => (
            <ToolTile key={tool.slug} tool={tool} index={i} />
          ))}
        </div>
      ) : (
        <div className="wb-fade-in mt-9 flex flex-col items-center gap-3 rounded-lg border-2 border-ink bg-paper-2 p-12 text-center shadow-pop-3">
          <SearchX className="size-12" strokeWidth={2} />
          <h3 className="wb-h3">No tools found</h3>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Try a different search term or category.
          </p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="wb-btn wb-btn--ghost wb-btn--sm mt-2"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
