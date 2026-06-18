import { setupCanvasMock, setupImageMock, setupURLMock } from "@/test/canvas-mock";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ImageWatermarkConfig,
  MARGIN,
  MAX_DRAWS,
  type MarkBox,
  type TextWatermarkConfig,
  type VisibleBox,
  applyWatermark,
  buildWatermarkedFilename,
  computeCenters,
  computePlacements,
  countTargetPages,
  finalDrawAngle,
  imageMarkBox,
  normalizePageRotation,
  parsePageRanges,
  prepareImageBytes,
  textAnchorFromCenter,
  validateWinAnsi,
} from "../watermarker";

const EPS = 1e-6;

function box(overrides: Partial<VisibleBox> = {}): VisibleBox {
  return {
    originX: 0,
    originY: 0,
    width: 612,
    height: 792,
    rotation: 0,
    ...overrides,
  };
}

const MARK: MarkBox = { width: 200, height: 60 };

// ── A minimal real PNG (1×1 red) + JPG produced via pdf-lib-friendly bytes ──
// 1×1 red PNG, base64.
const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// 1×1 JPEG, base64 (valid baseline JPEG).
const RED_JPG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function makeDoc(
  pages: { w: number; h: number; rotate?: number; crop?: [number, number, number, number] }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const page = doc.addPage([p.w, p.h]);
    if (p.rotate !== undefined) page.setRotation(degrees(p.rotate));
    if (p.crop) page.setCropBox(p.crop[0], p.crop[1], p.crop[2], p.crop[3]);
  }
  return doc.save();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizePageRotation / finalDrawAngle
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizePageRotation", () => {
  it("normalizes negatives and overflow to {0,90,180,270}", () => {
    expect(normalizePageRotation(0)).toBe(0);
    expect(normalizePageRotation(90)).toBe(90);
    expect(normalizePageRotation(-90)).toBe(270); // modulo THEN reduce
    expect(normalizePageRotation(450)).toBe(90);
    expect(normalizePageRotation(-180)).toBe(180);
    expect(normalizePageRotation(720)).toBe(0);
  });
});

