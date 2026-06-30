import { canEncode, createBatchZip, formatBytes } from "@/lib/encode";
// watermarker.ts — pure geometry + render/export pipeline + the barrel Route imports.
import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIM,
  clampToCanvasLimits,
  readImageDims,
  sniffImageMeta,
  validateImageFile,
} from "@/lib/image";
import type { NormFormat } from "@/lib/image";
import { downloadBlob } from "@/lib/pdf";
import type { ValidationResult } from "@/lib/pdf";

// Re-export shared helpers so Route imports everything from one module (pattern: compressor.ts).
export {
  validateImageFile,
  sniffImageMeta,
  readImageDims,
  clampToCanvasLimits,
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIM,
};
export type { NormFormat, ValidationResult };
export { downloadBlob };
// canEncode (WebP probe), createBatchZip (batch, deduping), formatBytes from the shared @/lib/encode.
export { canEncode, createBatchZip, formatBytes };
// MAX_QUEUE_SIZE (= 50) — same cap image-compress enforces; Route imports it from this barrel.
export { MAX_QUEUE_SIZE } from "../constants";

// Reuse watermark-pdf's vocabulary (canvas-native — NOT imported, that module is pdf-lib-coupled).
export type WatermarkKind = "text" | "image";
export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
export type Layout = "single" | "tile";
// "keep" = re-encode in the input's own format family; PNG/JPEG/WebP transcode otherwise.
export type OutputFormat = "keep" | "png" | "jpeg" | "webp";
// The concrete encoder formats `toBlob` re-encodes (resolved from OutputFormat at export time).
type EncodeFormat = "png" | "jpeg" | "webp";

// Font menu: web-safe families resolve synchronously; "Inter" is the self-hosted brand font and MUST be
// loaded via document.fonts.load before drawing (§5.4). cssFamily is what goes into ctx.font.
export interface FontChoice {
  id: string;
  label: string;
  cssFamily: string;
  needsLoad: boolean;
}
export const FONTS: FontChoice[] = [
  { id: "inter", label: "Inter", cssFamily: '"Inter", sans-serif', needsLoad: true },
  { id: "sans", label: "Sans-serif", cssFamily: "Arial, Helvetica, sans-serif", needsLoad: false },
  { id: "serif", label: "Serif", cssFamily: '"Times New Roman", Georgia, serif', needsLoad: false },
  { id: "mono", label: "Monospace", cssFamily: '"Courier New", monospace', needsLoad: false },
];

// ── PROPORTIONAL SIZING (the unifying decision, §1) ──
// Every size is a FRACTION of the base image, resolved to px against image width at render time via
// resolvePx (§5.7). This makes a single config consistent across a mixed-size batch AND makes the
// display-res preview visually identical to the natural-res export (§6.3).
export interface TextConfig {
  kind: "text";
  text: string;
  fontId: string; // → FONTS[].cssFamily
  fontWeight: "normal" | "bold";
  fontSizePct: number; // font px = fontSizePct/100 * imageWidth   (e.g. 6 → 6% of width)
  color: string; // "#ffffff"
  outline: boolean;
  outlineColor: string; // "#000000"
  outlineWidthPct: number; // stroke px = outlineWidthPct/100 * fontPx (relative to glyph size)
}
export interface LogoConfig {
  kind: "image";
  scalePct: number; // logo width px = scalePct/100 * imageWidth
}
// Shared placement/appearance fields (apply to both kinds).
export interface PlacementConfig {
  anchor: Anchor;
  layout: Layout;
  marginPct: number; // edge inset px = marginPct/100 * min(imageW, imageH)
  tileGapPct: number; // tile gap px = tileGapPct/100 * imageWidth
  rotationDeg: number; // −180..180, CW in canvas (Y-down) space
  opacity: number; // 0..1 → ctx.globalAlpha
  blend: "normal" | "multiply"; // ctx.globalCompositeOperation; default "normal"
}
export type WatermarkConfig =
  | ({ kind: "text" } & TextConfig & PlacementConfig)
  | ({ kind: "image" } & LogoConfig & PlacementConfig);

