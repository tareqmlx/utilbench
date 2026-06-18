import { parsePageRanges } from "@/lib/pdf";
import { Encodings } from "@pdf-lib/standard-fonts";
import {
  BlendMode,
  type Color,
  PDFDocument,
  type PDFFont,
  StandardFonts,
  adjustDimsForRotation,
  degrees,
  reduceRotation,
  rgb,
} from "pdf-lib";

// ── Constants & types (§5.1) ──

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"];
export const TRANSCODABLE_IMAGE_TYPES = ["image/webp"];
export const ACCEPTED_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
export const MARGIN = 24; // pt, edge inset for corner/edge anchors
export const MAX_DRAWS = 50_000; // pages × tiles guard

// Re-exported so a fresh `rgb` import isn't required by callers building configs.
export { rgb };

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
export type StandardFontName = "Helvetica" | "HelveticaBold" | "TimesRoman" | "Courier";

export interface TextWatermarkConfig {
  kind: "text";
  text: string;
  fontName: StandardFontName;
  fontSize: number;
  color: Color;
  opacity: number;
  rotation: number;
  layout: "single" | "tile";
  anchor: Anchor;
  tileGap: number;
}
export interface ImageWatermarkConfig {
  kind: "image";
  imageBytes: Uint8Array;
  imageType: "image/png" | "image/jpeg";
  scale: number;
  opacity: number;
  rotation: number;
  layout: "single" | "tile";
  anchor: Anchor;
  tileGap: number;
}
export type WatermarkConfig = TextWatermarkConfig | ImageWatermarkConfig;
export interface PageTarget {
  mode: "all" | "ranges";
  spec?: string;
}

// ── Placement math (§5.3) ──

export interface MarkBox {
  width: number;
  height: number;
}
export interface VisibleBox {
  originX: number; // CropBox lower-left, user space
  originY: number;
  width: number; // CropBox dimensions
  height: number;
  rotation: number; // page.getRotation().angle, normalized to {0,90,180,270}
}
export interface DrawSpot {
  x: number;
  y: number;
  angleDeg: number; // anchor + final draw angle
}

/** Normalize a raw /Rotate angle (CW, possibly negative or ≥360) to {0,90,180,270}. */
export function normalizePageRotation(angle: number): number {
  // Modulo THEN reduce — reduceRotation alone does NOT fix negatives.
  return reduceRotation(((angle % 360) + 360) % 360);
}

/** Half-extents of the axis-aligned bounding box of a w×h mark rotated by θ (radians, CCW). */
function rotatedHalfExtents(w: number, h: number, theta: number): { hx: number; hy: number } {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const bboxW = w * c + h * s;
  const bboxH = w * s + h * c;
  return { hx: bboxW / 2, hy: bboxH / 2 };
}

/**
 * Step A — anchor target `(cx, cy)` (the mark's VISUAL CENTER) in VISIBLE dims.
 * Corner/edge presets clamp by the half-extent of the mark's ROTATED bbox so the
 * mark stays on-page. Center has no inset.
 */
function anchorCenter(
  anchor: Anchor,
  vw: number,
  vh: number,
  hx: number,
  hy: number,
  margin: number,
): { cx: number; cy: number } {
  // Horizontal band: left / center / right.
  let cx: number;
  if (anchor.endsWith("-left") || anchor === "middle-left") {
    cx = margin + hx;
  } else if (anchor.endsWith("-right") || anchor === "middle-right") {
    cx = vw - margin - hx;
  } else {
    cx = vw / 2;
  }

  // Vertical band: top / middle / bottom.
  let cy: number;
  if (anchor.startsWith("top-")) {
    cy = vh - margin - hy;
  } else if (anchor.startsWith("bottom-")) {
    cy = margin + hy;
  } else {
    cy = vh / 2;
  }

  return { cx, cy };
}

/**
 * Step B — given the desired VISUAL CENTER `(cx, cy)` and the mark's unrotated
 * extents (w, h), return the visible-space anchor `(ax, ay)` — the point pdf-lib
 * rotates about (bottom-left for images). θ is userRotation in radians, CCW.
 */
function centerToAnchor(
  cx: number,
  cy: number,
  w: number,
  h: number,
  theta: number,
): { ax: number; ay: number } {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ax = cx - (w / 2) * cos + (h / 2) * sin;
  const ay = cy - (w / 2) * sin - (h / 2) * cos;
  return { ax, ay };
}