describe("finalDrawAngle", () => {
  it("is userRotation + pageRotation, normalized to [−180,180)", () => {
    // PLUS: counters the viewer's CW /Rotate so the mark reads upright.
    // Verified by rasterizing /Rotate 90 & 270 pages (minus → upside-down).
    expect(finalDrawAngle(0, 90)).toBe(90);
    expect(finalDrawAngle(45, 0)).toBe(45);
    expect(finalDrawAngle(0, 270)).toBe(-90); // 0+270 = 270 → −90
    expect(finalDrawAngle(0, 180)).toBe(-180); // formula range is [−180,180); both = same rotation
    expect(finalDrawAngle(0, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePlacements — angle 0, all 9 anchors (hand-computed)
// ─────────────────────────────────────────────────────────────────────────────

describe("computePlacements: angle=0, single, 9 anchors", () => {
  const w = MARK.width; // 200
  const h = MARK.height; // 60
  const vw = 612;
  const vh = 792;
  const m = MARGIN; // 24
  // At angle 0, image bottom-left x = cx − w/2, y = cy − h/2.
  const cases: { anchor: TextWatermarkConfig["anchor"]; cx: number; cy: number }[] = [
    { anchor: "center", cx: vw / 2, cy: vh / 2 },
    { anchor: "top-left", cx: m + w / 2, cy: vh - m - h / 2 },
    { anchor: "top-center", cx: vw / 2, cy: vh - m - h / 2 },
    { anchor: "top-right", cx: vw - m - w / 2, cy: vh - m - h / 2 },
    { anchor: "middle-left", cx: m + w / 2, cy: vh / 2 },
    { anchor: "middle-right", cx: vw - m - w / 2, cy: vh / 2 },
    { anchor: "bottom-left", cx: m + w / 2, cy: m + h / 2 },
    { anchor: "bottom-center", cx: vw / 2, cy: m + h / 2 },
    { anchor: "bottom-right", cx: vw - m - w / 2, cy: m + h / 2 },
  ];

  for (const c of cases) {
    it(`anchor=${c.anchor}`, () => {
      const spots = computePlacements(MARK, box(), {
        anchor: c.anchor,
        userRotation: 0,
        layout: "single",
        tileGap: 0,
        margin: MARGIN,
      });
      expect(spots).toHaveLength(1);
      const s = spots[0];
      expect(s).toBeDefined();
      if (!s) return;
      expect(s.x).toBeCloseTo(c.cx - w / 2, 6);
      expect(s.y).toBeCloseTo(c.cy - h / 2, 6);
      expect(s.angleDeg).toBe(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// computePlacements — Step B formula at center, angle −45 and 90
// ─────────────────────────────────────────────────────────────────────────────

describe("computePlacements: Step B centering formula", () => {
  const w = MARK.width;
  const h = MARK.height;
  const cx = 306;
  const cy = 396;

  function expectedAnchor(theta: number): { ax: number; ay: number } {
    const ax = cx - (w / 2) * Math.cos(theta) + (h / 2) * Math.sin(theta);
    const ay = cy - (w / 2) * Math.sin(theta) - (h / 2) * Math.cos(theta);
    return { ax, ay };
  }

  for (const deg of [-45, 90]) {
    it(`angle=${deg} at center matches Step B`, () => {
      const theta = (deg * Math.PI) / 180;
      const spots = computePlacements(MARK, box(), {
        anchor: "center",
        userRotation: deg,
        layout: "single",
        tileGap: 0,
        margin: MARGIN,
      });
      const s = spots[0];
      expect(s).toBeDefined();
      if (!s) return;
      const exp = expectedAnchor(theta); // rotation 0 → user == visible
      expect(s.x).toBeCloseTo(exp.ax, 6);
      expect(s.y).toBeCloseTo(exp.ay, 6);
      expect(s.angleDeg).toBe(deg);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// computePlacements — Step C /Rotate mapping (0/90/180/270) + drawAngle sign
// ─────────────────────────────────────────────────────────────────────────────

describe("computePlacements: Step C round-trip INVARIANT (off-center, all rotations)", () => {
  // The discriminating guard: reconstruct the mark's user-space visual center from
  // the returned spot + actually-applied drawAngle, forward-map it back to VISIBLE
  // space with an INDEPENDENTLY-written `userToVisible`, and assert it equals the
  // Step A target from `computeCenters`. Uses OFF-CENTER anchors (center is the
  // fixed point of every rotation and hides axis-swap bugs) and a non-zero
  // userRotation. `userToVisible` is pinned to the rasterizer-confirmed ground
  // truth: user (0,0) → visible top-left at /Rotate 90.
  function reconstructCenter(spot: { x: number; y: number; angleDeg: number }, mark: MarkBox) {
    const a = (spot.angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const offX = (mark.width / 2) * cos - (mark.height / 2) * sin;
    const offY = (mark.width / 2) * sin + (mark.height / 2) * cos;
    return { x: spot.x + offX, y: spot.y + offY };
  }
  // Forward user→visible. Hand-written to the verified rotation mapping, NOT
  // derived from visibleToUser, so a reintroduced swap makes the round-trip fail.
  function userToVisible(ux: number, uy: number, b: VisibleBox) {
    const W = b.width;
    const H = b.height;
    const x = ux - b.originX;
    const y = uy - b.originY;
    switch (b.rotation) {
      case 90:
        return { vx: y, vy: W - x };
      case 180:
        return { vx: W - x, vy: H - y };
      case 270:
        return { vx: H - y, vy: x };
      default:
        return { vx: x, vy: y };
    }
  }

  const anchors: TextWatermarkConfig["anchor"][] = ["top-left", "top-right", "bottom-right"];
  for (const rot of [0, 90, 180, 270]) {
    for (const userRotation of [0, -45]) {
      for (const anchor of anchors) {
        it(`rot=${rot}, userRot=${userRotation}, anchor=${anchor}`, () => {
          const b = box({ rotation: rot, originX: 50, originY: 70 });
          const opts = {
            anchor,
            userRotation,
            layout: "single" as const,
            tileGap: 0,
            margin: MARGIN,
          };
          const expected = computeCenters(MARK, b, opts)[0];
          const s = computePlacements(MARK, b, opts)[0];
          if (!expected || !s) throw new Error("missing");
          const u = reconstructCenter(s, MARK);
          const v = userToVisible(u.x, u.y, b);
          expect(v.vx).toBeCloseTo(expected.cx, 4);
          expect(v.vy).toBeCloseTo(expected.cy, 4);
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// imageMarkBox — §5.4 page-relative sizing + height clamp
// ─────────────────────────────────────────────────────────────────────────────

describe("imageMarkBox (§5.4)", () => {
  it("width is a fraction of VISIBLE page width; aspect preserved", () => {
    // 200×100 image (aspect 0.5), scale 0.5 on a 600-wide page → 300 wide, 150 tall.
    const mb = imageMarkBox(200, 100, box({ width: 600, height: 800, rotation: 0 }), 0.5);
    expect(mb.width).toBeCloseTo(300, 6);
    expect(mb.height).toBeCloseTo(150, 6);
  });

  it("uses the swapped visible width on a /Rotate 90 page", () => {
    // rot90: visible width = page height = 800. scale 0.5 → 400 wide.
    const mb = imageMarkBox(200, 100, box({ width: 600, height: 800, rotation: 90 }), 0.5);
    expect(mb.width).toBeCloseTo(400, 6);
    expect(mb.height).toBeCloseTo(200, 6);
  });

  it("clamps a tall/narrow logo to the visible height", () => {
    // 100×1000 image (very tall), scale 1 on a 600×800 page: width 600 → height 6000,
    // exceeds 800, so clamp height=800, width=80.
    const mb = imageMarkBox(100, 1000, box({ width: 600, height: 800, rotation: 0 }), 1);
    expect(mb.height).toBeCloseTo(800, 6);
    expect(mb.width).toBeCloseTo(80, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePlacements — offset CropBox includes origin
// ─────────────────────────────────────────────────────────────────────────────

describe("computePlacements: offset CropBox adds origin", () => {
  it("includes originX/originY in user coords", () => {
    const offset = box({ originX: 50, originY: 70, rotation: 0 });
    const spots = computePlacements(MARK, offset, {
      anchor: "center",
      userRotation: 0,
      layout: "single",
      tileGap: 0,
      margin: MARGIN,
    });
    const s = spots[0];
    if (!s) throw new Error("no spot");
    // Same as identity case (206,366) plus origin (50,70).
    expect(s.x).toBeCloseTo(206 + 50, 6);
    expect(s.y).toBeCloseTo(366 + 70, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// text vs image anchor: textAnchorFromCenter
// ─────────────────────────────────────────────────────────────────────────────

describe("text anchor vs image anchor", () => {
  it("image bottom-left is exact center − half extents at angle 0", () => {
    const spots = computePlacements({ width: 100, height: 40 }, box(), {
      anchor: "center",
      userRotation: 0,
      layout: "single",
      tileGap: 0,
      margin: MARGIN,
    });
    const s = spots[0];
    if (!s) throw new Error("no spot");
    expect(s.x).toBeCloseTo(306 - 50, 6);
    expect(s.y).toBeCloseTo(396 - 20, 6);
  });

  it("text baseline anchor differs from bottom-left by the descent shift", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = "CONFIDENTIAL";
    const size = 48;
    const theta = 0;
    const w = font.widthOfTextAtSize(text, size);
    const hFull = font.heightAtSize(size);
    const hNoDesc = font.heightAtSize(size, { descender: false });
    const descent = hFull - hNoDesc;
    const cx = 306;
    const cy = 396;
    const { ax, ay } = textAnchorFromCenter(cx, cy, font, text, size, theta);
    // angle 0: ax = cx − w/2; ay = cy − hNoDesc/2 − descent/2*cos(0) = cy − hNoDesc/2 − descent/2
    expect(ax).toBeCloseTo(cx - w / 2, 6);
    expect(ay).toBeCloseTo(cy - hNoDesc / 2 - descent / 2, 6);
    // Sanity: a bottom-left anchor would be cy − hFull/2; baseline is higher (less negative).
    expect(ay).toBeGreaterThan(cy - hFull / 2 - EPS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tile layout: grid count, pitch, edge bleed, MAX_DRAWS
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCenters: tile layout", () => {
  it("produces a grid with pitch = 2*halfExtent + gap and edge bleed", () => {
    const mark: MarkBox = { width: 100, height: 50 };
    const gap = 20;
    const b = box({ width: 600, height: 800, rotation: 0 });
    const centers = computeCenters(mark, b, {
      anchor: "center",
      userRotation: 0,
      layout: "tile",
      tileGap: gap,
      margin: MARGIN,
    });
    // angle 0: hx=50, hy=25. pitchX=120, pitchY=70.
    const pitchX = 100 + gap;
    const pitchY = 50 + gap;
    // First center is at (hx, hy) = (50,25).
    const first = centers[0];
    if (!first) throw new Error("no centers");
    expect(first.cx).toBeCloseTo(50, 6);
    expect(first.cy).toBeCloseTo(25, 6);
    // Second column center steps by pitchX.
    const second = centers[1];
    if (!second) throw new Error("no second");
    expect(second.cx).toBeCloseTo(50 + pitchX, 6);
    expect(second.cy).toBeCloseTo(25, 6);
    // Edge-to-edge coverage (not strict bleed): first tile flush at 0, last tile
    // reaches within one tileGap of the far edge.
    const minCx = Math.min(...centers.map((c) => c.cx));
    const maxCx = Math.max(...centers.map((c) => c.cx));
    const maxCy = Math.max(...centers.map((c) => c.cy));
    expect(minCx - 50).toBeLessThanOrEqual(0); // near-edge start
    expect(maxCx + 50).toBeGreaterThanOrEqual(600 - gap); // covers to within a gap
    expect(maxCy + 25).toBeGreaterThanOrEqual(800 - gap);
    // Grid count: loop runs while start < dim + halfExtent.
    let expectedCols = 0;
    for (let cx = 50; cx < 600 + 50; cx += pitchX) expectedCols++;
    let expectedRows = 0;
    for (let cy = 25; cy < 800 + 25; cy += pitchY) expectedRows++;
    expect(centers.length).toBe(expectedCols * expectedRows);
  });

  it("respects MAX_DRAWS cap with a tiny mark and zero gap", () => {
    const mark: MarkBox = { width: 1, height: 1 };
    const b = box({ width: 100000, height: 100000, rotation: 0 });
    const centers = computeCenters(mark, b, {
      anchor: "center",
      userRotation: 0,
      layout: "tile",
      tileGap: 0,
      margin: MARGIN,
    });
    expect(centers.length).toBeLessThanOrEqual(MAX_DRAWS + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyWatermark (text)
// ─────────────────────────────────────────────────────────────────────────────

function textConfig(overrides: Partial<TextWatermarkConfig> = {}): TextWatermarkConfig {
  return {
    kind: "text",
    text: "CONFIDENTIAL",
    fontName: "Helvetica",
    fontSize: 48,
    color: rgb(1, 0, 0),
    opacity: 0.3,
    rotation: 45,
    layout: "single",
    anchor: "center",
    tileGap: 40,
    ...overrides,
  };
}

describe("applyWatermark (text)", () => {
  it("loads, preserves page count", async () => {
    const bytes = await makeDoc([
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ]);
    const out = await applyWatermark(bytes, textConfig(), { mode: "all" });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it("targets only the requested pages (output differs from all)", async () => {
    const bytes = await makeDoc([
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ]);
    const allOut = await applyWatermark(bytes, textConfig({ layout: "tile" }), { mode: "all" });
    const oneOut = await applyWatermark(bytes, textConfig({ layout: "tile" }), {
      mode: "ranges",
      spec: "1",
    });
    expect(allOut.byteLength).not.toBe(oneOut.byteLength);
    expect(allOut.byteLength).toBeGreaterThan(oneOut.byteLength);
  });

  it("throws on encrypted input", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const encrypted = await doc.save();
    // Force isEncrypted by stubbing load result is hard; instead encrypt via setting.
    // pdf-lib can't easily encrypt; simulate by mocking isEncrypted getter.
    const realLoad = PDFDocument.load.bind(PDFDocument);
    vi.spyOn(PDFDocument, "load").mockImplementation(async (...args) => {
      const d = await realLoad(args[0] as Uint8Array, args[1]);
      Object.defineProperty(d, "isEncrypted", { get: () => true });
      return d;
    });
    await expect(applyWatermark(encrypted, textConfig(), { mode: "all" })).rejects.toThrow(
      /encrypted/i,
    );
  });

  it("throws on invalid page spec", async () => {
    const bytes = await makeDoc([{ w: 612, h: 792 }]);
    await expect(
      applyWatermark(bytes, textConfig(), { mode: "ranges", spec: "9-12" }),
    ).rejects.toThrow();
  });

  it("throws when text has a non-WinAnsi char", async () => {
    const bytes = await makeDoc([{ w: 612, h: 792 }]);
    await expect(
      applyWatermark(bytes, textConfig({ text: "日本語" }), { mode: "all" }),
    ).rejects.toThrow();
  });

  it("rotated/offset pages still produce loadable output", async () => {
    const bytes = await makeDoc([
      { w: 612, h: 792, rotate: 90 },
      { w: 612, h: 792, rotate: 270, crop: [20, 30, 500, 700] },
    ]);
    const out = await applyWatermark(bytes, textConfig({ layout: "tile" }), { mode: "all" });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("pre-flights the draw budget and throws before drawing when tiles exceed MAX_DRAWS", async () => {
    // Tiny font + zero gap on a huge page → astronomically many tiles.
    const bytes = await makeDoc([{ w: 20000, h: 20000 }]);
    const cfg = textConfig({ text: ".", fontSize: 1, layout: "tile", tileGap: 0, rotation: 0 });
    await expect(applyWatermark(bytes, cfg, { mode: "all" })).rejects.toThrow(
      /Too many watermark/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyWatermark (image)
// ─────────────────────────────────────────────────────────────────────────────

function imageConfig(
  bytes: Uint8Array,
  type: "image/png" | "image/jpeg",
  overrides: Partial<ImageWatermarkConfig> = {},
): ImageWatermarkConfig {
  return {
    kind: "image",
    imageBytes: bytes,
    imageType: type,
    scale: 1,
    opacity: 0.5,
    rotation: 0,
    layout: "single",
    anchor: "center",
    tileGap: 40,
    ...overrides,
  };
}

describe("applyWatermark (image)", () => {
  it("embeds and draws a PNG", async () => {
    const pdf = await makeDoc([{ w: 612, h: 792 }]);
    const png = b64ToBytes(RED_PNG_B64);
    const out = await applyWatermark(pdf, imageConfig(png, "image/png"), { mode: "all" });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("embeds and draws a JPG", async () => {
    const pdf = await makeDoc([{ w: 612, h: 792 }]);
    const jpg = b64ToBytes(RED_JPG_B64);
    const out = await applyWatermark(pdf, imageConfig(jpg, "image/jpeg", { layout: "tile" }), {
      mode: "all",
    });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("throws a clear image error (not a corrupt-PDF error) when the bytes can't embed", async () => {
    const pdf = await makeDoc([{ w: 612, h: 792 }]);
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(
      applyWatermark(pdf, imageConfig(garbage, "image/png"), { mode: "all" }),
    ).rejects.toThrow(/embed the watermark image/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prepareImageBytes
// ─────────────────────────────────────────────────────────────────────────────

describe("prepareImageBytes", () => {
  it("passes PNG through with correct type", async () => {
    setupImageMock();
    const png = b64ToBytes(RED_PNG_B64);
    const file = new File([png.buffer as ArrayBuffer], "logo.png", { type: "image/png" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/png");
    expect(res.bytes.length).toBe(png.length);
  });

  it("passes JPG through with correct type", async () => {
    setupImageMock();
    const jpg = b64ToBytes(RED_JPG_B64);
    const file = new File([jpg.buffer as ArrayBuffer], "logo.jpg", { type: "image/jpeg" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/jpeg");
  });

  it("rejects an undecodable PNG/JPG instead of passing garbage to pdf-lib", async () => {
    setupImageMock({ fail: true });
    // Valid 8-byte PNG signature so it clears the magic-byte sniff, then a
    // corrupt body the decoder rejects — exercises the decode-failure path.
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])],
      "broken.png",
      { type: "image/png" },
    );
    await expect(prepareImageBytes(file)).rejects.toThrow(/decode this image/i);
  });

  it("transcodes WebP to PNG via canvas", async () => {
    setupCanvasMock();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    // Valid RIFF....WEBP magic so the byte sniff accepts it before transcode.
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const file = new File([webp.buffer as ArrayBuffer], "logo.webp", { type: "image/webp" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/png");
    expect(res.bytes.length).toBeGreaterThan(0);
  });

  it("rejects GIF bytes disguised as WebP (transcode path sniff)", async () => {
    setupCanvasMock();
    setupImageMock({ width: 10, height: 10 });
    setupURLMock();
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
    const file = new File([gif.buffer as ArrayBuffer], "logo.webp", { type: "image/webp" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("throws on oversize", async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    const file = new File([big], "huge.png", { type: "image/png" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/too large/i);
  });

  it("throws on unsupported type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "doc.txt", { type: "text/plain" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("rejects GIF even though the canvas could decode it (plan §10.3/§14)", async () => {
    setupImageMock();
    const file = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], "anim.gif", {
      type: "image/gif",
    });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("rejects SVG", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "logo.svg", { type: "image/svg+xml" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("rejects an explicit image/gif even if the name lies with a .png extension", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "evil.png", { type: "image/gif" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("accepts a PNG with an empty MIME via its extension", async () => {
    setupImageMock();
    const png = b64ToBytes(RED_PNG_B64);
    const file = new File([png.buffer as ArrayBuffer], "logo.png", { type: "" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/png");
    expect(res.bytes.length).toBe(png.length);
  });

  it("accepts a JPG with application/octet-stream MIME via its extension", async () => {
    setupImageMock();
    const jpg = b64ToBytes(RED_JPG_B64);
    const file = new File([jpg.buffer as ArrayBuffer], "logo.jpeg", {
      type: "application/octet-stream",
    });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/jpeg");
  });

  it("accepts the non-standard image/jpg MIME", async () => {
    setupImageMock();
    const jpg = b64ToBytes(RED_JPG_B64);
    const file = new File([jpg.buffer as ArrayBuffer], "logo.jpg", { type: "image/jpg" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/jpeg");
  });

  it("requires the full 8-byte PNG signature, not just the first four", async () => {
    setupImageMock();
    // \x89PNG with a wrong continuation — fails the full-signature check.
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 1, 2, 3]);
    const file = new File([fake.buffer as ArrayBuffer], "logo.png", { type: "image/png" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("rejects GIF bytes renamed .png with empty MIME (content sniff, not extension)", async () => {
    setupImageMock();
    // Real GIF89a header — the canvas would decode it, but pdf-lib's embedPng
    // would not, so it must be rejected at prepare time, not at apply time.
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
    const file = new File([gif.buffer as ArrayBuffer], "logo.png", { type: "" });
    await expect(prepareImageBytes(file)).rejects.toThrow(/unsupported/i);
  });

  it("derives the real type from content when the extension disagrees", async () => {
    setupImageMock();
    // Real JPEG bytes named .png with empty MIME → returned as image/jpeg.
    const jpg = b64ToBytes(RED_JPG_B64);
    const file = new File([jpg.buffer as ArrayBuffer], "logo.png", { type: "" });
    const res = await prepareImageBytes(file);
    expect(res.type).toBe("image/jpeg");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateWinAnsi
// ─────────────────────────────────────────────────────────────────────────────

describe("validateWinAnsi", () => {
  it("accepts ASCII and Latin-1", () => {
    expect(validateWinAnsi("Hello World 123", "Helvetica").ok).toBe(true);
    expect(validateWinAnsi("café résumé naïve", "TimesRoman").ok).toBe(true);
  });

  it("rejects CJK with the offending char", () => {
    const res = validateWinAnsi("日本語", "Helvetica");
    expect(res.ok).toBe(false);
    expect(res.badChar).toBe("日");
  });

  it("rejects emoji", () => {
    const res = validateWinAnsi("ok 😀", "Courier");
    expect(res.ok).toBe(false);
    expect(res.badChar).toBe("😀");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildWatermarkedFilename
// ─────────────────────────────────────────────────────────────────────────────

describe("buildWatermarkedFilename", () => {
  it("appends -watermarked.pdf", () => {
    expect(buildWatermarkedFilename("report.pdf")).toBe("report-watermarked.pdf");
  });

  it("sanitizes weird chars", () => {
    expect(buildWatermarkedFilename("my report (final)!.pdf")).toBe(
      "my-report-final-watermarked.pdf",
    );
  });

  it("falls back to document", () => {
    expect(buildWatermarkedFilename("!!!.pdf")).toBe("document-watermarked.pdf");
    expect(buildWatermarkedFilename(".pdf")).toBe("document-watermarked.pdf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePageRanges / countTargetPages (re-export + dedup semantics)
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePageRanges re-export + countTargetPages", () => {
  it("re-exports parsePageRanges", () => {
    const r = parsePageRanges("1-3", 5);
    expect(r.error).toBeUndefined();
    expect(r.ranges).toHaveLength(1);
  });

  it("counts unique targeted pages, dedup overlap: '1-3, 2-4' → 4", () => {
    expect(countTargetPages("1-3, 2-4", 10)).toBe(4);
  });

  it("counts simple ranges", () => {
    expect(countTargetPages("1,2,3", 10)).toBe(3);
    expect(countTargetPages("5-7", 10)).toBe(3);
  });

  it("returns 0 on parse error", () => {
    expect(countTargetPages("99-100", 5)).toBe(0);
    expect(countTargetPages("abc", 5)).toBe(0);
    expect(countTargetPages("", 5)).toBe(0);
  });
});
