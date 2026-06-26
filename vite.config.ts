import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";

const SITE_URL = "https://utilbench.devandstone.com";

const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8")) as {
  version: string;
};

function sitemapPlugin(): Plugin {
  return {
    name: "generate-sitemap",
    closeBundle() {
      const toolsDir = join(__dirname, "src/tools");
      const slugs = readdirSync(toolsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .filter((d) => {
          try {
            readdirSync(join(toolsDir, d.name)).includes("tool.ts");
            return true;
          } catch {
            return false;
          }
        })
        .map((d) => d.name);

      const today = new Date().toISOString().split("T")[0];
      const staticRoutes = ["/", "/tools", "/privacy"];
      const toolRoutes = slugs.map((slug) => `/tools/${slug}`);
      const allRoutes = [...staticRoutes, ...toolRoutes];

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes.map((route) => `  <url>\n    <loc>${SITE_URL}${route}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join("\n")}
</urlset>`;

      writeFileSync(join(__dirname, "dist/sitemap.xml"), sitemap);
      console.log(`Sitemap generated with ${allRoutes.length} URLs`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sitemapPlugin(), cloudflare()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // jSquash codecs locate their `.wasm` via `new URL("...wasm", import.meta.url)`.
  // Excluding them from esbuild's dep pre-bundler leaves that reference intact so
  // Rollup emits the `.wasm` as a hashed asset (see plan §3.4).
  optimizeDeps: {
    exclude: [
      "@jsquash/jpeg",
      "@jsquash/webp",
      "@jsquash/avif",
      "@jsquash/png",
      "@jsquash/oxipng",
    ],
  },
  // compress.worker.ts dynamically `import()`s codecs (code-splitting), which the
  // default "iife" worker format rejects. ES module workers support it (plan §3.4).
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-router": ["react-router-dom"],
          "vendor-fuse": ["fuse.js"],
          "vendor-lottie": ["lottie-web"],
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slider",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toggle",
            "@radix-ui/react-tooltip",
          ],
          "vendor-cmdk": ["cmdk"],
          "vendor-marked": ["marked"],
          "vendor-dompurify": ["dompurify"],
          "vendor-pdf": ["pdf-lib"],
          "vendor-pdfjs": ["pdfjs-dist"],
          "vendor-dnd": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          // Best-effort only: the codecs are dynamically imported inside the worker,
          // so their chunks attach to the worker bundle, not necessarily here (plan §3.2).
          "vendor-jsquash": ["upng-js"],
        },
      },
    },
  },
});