/**
 * Step B (text variant) — drawText anchors at BASELINE-left, not bottom-left.
 * Center the full glyph box (ascender→descender) at `(cx, cy)`, then shift the
 * anchor up to the baseline along the mark's local "down" axis.
 */
export function textAnchorFromCenter(
  cx: number,
  cy: number,
  font: PDFFont,
  text: string,
  size: number,
  theta: number,
): { ax: number; ay: number } {
  const w = font.widthOfTextAtSize(text, size);
  const hFull = font.heightAtSize(size);
  const hNoDesc = font.heightAtSize(size, { descender: false });
  const descent = hFull - hNoDesc;

  // Center the ascender→baseline box, then add descent back along local "down".
  const { ax, ay } = centerToAnchor(cx, cy, w, hNoDesc, theta);
  return {
    ax: ax + (descent / 2) * Math.sin(theta),
    ay: ay - (descent / 2) * Math.cos(theta),
  };
}

/**
 * Step C — final draw angle. PDF /Rotate r rotates the page CW by r when viewed;
 * pdf-lib's `rotate` draw option is CCW in unrotated user space. To counter the
 * viewer's CW rotation so the mark reads at `userRotation` (CCW, viewer-relative),
 * draw at `userRotation + r`. (Empirically verified by rasterizing /Rotate 90 &
 * 270 pages — the minus sign renders the mark upside-down.) Normalized to
 * [−180, 180) (i.e. 180 maps to −180, same rotation).
 */
