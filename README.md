# Utilbench

Fast, private browser utilities for developers. No servers, no tracking — just tools that work.

Utilbench is a client-side utility tools SPA where every tool runs entirely in the browser using Web Workers and WASM for heavy computation. Zero data ever leaves your machine.

## Features

- **17 tools** across data, text, and media categories
- **100% client-side** — no backend, no analytics, no network requests after page load
- **Off-main-thread compute** via a managed Web Worker pool with task queue and timeouts
- **Cached WASM loader** with streaming compilation and ArrayBuffer fallback
- **Cmd/Ctrl + K** global fuzzy search across all tools (Fuse.js)
- **URL-state sync** — many tools serialize settings to the query string so links are shareable
- **Per-tool preferences** persisted to `localStorage` with debounced writes
- **Lazy-loaded routes** with per-tool skeleton loaders
- **SEO-ready** — meta tags, OG images, JSON-LD structured data, auto-generated sitemap
- **Dark and light themes** via `next-themes`

## Tools

### Data & JSON

| Tool | Description |
|------|-------------|
| JSON Formatter | Format, validate, and beautify JSON with syntax highlighting |
| JWT Decoder | Decode and inspect JWT tokens without sending data to a server |
| Base64 Encoder | Encode and decode Base64 strings |
| CSV to JSON | Convert CSV files to JSON with customizable options |
| JSON Schema Generator | Generate JSON Schema from sample JSON data |
| YAML to JSON | Convert YAML data to JSON format |

### Text & Code

| Tool | Description |
|------|-------------|
| Cron Parser | Parse and explain cron expressions in plain English |
| Diff Checker | Compare two texts and highlight differences |
| Case Converter | Convert text between camelCase, snake_case, and more |
| Markdown Preview | Preview Markdown with live rendering and syntax highlighting |
| Lorem Ipsum | Generate placeholder text for designs and mockups |

### Media & Assets

| Tool | Description |
|------|-------------|
| QR Generator | Generate QR codes from text, URLs, or structured data |
| Image Resizer | Resize and crop images directly in the browser |
| SVG Optimizer | Optimize and minify SVG files while preserving visual quality |
| Favicon Generator | Generate favicons in all required sizes from a single image |
| Lottie Previewer | Preview and inspect Lottie animation files |
| Image Metadata Remover | Remove EXIF, GPS, and camera metadata from images locally |

## Tech Stack

