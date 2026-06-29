import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");
const srcRoot = join(rootDir, "node_modules", "onnxruntime-web", "dist");
const destRoot = join(rootDir, "public", "ort");

// Explicit pinned manifest — only the SIMD threaded runtime files the
// background-remover tool loads. No glob: keep public/ort minimal and reviewable.
// WASM-only (v1): the JSEP/WebGPU pair is intentionally EXCLUDED — its wasm is 25.58 MiB,
// over Cloudflare Workers Assets' 25 MiB per-file cap, so staging it would block deploy
// even though nothing imports it. ORT loads the `wasm` entry only (plan §2.4). v1.1 = WebGPU.
const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

function copyOrtAssets() {
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  const copied: string[] = [];
  for (const file of files) {
    const src = join(srcRoot, file);
    if (!existsSync(src)) {
      console.warn(`Skipped ort/${file}: not found in node_modules/onnxruntime-web/dist`);
      continue;
    }
    copyFileSync(src, join(destRoot, file));
    copied.push(file);
  }

  console.log(`Copied ort assets to public/ort: ${copied.join(", ")}`);
}

copyOrtAssets();