export function finalDrawAngle(userRotation: number, pageRotation: number): number {
  const a = userRotation + pageRotation;
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/**
 * Step C — map a visible-space point `(ax, ay)` (ax = visible X, ay = visible Y)
 * to unrotated user space, adding the CropBox origin. Inverts the viewer's
 * CW /Rotate. W/H are the CropBox (user-space) dims. Derived by inverting the
 * page rotation and verified by rasterizing an off-center anchor against a
 * user-space reference mark on /Rotate 90 & 270 pages.
 */
export function visibleToUser(ax: number, ay: number, box: VisibleBox): { x: number; y: number } {
  const W = box.width;
  const H = box.height;
  switch (box.rotation) {
    case 90:
      return { x: box.originX + (W - ay), y: box.originY + ax };
    case 180:
      return { x: box.originX + (W - ax), y: box.originY + (H - ay) };
    case 270:
      return { x: box.originX + ay, y: box.originY + (H - ax) };
    default: // 0
      return { x: box.originX + ax, y: box.originY + ay };
  }
}

export interface PlacementOpts {
  anchor: Anchor;
  userRotation: number;
  layout: "single" | "tile";
  tileGap: number;
  margin: number;
}

/**
 * Compute the list of VISIBLE-space visual centers `(cx, cy)` for a mark whose
 * FULL unrotated extents are `mark`, on a page described by `box`. This is the
 * single source of grid/anchor geometry; both image and text paths build on it.
 *
 * NOTE on text height: `mark.height` is the FULL glyph height (ascender→descender)
 * and is used here only for the rotated-bbox half-extent (corner clamp + tile
 * pitch). The baseline/descent adjustment for text lives in `textAnchorFromCenter`.
 */
export function computeCenters(
  mark: MarkBox,
  box: VisibleBox,
  opts: PlacementOpts,
): { cx: number; cy: number }[] {
  const theta = (opts.userRotation * Math.PI) / 180;
  const vis = adjustDimsForRotation({ width: box.width, height: box.height }, box.rotation);
  const vw = vis.width;
  const vh = vis.height;
  const { hx, hy } = rotatedHalfExtents(mark.width, mark.height, theta);

  if (opts.layout === "single") {
    return [anchorCenter(opts.anchor, vw, vh, hx, hy, opts.margin)];
  }

  // Tile: step a grid of visual centers. Pitch = rotated-bbox extent + gap.
  // Start before 0 and end after the box dim so partial tiles bleed off-edge.
  const pitchX = 2 * hx + opts.tileGap;
  const pitchY = 2 * hy + opts.tileGap;
  const centers: { cx: number; cy: number }[] = [];
  for (let cy = hy; cy < vh + hy; cy += pitchY) {
    for (let cx = hx; cx < vw + hx; cx += pitchX) {
      centers.push({ cx, cy });
      if (centers.length > MAX_DRAWS) return centers; // hard guard; caller pre-flights
    }
  }
  return centers;
}

/**
 * computePlacements — the heart. Returns user-space draw spots for the GENERIC
 * (bottom-left anchor) case, i.e. images. `mark.{width,height}` are the unrotated
 * extents; `DrawSpot.{x,y}` is the bottom-left point pdf-lib rotates about, and
 * `angleDeg` is the final draw angle (/Rotate-compensated). Text uses
 * `computeCenters` + `textAnchorFromCenter` to shift the anchor to the baseline.
 */
export function computePlacements(mark: MarkBox, box: VisibleBox, opts: PlacementOpts): DrawSpot[] {
  const drawAngle = finalDrawAngle(opts.userRotation, box.rotation);
  const drawTheta = (drawAngle * Math.PI) / 180;
  const centers = computeCenters(mark, box, opts);

  // Map the VISUAL CENTER to user space, then compute the bottom-left anchor THERE
  // using the actually-applied `drawAngle`. (Computing the anchor in visible space
  // with `userRotation` then mapping the anchor point only agrees at /Rotate 0 —
  // for rotated pages the rotation pivot is off, shifting the mark off-center.)
  return centers.map(({ cx, cy }) => {
    const uc = visibleToUser(cx, cy, box);
    const { ax, ay } = centerToAnchor(uc.x, uc.y, mark.width, mark.height, drawTheta);
    return { x: ax, y: ay, angleDeg: drawAngle };
  });
}

/**
 * §5.4 — image mark dimensions in points. `scale` ∈ (0,1] is a fraction of the
 * VISIBLE page width; height follows the intrinsic aspect ratio, then clamps to
 * the visible height (the real guard — a tall/narrow logo can exceed page height
 * even when its width fits). Computed against the post-/Rotate visible box.
 */
export function imageMarkBox(
  intrinsicW: number,
  intrinsicH: number,
  box: VisibleBox,
  scale: number,
): MarkBox {
  const vis = adjustDimsForRotation({ width: box.width, height: box.height }, box.rotation);
  const aspect = intrinsicH / intrinsicW;
  let width = Math.min(scale * vis.width, vis.width);
  let height = width * aspect;
  if (height > vis.height) {
    height = vis.height;
    width = height / aspect;
  }
  return { width, height };
}

// ── Public API (§5.2) ──

const FONT_MAP: Record<StandardFontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

/** Resolve a PageTarget to a sorted, deduped list of 0-based page indices. Throws on invalid. */
function resolveTargetIndices(target: PageTarget, pageCount: number): number[] {
  if (target.mode === "all") {
    return Array.from({ length: pageCount }, (_, i) => i);
  }
  const spec = target.spec ?? "";
  const result = parsePageRanges(spec, pageCount);
  if (result.error) throw new Error(result.error);
  const set = new Set<number>();
  for (const r of result.ranges) {
    for (const idx of r.indices) set.add(idx);
  }
  if (set.size === 0) throw new Error("No pages selected.");
  return Array.from(set).sort((a, b) => a - b);
}

/** Validate that every char in `text` is representable by the font's WinAnsi encoding. */
export function validateWinAnsi(
  text: string,
  // fontName accepted for API symmetry; all four standard fonts use WinAnsi.
  _fontName: StandardFontName,
): { ok: boolean; badChar?: string } {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) {
      return { ok: false, badChar: ch };
    }
  }
  return { ok: true };
}