// Persisted prefs (useToolPreferences) — config only, NOT the image/logo (transient, per-session).
export interface WatermarkPrefs {
  kind: WatermarkKind;
  text: string;
  fontId: string;
  fontWeight: "normal" | "bold";
  fontSizePct: number;
  color: string;
  outline: boolean;
  outlineColor: string;
  outlineWidthPct: number;
  scalePct: number;
  anchor: Anchor;
  layout: Layout;
  marginPct: number;
  tileGapPct: number;
  rotationDeg: number;
  opacity: number;
  blend: "normal" | "multiply";
  format: OutputFormat;
  quality: number;
  jpegBackground: string;
}
export const DEFAULT_PREFS: WatermarkPrefs = {
  kind: "text",
  text: "© Utilbench",
  fontId: "inter",
  fontWeight: "bold",
  fontSizePct: 6,
  color: "#ffffff",
  outline: true,
  outlineColor: "#000000",
  outlineWidthPct: 6,
  scalePct: 25,
  anchor: "bottom-right",
  layout: "single",
  marginPct: 3,
  tileGapPct: 8,
  rotationDeg: 0,
  opacity: 0.5,
  blend: "normal",
  format: "keep",
  quality: 92,
  jpegBackground: "#ffffff",
};

export const MAX_DRAWS = 50_000; // tile-grid explosion guard (mirrors watermark-pdf:22)
export const MIN_TILE_PITCH_PX = 8; // floor so a tiny gap/mark can't produce millions of tiles
export const MIN_FONT_PX = 6; // floor for fitFontPx (§5.4) so long text can't shrink to nothing

export class CapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapError";
  }
}

// The fully-decoded, EXIF-ORIENTED base (§5.2). naturalW/H are the oriented dims — the single source of
// truth for preview sizing and export.
export interface LoadedImage {
  bitmap: ImageBitmap; // oriented; close() on replace/unmount (§11.5)
  naturalWidth: number;
  naturalHeight: number;
  format: NormFormat;
  fileName: string;
  fileSize: number;
}
// The uploaded logo (for kind:"image"). No EXIF concern (logos are graphics), but decode via
// createImageBitmap for consistency; keep intrinsic dims for aspect-preserving scale.
export interface LoadedLogo {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  fileName: string;
}

// ── Load & orientation (the single oriented source of truth, §5.2) ──────────────

const HEAD_BYTES = 65536; // 64 KB head slice for sniff/measure — never a full 25–50 MB read
const ALLOW: NormFormat[] = ["png", "jpeg", "webp"]; // raster allow-list; reject SVG/GIF/AVIF
const ANIMATED_MSG = "Animated images aren't supported — upload a static PNG, JPEG, or WebP.";
const CORRUPT_MSG = "Couldn't read this image — it may be corrupt.";
const CAP_MSG = "Image too large to watermark in your browser (over ~16 MP).";

const DECODE_OPTS: ImageBitmapOptions = {
  imageOrientation: "from-image",
  premultiplyAlpha: "none",
  colorSpaceConversion: "none",
};

/** Decode the BASE file to an EXIF-ORIENTED bitmap. Drives preview + export so they can never disagree
 *  on a rotated phone photo (§17.7). Re-slices its own 64 KB head (cheap; keeps the signature simple). */
