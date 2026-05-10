import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const publicDir = join(import.meta.dirname, "..", "public");
const distDir = join(import.meta.dirname, "..", "dist");
const iconsDir = join(distDir, "icons");

const sizes = [192, 512];

async function generateIcons() {
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  const svgContent = readFileSync(join(publicDir, "favicon.svg"), "utf-8");

  for (const size of sizes) {
    const resvg = new Resvg(svgContent, {
      fitTo: { mode: "width", value: size },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    writeFileSync(join(iconsDir, `icon-${size}.png`), pngBuffer);
    console.log(`Icon generated: dist/icons/icon-${size}.png`);
  }
}

generateIcons().catch(console.error);