export async function applyWatermark(
  bytes: Uint8Array,
  config: WatermarkConfig,
  target: PageTarget,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (doc.isEncrypted) {
    throw new Error("This PDF is encrypted. Decrypt it before adding a watermark.");
  }

  const pageCount = doc.getPageCount();
  const indices = resolveTargetIndices(target, pageCount);
  const allPages = doc.getPages();

  // Embed font / image ONCE, reused across every targeted page.
  let font: PDFFont | undefined;
  if (config.kind === "text") {
    const check = validateWinAnsi(config.text, config.fontName);
    if (!check.ok) {
      throw new Error(
        `The character "${check.badChar}" can't be drawn with a standard PDF font. Remove it or use a different watermark text.`,
      );
    }
    font = await doc.embedFont(FONT_MAP[config.fontName]);
  }
  // prepareImageBytes already pins valid PNG/JPG bytes, but guard the embed so a
  // residual bad image surfaces as an image error, not a misleading "corrupt PDF".
  let image: Awaited<ReturnType<typeof doc.embedPng>> | undefined;
  if (config.kind === "image") {
    try {
      image =
        config.imageType === "image/png"
          ? await doc.embedPng(config.imageBytes)
          : await doc.embedJpg(config.imageBytes);
    } catch {
      throw new Error("Couldn't embed the watermark image. Use a valid PNG, JPG, or WebP.");
    }
  }

  // Text mark box is page-independent (font metrics). Image mark box is computed
  // PER PAGE from the visible page width (§5.4), so it scales proportionally
  // across mixed page sizes.
  const textMarkBox: MarkBox | undefined =
    config.kind === "text" && font
      ? {
          width: font.widthOfTextAtSize(config.text, config.fontSize),
          height: font.heightAtSize(config.fontSize),
        }
      : undefined;
  if (config.kind === "text" && !textMarkBox) throw new Error("Invalid watermark configuration.");
  if (config.kind === "image" && !image) throw new Error("Invalid watermark configuration.");

  const placementOpts: PlacementOpts = {
    anchor: config.anchor,
    userRotation: config.rotation,
    layout: config.layout,
    tileGap: config.tileGap,
    margin: MARGIN,
  };

  // Build VisibleBoxes + per-page mark boxes + visual-center lists, pre-flighting
  // the draw budget.
  const perPage: {
    page: (typeof allPages)[number];
    box: VisibleBox;
    markBox: MarkBox;
    centers: { cx: number; cy: number }[];
    drawAngle: number;
  }[] = [];
  let totalDraws = 0;
  for (const idx of indices) {
    const page = allPages[idx];
    if (!page) continue;
    const crop = page.getCropBox();
    const box: VisibleBox = {
      originX: crop.x,
      originY: crop.y,
      width: crop.width,
      height: crop.height,
      rotation: normalizePageRotation(page.getRotation().angle),
    };
    const markBox =
      config.kind === "image" && image
        ? imageMarkBox(image.width, image.height, box, config.scale)
        : (textMarkBox as MarkBox);
    const centers = computeCenters(markBox, box, placementOpts);
    totalDraws += centers.length;
    if (totalDraws > MAX_DRAWS) {
      throw new Error("Too many watermark tiles — increase the tile gap or target fewer pages.");
    }
    perPage.push({
      page,
      box,
      markBox,
      centers,
      drawAngle: finalDrawAngle(config.rotation, box.rotation),
    });
  }

  const total = perPage.length;
  for (let i = 0; i < perPage.length; i++) {
    const entry = perPage[i];
    if (!entry) continue;
    const { page, box, markBox, centers, drawAngle } = entry;

    // Anchor is computed in USER space about the actually-applied drawAngle
    // (see computePlacements). drawTheta is per-page (depends on /Rotate).
    const drawTheta = (drawAngle * Math.PI) / 180;
    for (const { cx, cy } of centers) {
      const uc = visibleToUser(cx, cy, box);
      if (config.kind === "text" && font) {
        // Text anchors at baseline-left: user-space center → baseline anchor.
        const { ax, ay } = textAnchorFromCenter(
          uc.x,
          uc.y,
          font,
          config.text,
          config.fontSize,
          drawTheta,
        );
        page.drawText(config.text, {
          x: ax,
          y: ay,
          size: config.fontSize,
          font,
          color: config.color,
          opacity: config.opacity,
          rotate: degrees(drawAngle),
          blendMode: BlendMode.Multiply,
        });
      } else if (image) {
        // Image anchors at bottom-left: user-space center → anchor. Width/height
        // are the per-page §5.4 mark box (page-width-relative).
        const { ax, ay } = centerToAnchor(uc.x, uc.y, markBox.width, markBox.height, drawTheta);
        page.drawImage(image, {
          x: ax,
          y: ay,
          width: markBox.width,
          height: markBox.height,
          opacity: config.opacity,
          rotate: degrees(drawAngle),
          blendMode: BlendMode.Multiply,
        });
      }
    }
    opts?.onProgress?.(i + 1, total);

    // Drawing runs on the main thread; a long synchronous loop freezes the tab
    // and blocks the progress bar from repainting. When a caller is observing
    // progress (the interactive path), yield to the event loop between pages so
    // the UI stays responsive and the bar advances per page. Batch/test callers
    // pass no onProgress and run uninterrupted.
    if (opts?.onProgress && i + 1 < total) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  doc.setProducer("");
  doc.setCreator("");
  return doc.save({ useObjectStreams: true });
}

/** Decode an image File to a loaded HTMLImageElement, or throw a clear error. */
async function decodeImage(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't decode this image. Use PNG, JPG, or WebP."));
    i.src = dataUrl;
  });
}

