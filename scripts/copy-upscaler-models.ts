import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Stage the UpscalerJS ESRGAN-slim model weights same-origin (plan §3.3/§15 #1).
//
// WHY a copy script (not the bundler): a TF.js `model.json` references its `.bin`
// weight shards as PLAIN STRING filenames inside the JSON, which Vite/Rollup does NOT
// rewrite. And UpscalerJS's model definition carries only `_internals.{name,version,path}`,
// so by default `fetchModel` resolves the weights from jsDelivr/unpkg (a third-party CDN) —
// which would break the tool's privacy moat. We stage the shards under `public/models/…`
// and pass UpscalerJS a same-origin top-level `path` (`/models/image-upscaler/x{scale}/model.json`)
// that short-circuits the CDN path. See src/tools/image-upscaler/upscaler-core.ts.
//
// v1 ships scales 2× and 4× only (plan §2.2). Each shard is <1 MB — far under Cloudflare
// Workers Assets' 25 MiB per-file cap.
//
// LICENSE: the weights are Apache-2.0 (idealo/image-super-resolution). Apache-2.0 §4 requires
// the LICENSE text travel with the redistributed bytes, so we stage a LICENSE alongside them.

const rootDir = join(import.meta.dirname, "..");
const srcRoot = join(rootDir, "node_modules", "@upscalerjs", "esrgan-slim");
const destRoot = join(rootDir, "public", "models", "image-upscaler");

const scales = [2, 4] as const;
// TF.js layers models emit `model.json` + one or more `groupN-shardMofK.bin` shards.
const modelJson = "model.json";

function copyUpscalerModels() {
  const modelsSrc = join(srcRoot, "models");
  if (!existsSync(modelsSrc)) {
    console.warn(
      "Skipped upscaler models: node_modules/@upscalerjs/esrgan-slim/models not found. Run `bun install`.",
    );
    return;
  }

  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  const copied: string[] = [];
  for (const scale of scales) {
    const scaleSrc = join(modelsSrc, `x${scale}`);
    const scaleDest = join(destRoot, `x${scale}`);
    if (!existsSync(scaleSrc)) {
      console.warn(`Skipped upscaler x${scale}: ${scaleSrc} not found`);
      continue;
    }
    mkdirSync(scaleDest, { recursive: true });
    // Copy model.json + every .bin shard (future-proof: don't hard-code the shard count).
    const files = readdirSync(scaleSrc).filter(
      (f) => f === modelJson || f.endsWith(".bin"),
    );
    for (const file of files) {
      copyFileSync(join(scaleSrc, file), join(scaleDest, file));
    }
    copied.push(`x${scale} (${files.length} files)`);
  }

  // Stage the Apache-2.0 weight license text (Apache-2.0 §4 redistribution obligation).
  // The esrgan-slim package's own LICENSE is MIT (the wrapper lib); the weights are Apache-2.0
  // upstream. We write a LICENSE that credits both so the redistributed shards carry their terms.
  const licenseDest = join(destRoot, "LICENSE");
  writeWeightsLicense(licenseDest);

  console.log(`Copied upscaler models to public/models/image-upscaler: ${copied.join(", ")}`);
}

function writeWeightsLicense(dest: string): void {
  const text = `UpscalerJS ESRGAN-slim model weights — license notice

The ESRGAN-slim model weights bundled here are derived from
idealo/image-super-resolution and are licensed under the Apache License,
Version 2.0. A copy of the license is available at:

    https://www.apache.org/licenses/LICENSE-2.0

The UpscalerJS library and the @upscalerjs/esrgan-slim wrapper package are
licensed under the MIT License, Copyright (c) 2022 Kevin Scott.

These weights are redistributed unmodified for same-origin, in-browser
inference. See the project root NOTICE file for full attribution.
`;
  writeFileSync(dest, text, "utf-8");
}

copyUpscalerModels();
