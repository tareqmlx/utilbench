import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");
const srcRoot = join(rootDir, "node_modules", "pdfjs-dist");
const destRoot = join(rootDir, "public", "pdfjs");

const folders = ["cmaps", "standard_fonts", "wasm", "iccs"];

function copyPdfjsAssets() {
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  const copied: string[] = [];
  for (const folder of folders) {
    const src = join(srcRoot, folder);
    if (!existsSync(src)) {
      console.warn(`Skipped pdfjs/${folder}: not found in node_modules/pdfjs-dist`);
      continue;
    }
    cpSync(src, join(destRoot, folder), { recursive: true });
    copied.push(folder);
  }

  console.log(`Copied pdfjs assets to public/pdfjs: ${copied.join(", ")}`);
}

copyPdfjsAssets();