/**
 * Resolve a file to one of the three supported watermark image formats, or null.
 * MIME is authoritative; when it is absent or generic (some OS drag-drop and
 * file-picker paths report `""` or `application/octet-stream`), fall back to the
 * extension — mirroring `validatePdfFile`'s type-or-extension acceptance. A file
 * that explicitly declares an UNSUPPORTED image MIME (e.g. `image/gif`,
 * `image/svg+xml`) is rejected even if its extension lies, so the §10.3/§14
 * "PNG/JPG/WebP only — reject the rest" boundary can't be bypassed by renaming.
 */
function classifyImageFormat(file: File): "png" | "jpeg" | "webp" | null {
  switch (file.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg": // non-standard but emitted by some browsers/OS paths
      return "jpeg";
    case "image/webp":
      return "webp";
  }
  if (file.type === "" || file.type === "application/octet-stream") {
    const name = file.name.toLowerCase();
    if (name.endsWith(".png")) return "png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
    if (name.endsWith(".webp")) return "webp";
  }
  return null;
}

/**
 * Sniff the actual raster format from the leading magic bytes — the only
 * authority on what `embedPng`/`embedJpg` will accept. MIME and extension can
 * lie (a GIF renamed `logo.png` with an empty MIME classifies as PNG and the
 * browser canvas still decodes it), so the passthrough path must confirm the
 * bytes really are PNG/JPG before handing them to pdf-lib — otherwise the embed
 * fails deep inside `applyWatermark` and the user sees a misleading
 * "PDF may be corrupt" error for a problem that is entirely the image.
 */
function sniffRasterFormat(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export async function prepareImageBytes(
  file: File,
): Promise<{ bytes: Uint8Array; type: "image/png" | "image/jpeg" }> {
  if (file.size > MAX_IMAGE_SIZE) {
    const capMb = Math.round(MAX_IMAGE_SIZE / (1024 * 1024));
    throw new Error(`Image too large. Maximum size is ${capMb}MB.`);
  }

  // Pin the format up front (PNG/JPG/WebP only). GIF, SVG, BMP, etc. — including
  // anything the browser canvas happens to decode — are rejected here, not
  // silently transcoded, per plan §10.3/§14.
  const format = classifyImageFormat(file);
  if (!format) {
    throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
  }

  // PNG/JPG bytes are embedded directly by pdf-lib. Confirm the bytes really are
  // PNG/JPG (not a mislabeled GIF/other the canvas would still decode) so the
  // §10.3/§14 boundary holds and a content/extension mismatch is rejected HERE
  // with a clear message — not deep inside embedPng/Jpg as a "corrupt PDF" error.
  // Then decode to reject truncated-but-correctly-typed garbage.
  if (format === "png" || format === "jpeg") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffRasterFormat(bytes);
    if (sniffed !== "png" && sniffed !== "jpeg") {
      throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
    }
    await decodeImage(file);
    return { bytes, type: sniffed === "png" ? "image/png" : "image/jpeg" };
  }

  // WebP → transcode to PNG via canvas (pdf-lib only embeds PNG/JPG). Sniff the
  // bytes first: the canvas would happily decode a GIF (or any raster) handed in
  // under a .webp name / image/webp MIME and transcode it to PNG, silently
  // bypassing the §10.3/§14 "WebP only" boundary. Require real WebP magic bytes.
  const webpBytes = new Uint8Array(await file.arrayBuffer());
  if (sniffRasterFormat(webpBytes) !== "webp") {
    throw new Error("Unsupported image type. Use PNG, JPG, or WebP.");
  }
  const img = await decodeImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process this image.");
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Couldn't process this image."));
    }, "image/png");
  });

  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "image/png" };
}

/** Unique targeted pages for a spec. Returns 0 on parse error. */
export function countTargetPages(spec: string, totalPages: number): number {
  const result = parsePageRanges(spec, totalPages);
  if (result.error) return 0;
  const set = new Set<number>();
  for (const r of result.ranges) {
    for (const idx of r.indices) set.add(idx);
  }
  return set.size;
}

export function buildWatermarkedFilename(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  const sanitized = base
    .replace(/[^A-Za-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sanitized || "document"}-watermarked.pdf`;
}

// ── Re-exports (single import path for Route.tsx + tests) ──

export { validatePdfFile, readFileBytes, getPdfMeta, downloadBlob } from "@/lib/pdf";
export { parsePageRanges };
export type { PdfMeta, ValidationResult, ParsedRange, ParseResult } from "@/lib/pdf";