- **React 19** + **React Router v7** (lazy-loaded routes)
- **Vite 6** (build & dev server)
- **Tailwind CSS 4** + **shadcn/ui** (utility-first styling + component primitives)
- **TypeScript** (strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
- **Biome** (linting & formatting — replaces ESLint + Prettier)
- **Vitest** + **Testing Library** (jsdom environment)
- **Bun** (package manager & script runner)
- **Fuse.js** (fuzzy search) · **next-themes** (theme switching) · **react-helmet-async** (SEO)

## Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Production build (Vite → OG image → favicon icons)
bun run build

# Vite build only
bun run build:only

# Preview production build
bun run preview

# Lint & format check
bun run check

# Auto-fix lint/format issues
bunx --bun @biomejs/biome check --write ./src
```

## Testing

```bash
bun run test       # watch mode
bun run test:run   # single run
bun run test:ui    # Vitest UI
```

Vitest runs in jsdom with `@testing-library/react` and `@testing-library/jest-dom` matchers. Test files live alongside source as `**/__tests__/*.test.{ts,tsx}`. The shared setup (`src/test/setup.ts`) installs jsdom polyfills required by Radix UI (`ResizeObserver`, `PointerEvent`, pointer-capture, `scrollIntoView`).

Notes:

- Auto-cleanup is **not** enabled — component tests must call `cleanup()` in `afterEach`.
- Tools using `useUrlState` (or any React Router hook) must wrap renders in `<MemoryRouter>`.

## Adding a New Tool

Tools are auto-discovered at build time via `import.meta.glob` — no manual registration. Each tool lives in `src/tools/<tool-slug>/` and exports two files.

**1. `tool.ts`** — named `tool` export of type `ToolDefinition`:

```ts
import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "My Tool",
  slug: "my-tool",
  description: "What it does",
  seoDescription: "Longer description used for meta tags (optional)",
  category: "data",              // "data" | "text" | "media"
  tags: ["tag1", "tag2"],
  featured: false,
  icon: "Wrench",                // Lucide icon name — must also be mapped in src/lib/icons.ts
  route: () => import("./Route"),
  features: [                    // optional — rendered as the three feature cards on the tool page
    { icon: "Zap", title: "Instant", description: "Runs locally in your browser." },
    { icon: "Code", title: "Customizable", description: "Configure to taste." },
    { icon: "Download", title: "Exportable", description: "Copy or download results." },
  ],
};
```

**2. `Route.tsx`** — default-exports the React component (lazy-loaded by the router):

```tsx
import { ToolShell, TwoPane, PaneHeader, ErrorAlert } from "../../components/tool-layout";

export default function Route() {
  return (
    <ToolShell>
      <TwoPane>
        {/* tool UI */}
      </TwoPane>
    </ToolShell>
  );
}
```

**Also remember to:**

- Add the Lucide icon import + mapping entry to `src/lib/icons.ts` (falls back to `Braces` otherwise).
- Add a skeleton entry to `src/components/skeleton/skeletonRegistry.tsx` for the lazy-loading state.

The `Route.tsx` body must start directly with the tool's interactive UI inside a `ToolShell`. Page chrome — breadcrumbs, hero, feature cards, sibling tools — is centralized in `src/pages/ToolPage.tsx` and must **not** be duplicated per tool.

## Architecture

```
src/
├── components/
│   ├── ui/                    # shadcn/ui primitives
│   ├── tool-layout/           # ToolShell, TwoPane, PaneHeader, ErrorAlert
│   ├── skeleton/              # Per-tool skeleton loaders + shared primitives
│   ├── Layout.tsx             # Global <main>, header, footer
│   ├── SearchModal.tsx        # Cmd+K fuzzy search (cmdk + Fuse.js)
│   ├── ToolCard.tsx           # Tool grid card
│   ├── FeatureCards.tsx       # Three feature cards on every tool page
│   ├── Breadcrumbs.tsx
│   ├── RootErrorBoundary.tsx
│   └── ToolErrorBoundary.tsx
├── hooks/
│   ├── useClipboard.ts        # async copy/read with auto-resetting `copied` state
│   ├── useToolPreferences.ts  # debounced localStorage settings per tool
│   ├── useUrlState.ts         # schema-based URL search-param sync
│   ├── useKeyboardShortcut.ts # declarative shortcut registration
│   └── useScrollReveal.ts
├── lib/
│   ├── icons.ts               # Static Lucide icon registry — add entries here
│   └── utils.ts               # cn() helper
├── pages/
│   ├── Home.tsx
│   ├── Tools.tsx
│   ├── ToolPage.tsx           # Shared chrome for every tool route
│   ├── Privacy.tsx
│   └── NotFound.tsx
├── seo/
│   ├── SEOHead.tsx            # title, description, OG, Twitter tags
│   ├── JsonLd.tsx             # JSON-LD structured data
│   ├── schemas.ts             # Organization, WebSite, SoftwareApplication, Breadcrumb, WebPage
│   └── constants.ts
├── tools/                     # Tool plugins — one directory per tool
│   ├── registry.ts            # Auto-discovers tools via import.meta.glob
│   └── types.ts               # ToolDefinition interface
├── workers/
│   ├── pool.ts                # 2–4 thread pool, task queue, 30s timeouts, cancellation
│   └── worker.ts
├── wasm/
│   └── loader.ts              # Cached module loader with streaming compilation
├── test/setup.ts              # jsdom polyfills for Radix
├── App.tsx
├── router.tsx                 # Lazy-loaded routes with title metadata
├── main.tsx                   # Entry point — HelmetProvider, ThemeProvider, RouterProvider
├── config.ts                  # APP_NAME, APP_DESCRIPTION
└── index.css                  # Tailwind 4 + oklch theme tokens (:root, .dark)
```

### Key patterns

- **Plugin system** — tools self-register by filesystem convention; the registry exposes `getAllTools()`, `getToolBySlug()`, `getFeaturedTools()`, `getToolsByCategory()`.
- **Tool layout primitives** — every `Route.tsx` composes `ToolShell` (+ optional `TwoPane`, `PaneHeader`, `ErrorAlert`). The `wide` variant is reserved for tools that legitimately need more horizontal room (currently `diff-checker`, `jwt-decoder`).
- **Worker pool** — `workerPool` singleton in `src/workers` runs CPU-heavy tasks off the main thread with queue, cancellation, and 30 s default timeout.
- **WASM loader** — `instantiateWasm` from `src/wasm` streams + caches modules in memory with an ArrayBuffer fallback.
- **Theming** — `next-themes` with `.dark` class strategy; semantic CSS custom properties (oklch) in `src/index.css`.
- **Vendor splitting** — `vendor-react`, `vendor-router`, `vendor-fuse`, `vendor-lottie`, `vendor-svgo`, `vendor-radix`, `vendor-cmdk` chunked separately.
- **Path alias** — `@/*` → `./src/*` (used by shadcn components; tool `Route.tsx` files use relative imports).

### Build pipeline

Scripts in `scripts/` run during the production build:

- `generate-og-image.ts` — Satori + Resvg, produces OG images
- `generate-icons.ts` — converts `public/favicon.svg` into 192 px / 512 px PNGs
- `generate-font-subset.ts` — optimized font subsets
- `prerender.ts` — Puppeteer route prerendering

A custom Vite plugin in `vite.config.ts` also generates `sitemap.xml` from the discovered tool slugs.

## Deployment

Deployed on Cloudflare Workers Assets. Configuration:

- `wrangler.jsonc` — `not_found_handling: "single-page-application"` provides the SPA fallback (no `_redirects` file needed; Cloudflare flags it as an infinite loop).
- `public/_headers` — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy, permissions policy, and long-lived cache headers for `/assets/*` and `/fonts/*`.

## Project Docs

- [`CLAUDE.md`](CLAUDE.md) — conventions and architecture notes for contributors and Claude Code
- [`PRODUCT.md`](PRODUCT.md) — strategic context: users, purpose, brand personality, anti-references, design principles
- [`DESIGN.md`](DESIGN.md) — visual design system: tokens, typography, elevation, components, do's and don'ts

## License

MIT — see [LICENSE](LICENSE) for details.