export async function loadOrientedImage(file: File): Promise<LoadedImage> {
  const v = validateImageFile(file, ALLOW);
  if (!v.valid) throw new Error(v.error ?? "Invalid file type. Use PNG, JPG, WebP.");

  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const meta = sniffImageMeta(head);
  if (meta.format === null) throw new Error(CORRUPT_MSG);
  if (meta.animated === true) throw new Error(ANIMATED_MSG);

  // PRE-DECODE CAP GUARD (before createImageBitmap, to avoid mobile OOM). readImageDims THROWS for a
  // JPEG whose SOF sits past the 64 KB head — on throw, skip the pre-check; step-6 backstops.
  let dims: { width: number; height: number } | undefined;
  try {
    dims = readImageDims(head, meta.format);
  } catch {
    dims = undefined;
  }
  if (dims && clampToCanvasLimits(dims.width, dims.height).downscaled) {
    throw new CapError(CAP_MSG);
  }

  if (typeof createImageBitmap !== "function") {
    throw new Error("Your browser can't decode images for watermarking.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, DECODE_OPTS);
  } catch {
    throw new Error(CORRUPT_MSG);
  }

  // SECOND cap guard (post-decode, oriented dims). Reject — don't downscale.
  if (clampToCanvasLimits(bitmap.width, bitmap.height).downscaled) {
    bitmap.close();
    throw new CapError(CAP_MSG);
  }

  return {
    bitmap,
    naturalWidth: bitmap.width,
    naturalHeight: bitmap.height,
    format: meta.format,
    fileName: file.name,
    fileSize: file.size,
  };
}

/** Decode the LOGO file. Same allow-list + animated/cap guards; returns intrinsic dims for scale. */
export async function loadLogo(file: File): Promise<LoadedLogo> {
  const v = validateImageFile(file, ALLOW);
  if (!v.valid) throw new Error(v.error ?? "Invalid file type. Use PNG, JPG, WebP.");

  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const meta = sniffImageMeta(head);
  if (meta.format === null) throw new Error(CORRUPT_MSG);
  if (meta.animated === true) throw new Error(ANIMATED_MSG);

  let dims: { width: number; height: number } | undefined;
  try {
    dims = readImageDims(head, meta.format);
  } catch {
    dims = undefined;
  }
  if (dims && clampToCanvasLimits(dims.width, dims.height).downscaled) {
    throw new CapError(CAP_MSG);
  }

  if (typeof createImageBitmap !== "function") {
    throw new Error("Your browser can't decode images for watermarking.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, DECODE_OPTS);
  } catch {
    throw new Error(CORRUPT_MSG);
  }

  if (clampToCanvasLimits(bitmap.width, bitmap.height).downscaled) {
    bitmap.close();
    throw new CapError(CAP_MSG);
  }

  return { bitmap, width: bitmap.width, height: bitmap.height, fileName: file.name };
}

// ── Placement geometry (§5.3) — canvas-native, Y-down ───────────────────────────

export interface MarkBox {
  width: number;
  height: number;
} // UNROTATED extents in px

/** Half-extents of the axis-aligned bbox of a w×h mark rotated by θ (radians).
 *  Rotation-bbox math is coordinate-system-agnostic. */
export function rotatedHalfExtents(
  w: number,
  h: number,
  theta: number,
): { hx: number; hy: number } {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

/** The mark's VISUAL CENTER (cx, cy) in CANVAS px for a single-anchor placement. Y-DOWN: "top" is a
 *  SMALL y, "bottom" is a LARGE y — the inverse of watermark-pdf's Y-up version. */
export function anchorCenter(
  anchor: Anchor,
  W: number,
  H: number,
  hx: number,
  hy: number,
  margin: number,
): { cx: number; cy: number } {
  let cx: number;
  if (anchor.endsWith("-left")) {
    cx = margin + hx;
  } else if (anchor.endsWith("-right")) {
    cx = W - margin - hx;
  } else {
    cx = W / 2;
  }

  let cy: number;
  if (anchor.startsWith("top-")) {
    cy = margin + hy; // Y-DOWN (note: opposite of pdf)
  } else if (anchor.startsWith("bottom-")) {
    cy = H - margin - hy;
  } else {
    cy = H / 2;
  }

  return { cx, cy };
}

/** All visual centers for a mark on an image. single → [anchorCenter]; tile → an over-scanned grid so a
 *  rotated diagonal field has no bare corners (§17.5). */
export function computeCenters(
  mark: MarkBox,
  W: number,
  H: number,
  opts: {
    anchor: Anchor;
    layout: Layout;
    margin: number;
    tileGap: number;
    rotationDeg: number;
  },
): { cx: number; cy: number }[] {
  const theta = (opts.rotationDeg * Math.PI) / 180;
  const { hx, hy } = rotatedHalfExtents(mark.width, mark.height, theta);

  if (opts.layout === "single") {
    return [anchorCenter(opts.anchor, W, H, hx, hy, opts.margin)];
  }

  // tile: OVER-SCAN one full pitch beyond every edge so rotated tiles cover the corners.
  const pitchX = Math.max(MIN_TILE_PITCH_PX, 2 * hx + opts.tileGap);
  const pitchY = Math.max(MIN_TILE_PITCH_PX, 2 * hy + opts.tileGap);
  const centers: { cx: number; cy: number }[] = [];
  for (let cy = -hy; cy < H + hy + pitchY; cy += pitchY) {
    for (let cx = -hx; cx < W + hx + pitchX; cx += pitchX) {
      centers.push({ cx, cy });
      if (centers.length > MAX_DRAWS) return centers;
    }
  }
  return centers;
}

// ── Text measurement & the font-load gate (§5.4) ────────────────────────────────

/** Build the CSS font string assigned to ctx.font AND passed to document.fonts.load. */
export function cssFontSpec(weight: string, fontPx: number, cssFamily: string): string {
  return `${weight} ${fontPx}px ${cssFamily}`;
}

/** THE #1 CORRECTNESS GATE. Canvas does not wait for web fonts — it silently substitutes a fallback
 *  (§17.2). Await this before EVERY text measure/draw and re-render on resolve. */
export async function ensureFontLoaded(spec: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return; // jsdom / old engines
  try {
    await document.fonts.load(spec);
  } catch {
    /* non-fatal — fall back to whatever's resident */
  }
}

/** Measure the text's UNROTATED bbox in px at fontPx, via measureText actualBoundingBox* (with a
 *  width + ~1.2·fontPx fallback). REQUIRES the font already loaded + ctx.font already set. */
export function textMarkBox(ctx: CanvasRenderingContext2D, text: string, fontPx: number): MarkBox {
  const m = ctx.measureText(text);
  const w = (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0) || m.width;
  const h = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0) || fontPx * 1.2;
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Long-text fit (§11.3). Shrink fontPx until the text fits maxWidthPx, so the measured box and the
 *  drawn glyphs agree and NO maxWidth is needed at draw time. REQUIRES ctx.font set per fontPx. */
export function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
  maxWidthPx: number,
  weight: string,
  cssFamily: string,
): number {
  let px = fontPx;
  for (let i = 0; i < 12 && px > MIN_FONT_PX; i++) {
    ctx.font = cssFontSpec(weight, px, cssFamily);
    const measured = ctx.measureText(text).width;
    if (measured <= maxWidthPx) break;
    px = Math.max(MIN_FONT_PX, px * (maxWidthPx / measured)); // proportional step
  }
  return px; // caller sets ctx.font to this px, THEN calls textMarkBox — measure now == draw.
}

// ── Logo mark box (§5.5) ────────────────────────────────────────────────────────

/** Logo extents in px: width = scalePct% of IMAGE width; height preserves aspect; then CLAMP so the
 *  logo can never exceed the image minus margins (§11.3). */
export function logoMarkBox(
  logoW: number,
  logoH: number,
  imageW: number,
  imageH: number,
  scalePct: number,
  margin: number,
): MarkBox {
  const aspect = logoH / logoW;
  let width = (scalePct / 100) * imageW;
  width = Math.min(width, imageW - 2 * margin);
  let height = width * aspect;
  if (height > imageH - 2 * margin) {
    height = imageH - 2 * margin;
    width = height / aspect;
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

// ── Render & export (§5.6) ──────────────────────────────────────────────────────

/** Composite the base image + watermark into `ctx`, sized `targetW × targetH`. PURE given a bitmap +
 *  config (no I/O). Used by preview (display px) and export (natural px). For a text config the font
 *  MUST be ensured (§5.4) before calling. */
export function renderWatermark(
  ctx: CanvasRenderingContext2D,
  base: ImageBitmap,
  logo: ImageBitmap | null,
  config: WatermarkConfig,
  targetW: number,
  targetH: number,
  flattenBackground?: string,
): void {
  ctx.clearRect(0, 0, targetW, targetH);
  if (flattenBackground) {
    ctx.fillStyle = flattenBackground;
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(base, 0, 0, targetW, targetH); // base scaled to target (proportional)

  const theta = (config.rotationDeg * Math.PI) / 180;
  const margin = resolvePx(config.marginPct, Math.min(targetW, targetH));
  const tileGap = resolvePx(config.tileGapPct, targetW);

  let mark: MarkBox;
  let drawOne: () => void;

  if (config.kind === "text") {
    const family =
      (FONTS.find((f) => f.id === config.fontId) ?? FONTS[0])?.cssFamily ?? "sans-serif";
    const requestedPx = resolvePx(config.fontSizePct, targetW);
    // FIT FIRST so measure == draw (§5.4). After this, NO maxWidth at draw time.
    const fontPx = fitFontPx(
      ctx,
      config.text,
      requestedPx,
      targetW - 2 * margin,
      config.fontWeight,
      family,
    );
    ctx.font = cssFontSpec(config.fontWeight, fontPx, family);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    mark = textMarkBox(ctx, config.text, fontPx); // measured at the FITTED px → matches glyphs
    drawOne = () => {
      if (config.outline) {
        // STROKE-THEN-FILL (§17.1)
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1, resolvePx(config.outlineWidthPct, fontPx));
        ctx.strokeStyle = config.outlineColor;
        ctx.strokeText(config.text, 0, 0); // NO maxWidth — fitFontPx already guarantees fit
      }
      ctx.fillStyle = config.color;
      ctx.fillText(config.text, 0, 0); // NO maxWidth (§3 review fix)
    };
  } else {
    if (!logo) return; // logo required when kind === "image"; base already drawn above
    const lgMark = logoMarkBox(logo.width, logo.height, targetW, targetH, config.scalePct, margin);
    mark = lgMark;
    drawOne = () =>
      ctx.drawImage(logo, -lgMark.width / 2, -lgMark.height / 2, lgMark.width, lgMark.height);
  }

  const centers = computeCenters(mark, targetW, targetH, {
    anchor: config.anchor,
    layout: config.layout,
    margin,
    tileGap,
    rotationDeg: config.rotationDeg,
  });

  ctx.save();
  ctx.globalAlpha = config.opacity;
  if (config.blend === "multiply") ctx.globalCompositeOperation = "multiply";
  for (const { cx, cy } of centers) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(theta);
    drawOne();
    ctx.restore();
  }
  ctx.restore(); // opacity/blend/transform never leak (§17.3)
}

/** Export pipeline: render the watermark at NATURAL resolution and encode. PURE given a bitmap + config. */
export async function watermarkToBlob(
  base: LoadedImage,
  logo: LoadedLogo | null,
  config: WatermarkConfig,
  opts: { format: OutputFormat; quality: number; jpegBackground: string },
): Promise<{ blob: Blob; mime: string; ext: string; width: number; height: number }> {
  const resolved = opts.format === "keep" ? base.format : opts.format;
  let fmt: EncodeFormat = resolved === "avif" ? "png" : resolved;
  // WEBP FALLBACK: covers the keep-format case (a WebP input with format:"keep" resolves to "webp").
  if (fmt === "webp" && !canEncode("image/webp")) fmt = "png";

  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight; // OUTPUT = INPUT dims
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  if (config.kind === "text") {
    const family =
      (FONTS.find((f) => f.id === config.fontId) ?? FONTS[0])?.cssFamily ?? "sans-serif";
    const naturalFontPx = resolvePx(config.fontSizePct, base.naturalWidth);
    await ensureFontLoaded(cssFontSpec(config.fontWeight, naturalFontPx, family));
  }

  renderWatermark(
    ctx,
    base.bitmap,
    logo?.bitmap ?? null,
    config,
    base.naturalWidth,
    base.naturalHeight,
    fmt === "jpeg" ? opts.jpegBackground : undefined,
  );

  const mime = mimeFor(fmt);
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, mime, qualityFor(fmt, opts.quality)),
  );
  if (!blob) throw new Error("Couldn't export the watermarked image.");
  // TYPE-MISMATCH BACKSTOP (mirrors converter.ts:385): some browsers return a PNG blob for an
  // unsupported type → catch it here instead of shipping a silently-wrong file.
  if (blob.type !== mime) throw new Error(`This browser can't encode ${fmt.toUpperCase()}.`);

  return {
    blob,
    mime,
    ext: extFor(fmt),
    width: base.naturalWidth,
    height: base.naturalHeight,
  };
}

// ── Helpers (§5.7) ──────────────────────────────────────────────────────────────

/** Resolve a percentage to px against a reference dimension (preview ref or natural ref → WYSIWYG). */
export function resolvePx(pct: number, referencePx: number): number {
  return (pct / 100) * referencePx;
}

/** `${base}-watermarked.${ext}`, sanitized, fallback "image" (model: compressor.ts buildCompressedFilename). */
export function buildWatermarkedFilename(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "image"}-watermarked.${ext}`;
}

/** Format → MIME map (mirror converter.ts). */
export function mimeFor(fmt: EncodeFormat): string {
  return fmt === "png" ? "image/png" : fmt === "jpeg" ? "image/jpeg" : "image/webp";
}

/** Format → toBlob quality arg: PNG → undefined; JPEG/WebP → quality/100. */
export function qualityFor(fmt: EncodeFormat, quality: number): number | undefined {
  return fmt === "png" ? undefined : quality / 100;
}

/** Format → file extension (jpeg → "jpg"). */
export function extFor(fmt: EncodeFormat): string {
  return fmt === "jpeg" ? "jpg" : fmt;
}
