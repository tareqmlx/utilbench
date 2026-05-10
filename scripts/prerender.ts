import { readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const distDir = join(import.meta.dirname, "..", "dist");
const toolsDir = join(import.meta.dirname, "..", "src", "tools");

// Discover tool slugs
const slugs = readdirSync(toolsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .filter((d) => {
    try {
      return readdirSync(join(toolsDir, d.name)).includes("tool.ts");
    } catch {
      return false;
    }
  })
  .map((d) => d.name);

const routes = ["/", "/tools", "/privacy", ...slugs.map((s) => `/tools/${s}`)];

// Simple static file server for dist
function createStaticServer(dir: string): ReturnType<typeof createServer> {
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };

  return createServer((req, res) => {
    let filePath = join(dir, req.url === "/" ? "/index.html" : req.url!);

    // SPA fallback
    try {
      readFileSync(filePath);
    } catch {
      filePath = join(dir, "index.html");
    }

    try {
      const content = readFileSync(filePath);
      const ext = filePath.match(/\.[^.]+$/)?.[0] || ".html";
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}

async function prerender() {
  const server = createStaticServer(distDir);
  const port = 4173 + Math.floor(Math.random() * 1000);
  server.listen(port);
  console.log(`Static server on port ${port}`);

  const browser = await puppeteer.launch({ headless: true });

  for (const route of routes) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}${route}`, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for React to render
    await page.waitForSelector("#root > *", { timeout: 10000 });

    const html = await page.content();

    // Determine output path
    const outputPath =
      route === "/"
        ? join(distDir, "index.html")
        : join(distDir, `${route.slice(1)}.html`);

    // Ensure parent dirs exist
    const parentDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(parentDir, { recursive: true });

    writeFileSync(outputPath, html);
    console.log(`Prerendered: ${route} -> ${outputPath}`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(`Prerendered ${routes.length} routes`);
}

prerender().catch(console.error);
