import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  q: { type: "string" as const, defaultValue: "" },
};

const SEARCH_INPUT_ID = "tool-search";
const ANNOUNCE_DEBOUNCE_MS = 350;
const SESSION_VISITED_KEY = "utilbench:tools-visited";

const flavorCycle = [
  "wb-tile--pink",
  "wb-tile--lilac",
  "wb-tile--mint",
  "wb-tile--sky",
  "wb-tile--lemon",
  "wb-tile--bg2",
  "wb-tile--bg3",
] as const;

function tileFlavor(index: number): string {
  return flavorCycle[index % flavorCycle.length] ?? flavorCycle[0];
}

function ToolTile({
  tool,
  flavor,
  index,
}: {
  tool: ToolDefinition;
  flavor: string;
  index: number;
}) {
  const Icon = getIcon(tool.icon);
  return (
    <Link
      to={`/tools/${tool.slug}`}
      className={`wb-tile ${flavor}`}
      style={{ ["--i" as string]: Math.min(index, 12) }}
    >
      {tool.featured && (
        <span className="pin">
          <span aria-hidden="true">★ </span>FEATURED
        </span>
      )}
      <span className="icn">
        <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <h3>{tool.name}</h3>
      <p>{tool.description}</p>
      <span className="arrow">
        Open <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

export function Component() {
  const allTools = getAllTools();
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeCategory: CategoryKey = VALID_CATEGORIES.has(urlState.cat as CategoryKey)
    ? (urlState.cat as CategoryKey)
    : "all";
  const setActiveCategory = (next: CategoryKey) => setUrlState({ cat: next });
  const search = urlState.q;
  const setSearch = (next: string) => setUrlState({ q: next });

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
    setUrlState({ q: "", cat: "all" });
  };

  const [announcedCount, setAnnouncedCount] = useState(filteredTools.length);
  useEffect(() => {
    const t = setTimeout(() => setAnnouncedCount(filteredTools.length), ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filteredTools.length]);

  const [animateEntrance] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      if (sessionStorage.getItem(SESSION_VISITED_KEY)) return false;
      sessionStorage.setItem(SESSION_VISITED_KEY, "1");
    } catch {
      // sessionStorage unavailable (private mode quotas, etc.) — animate anyway
    }
    return true;
  });

  return (
    <div className={`wb-shell pt-10 pb-16${animateEntrance ? "" : " wb-tools-skipped"}`}>
      <SEOHead
        title="All Tools | Utilbench"
        description={`${allTools.length} local-only developer tools: JSON formatter, JWT decoder, Base64, QR generator, image resizer, and more. No tracking, runs in your browser.`}
        canonicalPath="/tools"
      />
      <JsonLd data={buildBreadcrumbSchema([{ name: "Home", url: "/" }, { name: "All Tools" }])} />

      <nav aria-label="Breadcrumb">
        <ol className="wb-meta flex items-center gap-2">
          <li>
            <Link to="/" className="wb-link-soft hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-40">
            /
          </li>
          <li>
            <span aria-current="page" className="font-medium text-ink">
              Tools
            </span>
          </li>
        </ol>
      </nav>

      {/* page hero */}
      <section className="grid gap-7 border-b-2 border-ink py-7 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="wb-tools-icon grid size-24 -rotate-[4deg] place-items-center rounded-lg border-2 border-ink bg-lemon shadow-pop-3">
          <Search className="size-11" strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <h1 className="wb-tools-rise wb-tools-rise--1 wb-h1 wb-h1--page mb-3.5">
            All <span className="text-tomato">tools</span>.
          </h1>
          <p className="wb-tools-rise wb-tools-rise--2 max-w-[60ch] text-base leading-relaxed text-ink-2">
            Every utility on the workbench, searchable.{" "}
            <strong className="wb-hl">{allTools.length} tools</strong>, all running on your device.
          </p>
          <div className="wb-tools-rise wb-tools-rise--3 mt-4 flex flex-wrap gap-2.5">
            <span className="wb-sticker wb-sticker--mint">
              <span className="dot bg-grass" />
              all-local
            </span>
            <span className="wb-sticker wb-sticker--sky">
              <span aria-hidden="true">⌘K</span> to search
            </span>
          </div>
        </div>
      </section>

      {/* search + filters */}
      <div className="wb-tools-rise wb-tools-rise--4 mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label
          htmlFor={SEARCH_INPUT_ID}
          className="flex w-full max-w-md items-center gap-2.5 rounded border-2 border-ink bg-paper px-3 py-2.5 text-sm shadow-pop-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tomato"
        >
          <Search className="size-5 shrink-0 sm:size-4" strokeWidth={2} aria-hidden="true" />
          <input
            id={SEARCH_INPUT_ID}
            type="search"
            name="tool-search"
            autoComplete="off"
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
                onClick={() => {
                  if (empty) return;
                  setActiveCategory(cat.key);
                }}
                aria-pressed={active}
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
        {announcedCount} tool{announcedCount === 1 ? "" : "s"} shown
      </p>

      {/* tile wall */}
      <h2 className="sr-only">Tool index</h2>
      {filteredTools.length > 0 ? (
        <div className="wb-tools-grid mt-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredTools.map((tool, i) => (
            <ToolTile key={tool.slug} tool={tool} flavor={tileFlavor(i)} index={i} />
          ))}
        </div>
      ) : (
        <div className="wb-fade-in mt-9 flex flex-col items-center gap-5 rounded-lg border-2 border-ink bg-paper-2 p-10 text-center shadow-pop-3 sm:p-14">
          <div className="grid size-16 -rotate-[3deg] place-items-center rounded border-2 border-ink bg-lemon shadow-pop-2">
            <SearchX className="size-8" strokeWidth={2} aria-hidden="true" />
          </div>
          <h3 className="wb-h2">
            Nothing on <span className="text-tomato">that</span> shelf.
          </h3>
          <p className="max-w-[44ch] text-sm leading-relaxed text-ink-2">
            No tools match your search. Try a different word, or open every drawer at once.
          </p>
          <button type="button" onClick={handleClearFilters} className="wb-btn wb-btn--ghost mt-1">
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
