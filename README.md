# Utilbench

Fast, private browser utilities for developers. No servers, no tracking — just tools that work.

Utilbench is a client-side utility tools SPA where every tool runs entirely in the browser using Web Workers and WASM for heavy computation. Zero data leaves your machine.

## Tech Stack

- **React 19** + **React Router v7** (lazy-loaded routes)
- **Vite 6** (build & dev server)
- **Tailwind CSS 4** (utility-first styling)
- **TypeScript** (strict mode)
- **Biome** (linting & formatting)
- **shadcn/ui** (component library)
- **Vitest** (testing framework)
- **Bun** (package manager & script runner)
- **Fuse.js** (fuzzy search)

## Tools

### Data & JSON

| Tool | Description |
|------|-------------|
| JSON Formatter | Format, validate, and beautify JSON with syntax highlighting |
| JWT Decoder | Decode and inspect JWT tokens locally |
| Base64 Encoder | Encode and decode Base64 strings and files |
| CSV to JSON | Convert CSV files to JSON with customizable options |
| JSON Schema Generator | Generate JSON Schema from sample JSON data |
| YAML to JSON | Convert between YAML and JSON formats |

### Text & Code

| Tool | Description |
|------|-------------|
| Cron Parser | Parse and explain cron expressions in plain English |
| Diff Checker | Compare two texts and highlight differences |
| Case Converter | Convert text between camelCase, snake_case, etc. |
| Markdown Preview | Preview Markdown with live rendering and syntax highlighting |
| Lorem Ipsum | Generate placeholder text for designs and mockups |

### Media & Assets

| Tool | Description |
|------|-------------|
| QR Generator | Generate QR codes from text, URLs, or structured data |
| Image Resizer | Resize and crop images directly in the browser |
| SVG Optimizer | Optimize and minify SVG files while preserving quality |
| Favicon Generator | Generate favicons in all required sizes from a single image |
| Lottie Previewer | Preview and inspect Lottie animation files |
| Image Metadata Remover | Remove EXIF and metadata from images for privacy |

## Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Production build
bun run build

# Preview production build
bun run preview

# Lint & format check
bun run check

# Auto-fix lint/format issues
bunx --bun @biomejs/biome check --write ./src
```

## Adding a New Tool

Tools are auto-discovered at build time — no manual registration needed.

1. Create a directory: `src/tools/<tool-slug>/`
2. Add `tool.ts` with the tool metadata:

```ts
import type { ToolDefinition } from "../types";

export default {
  name: "My Tool",
  slug: "my-tool",
  description: "What it does",
  category: "data",       // "data" | "text" | "media"
  tags: ["tag1", "tag2"],
  featured: false,
  icon: "Wrench",         // Lucide icon component name
  route: () => import("./Route"),
} satisfies ToolDefinition;
```

3. Add `Route.tsx` with the tool UI:

```tsx
export function Component() {
  return <div>Tool UI here</div>;
}
```

That's it. The registry picks it up automatically via `import.meta.glob`.

## Architecture

```
src/
├── components/     # Shared UI (Layout, SearchModal, ToolCard, ThemeToggle)
├── hooks/          # Custom hooks (useTheme)
├── lib/            # Utilities (cn(), icon lookup)
├── pages/          # Route pages (Home, Tools, ToolPage, NotFound)
├── seo/            # SEO helpers (meta tags, structured data)
├── tools/          # Tool plugins — each in its own directory
│   ├── registry.ts # Auto-discovers tools via import.meta.glob
│   └── types.ts    # ToolDefinition interface
├── workers/        # Worker pool (2-4 threads, task queue, timeouts)
├── wasm/           # Cached WASM module loader with streaming compilation
├── config.ts       # App constants
├── router.tsx      # Route definitions with lazy loading
└── main.tsx        # Entry point
```

**Key patterns:**

- **Plugin system** — tools self-register via filesystem convention
- **Worker pool** — off-main-thread execution with queue, cancellation, and 30s default timeout
- **WASM loader** — streaming compilation with in-memory cache and ArrayBuffer fallback
- **Dark mode** — `.dark` class strategy with localStorage persistence and system preference fallback
- **Vendor splitting** — react, react-router, fuse.js, radix-ui, and cmdk chunked separately

## License

MIT — see [LICENSE](LICENSE) for details.
