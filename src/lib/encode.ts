// Shared canvas-encode helpers, extracted so pure-canvas tools (e.g. image-watermark)
// can reuse them WITHOUT pulling image-converter/converter.ts's `AVIF_PROBE_DATA_URI`
// base64 blob (and the AVIF-decode probe) into their chunk. converter.ts re-exports
// `canEncode`/`createBatchZip` from here to keep a single source of truth.
//
// No top-level fflate import: it is loaded dynamically inside createBatchZip
// (`await import("fflate")`) — a static `import { zip }` would be a dead/unused import
// → fails build under noUnusedLocals.

// ── Encode feature detection ──────────────────────────────────────────────────

let webpEncodeCache: boolean | null = null;
const encodeProbeCache = new Map<string, boolean>();

/**
 * SYNC, cached. PNG/JPEG → always true. For "image/webp": probe once via
 * toDataURL("image/webp").startsWith("data:image/webp"). Caches the boolean module-side.
 */
export function canEncode(mime: string): boolean {
  if (mime === "image/png" || mime === "image/jpeg") return true;
  if (mime === "image/webp") {
    if (webpEncodeCache !== null) return webpEncodeCache;
    webpEncodeCache = probeEncode("image/webp");
    return webpEncodeCache;
  }
  const cached = encodeProbeCache.get(mime);
  if (cached !== undefined) return cached;
  const result = probeEncode(mime);
  encodeProbeCache.set(mime, result);
  return result;
}

function probeEncode(mime: string): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL(mime).startsWith(`data:${mime}`);
  } catch {
    return false;
  }
}

/** Test hook — clears the canEncode memo caches. */
export function __resetEncodeProbeCache(): void {
  webpEncodeCache = null;
  encodeProbeCache.clear();
}

// ── Batch zip ─────────────────────────────────────────────────────────────────

/**
 * Async fflate zip, level 0 (store — images already compressed). De-dupes filename collisions by
 * suffixing " (N)" before the extension so entries don't clobber.
 */
export async function createBatchZip(
  items: Array<{ blob: Blob; filename: string }>,
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  const seen = new Map<string, number>();
  for (const item of items) {
    const count = seen.get(item.filename) ?? 0;
    seen.set(item.filename, count + 1);
    let name = item.filename;
    if (count > 0) {
      const dot = name.lastIndexOf(".");
      name =
        dot === -1
          ? `${name} (${count + 1})`
          : `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}`;
    }
    entries[name] = new Uint8Array(await item.blob.arrayBuffer());
  }
  const { zip } = await import("fflate");
  const bytes: Uint8Array = await new Promise((resolve, reject) =>
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))),
  );
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}

// ── Byte formatting ─────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
