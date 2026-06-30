import { __resetEncodeProbeCache } from "@/lib/encode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapError,
  type LoadedImage,
  type LoadedLogo,
  MAX_DRAWS,
  MIN_FONT_PX,
  type WatermarkConfig,
  anchorCenter,
  buildWatermarkedFilename,
  computeCenters,
  cssFontSpec,
  ensureFontLoaded,
  extFor,
  fitFontPx,
  loadOrientedImage,
  logoMarkBox,
  mimeFor,
  qualityFor,
  renderWatermark,
  resolvePx,
  rotatedHalfExtents,
  textMarkBox,
  watermarkToBlob,
} from "../watermarker";

// @/lib/image is real except sniffImageMeta / readImageDims, which the load-path tests drive.
vi.mock("@/lib/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image")>();
  return { ...actual, sniffImageMeta: vi.fn(), readImageDims: vi.fn() };
});
import { readImageDims, sniffImageMeta } from "@/lib/image";

// ── Spy ctx (canvas-mock.ts lacks measureText/fillText/translate/rotate/globalAlpha — §12) ──

interface TextMetricsLike {
  width: number;
  actualBoundingBoxLeft?: number;
  actualBoundingBoxRight?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
}

/** Parse the px size out of a `${weight} ${px}px ${family}` font string. */
function pxOf(font: string): number {
  const m = /([\d.]+)px/.exec(font);
  return m ? Number(m[1]) : 0;
}

function makeSpyCtx(
  measure: (text: string, fontPx: number) => TextMetricsLike = (t) => ({ width: t.length * 10 }),
) {
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineJoin: "",
    lineWidth: 0,
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text: string) => measure(text, pxOf(ctx.font))),
  };
  return ctx;
}

function textConfig(over: Partial<WatermarkConfig> = {}): WatermarkConfig {
  return {
    kind: "text",
    text: "© Utilbench",
    fontId: "inter",
    fontWeight: "bold",
    fontSizePct: 6,
    color: "#ffffff",
    outline: true,
    outlineColor: "#000000",
    outlineWidthPct: 6,
    anchor: "bottom-right",
    layout: "single",
    marginPct: 3,
    tileGapPct: 8,
    rotationDeg: 0,
    opacity: 0.5,
    blend: "normal",
    ...over,
  } as WatermarkConfig;
}

function logoConfig(over: Partial<WatermarkConfig> = {}): WatermarkConfig {
  return {
    kind: "image",
    scalePct: 25,
    anchor: "center",
    layout: "single",
    marginPct: 3,
    tileGapPct: 8,
    rotationDeg: 0,
    opacity: 0.5,
    blend: "normal",
    ...over,
  } as WatermarkConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Pure geometry ───────────────────────────────────────────────────────────────

describe("anchorCenter (Y-DOWN — the inversion vs the PDF sibling)", () => {
  const W = 1000;
  const H = 600;
  const hx = 50;
  const hy = 20;
  const margin = 10;

  it("top-left → small y", () => {
    expect(anchorCenter("top-left", W, H, hx, hy, margin)).toEqual({ cx: 60, cy: 30 });
  });
  it("bottom-right → large y", () => {
    expect(anchorCenter("bottom-right", W, H, hx, hy, margin)).toEqual({ cx: 940, cy: 570 });
  });
  it("center → midpoint", () => {
    expect(anchorCenter("center", W, H, hx, hy, margin)).toEqual({ cx: 500, cy: 300 });
  });
});

describe("rotatedHalfExtents", () => {
  it("θ=0 → half dims", () => {
    expect(rotatedHalfExtents(100, 40, 0)).toEqual({ hx: 50, hy: 20 });
  });
  it("θ=90° → swapped", () => {
    const r = rotatedHalfExtents(100, 40, Math.PI / 2);
    expect(r.hx).toBeCloseTo(20, 6);
    expect(r.hy).toBeCloseTo(50, 6);
  });
  it("θ=45° → both grow", () => {
    const r = rotatedHalfExtents(100, 40, Math.PI / 4);
    const expected = ((100 + 40) * Math.SQRT2) / 2 / 2;
    expect(r.hx).toBeCloseTo(expected, 6);
    expect(r.hy).toBeCloseTo(expected, 6);
  });
});

describe("computeCenters", () => {
  const mark = { width: 100, height: 40 };
  const base = { anchor: "center" as const, margin: 10, tileGap: 20, rotationDeg: 0 };

  it("single → length 1 at the anchor", () => {
    const centers = computeCenters(mark, 1000, 600, { ...base, layout: "single" });
    expect(centers).toHaveLength(1);
    expect(centers[0]).toEqual({ cx: 500, cy: 300 });
  });

  it("tile → grid count grows ≈ (W·H)/(pitchX·pitchY)", () => {
    const W = 1000;
    const H = 600;
    const centers = computeCenters(mark, W, H, { ...base, layout: "tile" });
    const pitchX = 2 * (mark.width / 2) + base.tileGap; // 120
    const pitchY = 2 * (mark.height / 2) + base.tileGap; // 60
    const approx = (W / pitchX) * (H / pitchY);
    // over-scan adds ~2 rows/cols, so expect within a generous band around the area estimate.
    expect(centers.length).toBeGreaterThan(approx);
    expect(centers.length).toBeLessThan(approx * 2.5);
  });

  it("tile → over-scan starts < 0 and ends > W/H", () => {
    const W = 1000;
    const H = 600;
    const centers = computeCenters(mark, W, H, { ...base, layout: "tile" });
    const xs = centers.map((c) => c.cx);
    const ys = centers.map((c) => c.cy);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(W);
    expect(Math.max(...ys)).toBeGreaterThan(H);
  });

  it("MIN_TILE_PITCH_PX / MAX_DRAWS cap a pathological tiny-mark/tiny-gap config", () => {
    const centers = computeCenters({ width: 0.1, height: 0.1 }, 100000, 100000, {
      ...base,
      tileGap: 0,
      layout: "tile",
    });
    // Floor pitch = MIN_TILE_PITCH_PX = 8 → would be ~1.5e8 tiles; MAX_DRAWS guard stops it.
    expect(centers.length).toBeLessThanOrEqual(MAX_DRAWS + 1);
  });
});

describe("textMarkBox", () => {
  it("sums actualBoundingBox metrics when present", () => {
    const ctx = makeSpyCtx(() => ({
      width: 80,
      actualBoundingBoxLeft: 10,
      actualBoundingBoxRight: 70,
      actualBoundingBoxAscent: 30,
      actualBoundingBoxDescent: 8,
    }));
    expect(textMarkBox(ctx as unknown as CanvasRenderingContext2D, "x", 50)).toEqual({
      width: 80,
      height: 38,
    });
  });

  it("falls back to width + 1.2·fontPx when metrics absent", () => {
    const ctx = makeSpyCtx(() => ({ width: 120 }));
    expect(textMarkBox(ctx as unknown as CanvasRenderingContext2D, "x", 50)).toEqual({
      width: 120,
      height: 60,
    });
  });
});

describe("logoMarkBox", () => {
  it("width = scalePct% of imageW, aspect preserved", () => {
    // 200×100 logo (aspect 0.5), 1000-wide image, 25% → width 250, height 125.
    expect(logoMarkBox(200, 100, 1000, 800, 25, 10)).toEqual({ width: 250, height: 125 });
  });

  it("clamps a tall-narrow logo to height bound", () => {
    // 100×400 logo (aspect 4); image 1000×600, margin 50 → height capped at 600-100=500, width 125.
    const box = logoMarkBox(100, 400, 1000, 600, 90, 50);
    expect(box.height).toBeCloseTo(500, 6);
    expect(box.width).toBeCloseTo(125, 6);
  });
});

describe("resolvePx", () => {
  it("(pct/100)·ref", () => {
    expect(resolvePx(6, 1000)).toBe(60);
    expect(resolvePx(3, 500)).toBe(15);
  });

  it("WYSIWYG invariant: previewPx/naturalPx === displayW/naturalW", () => {
    const pct = 6;
    const displayW = 600;
    const naturalW = 2400;
    expect(resolvePx(pct, displayW) / resolvePx(pct, naturalW)).toBeCloseTo(displayW / naturalW, 6);
  });
});

describe("cssFontSpec", () => {
  it("exact string", () => {
    expect(cssFontSpec("bold", 96, '"Inter", sans-serif')).toBe('bold 96px "Inter", sans-serif');
  });
});

// ── fitFontPx (§3 fix) ────────────────────────────────────────────────────────

describe("fitFontPx", () => {
  it("shrinks so measureText(text).width ≤ maxWidthPx, and measure == draw", () => {
    // width scales linearly with px: width = px * 2 * text.length-factor. Here width = px * 5.
    const ctx = makeSpyCtx((_t, px) => ({ width: px * 5 }));
    const requested = 100; // → width 500
    const maxWidth = 250;
    const fitted = fitFontPx(
      ctx as unknown as CanvasRenderingContext2D,
      "long text",
      requested,
      maxWidth,
      "bold",
      '"Inter", sans-serif',
    );
    expect(fitted).toBeLessThan(requested);
    // measure at the fitted px must fit (measure == draw, the whole point).
    ctx.font = cssFontSpec("bold", fitted, '"Inter", sans-serif');
    expect(ctx.measureText("long text").width).toBeLessThanOrEqual(maxWidth + 1e-6);
  });

  it("floors at MIN_FONT_PX for impossible fits", () => {
    const ctx = makeSpyCtx((_t, px) => ({ width: px * 1000 })); // never fits
    const fitted = fitFontPx(
      ctx as unknown as CanvasRenderingContext2D,
      "x",
      100,
      10,
      "bold",
      "sans-serif",
    );
    expect(fitted).toBe(MIN_FONT_PX);
  });
});

// ── renderWatermark draw-call assertions (hand-rolled spy ctx) ────────────────

describe("renderWatermark", () => {
  const base = { width: 1000, height: 600 } as unknown as ImageBitmap;
  const logo = { width: 200, height: 100 } as unknown as ImageBitmap;
  // Text wide enough never to need shrinking at these target sizes.
  const wideMeasure = () => ({
    width: 50,
    actualBoundingBoxLeft: 25,
    actualBoundingBoxRight: 25,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 10,
  });

  it("text + outline → strokeText BEFORE fillText, no maxWidth, globalAlpha = opacity", () => {
    const ctx = makeSpyCtx(wideMeasure);
    renderWatermark(
      ctx as unknown as CanvasRenderingContext2D,
      base,
      null,
      textConfig({ outline: true, opacity: 0.5 }),
      1000,
      600,
    );
    expect(ctx.strokeText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.strokeText.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.fillText.mock.invocationCallOrder[0] as number,
    );
    expect(ctx.globalAlpha).toBe(0.5);
    // NO maxWidth arg (the §3 fit-first fix): both calls receive exactly (text, 0, 0).
    expect(ctx.strokeText).toHaveBeenCalledWith("© Utilbench", 0, 0);
    expect(ctx.fillText).toHaveBeenCalledWith("© Utilbench", 0, 0);
  });

  it("text → one translate/rotate per center, balanced save/restore", () => {
    const ctx = makeSpyCtx(wideMeasure);
    renderWatermark(
      ctx as unknown as CanvasRenderingContext2D,
      base,
      null,
      textConfig({ layout: "single" }),
      1000,
      600,
    );
    expect(ctx.translate).toHaveBeenCalledTimes(1);
    expect(ctx.rotate).toHaveBeenCalledTimes(1);
    expect(ctx.save).toHaveBeenCalledTimes(ctx.restore.mock.calls.length);
  });

  it("no outline → only fillText", () => {
    const ctx = makeSpyCtx(wideMeasure);
    renderWatermark(
      ctx as unknown as CanvasRenderingContext2D,
      base,
      null,
      textConfig({ outline: false }),
      1000,
      600,
    );
    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it("JPEG flatten → fillRect BEFORE drawImage(base)", () => {
    const ctx = makeSpyCtx(wideMeasure);
    renderWatermark(
      ctx as unknown as CanvasRenderingContext2D,
      base,
      null,
      textConfig(),
      1000,
      600,
      "#ffffff",
    );
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1000, 600);
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.drawImage.mock.invocationCallOrder[0] as number,
    );
  });

  it("logo kind → drawImage(logo, -w/2, -h/2, w, h) centered", () => {
    const ctx = makeSpyCtx(wideMeasure);
    renderWatermark(
      ctx as unknown as CanvasRenderingContext2D,
      base,
      logo,
      logoConfig({ scalePct: 25 }),
      1000,
      600,
    );
    // 25% of 1000 = 250 wide, aspect 0.5 → 125 tall.
    expect(ctx.drawImage).toHaveBeenCalledWith(logo, -125, -62.5, 250, 125);
  });

  it("tile → fillText called centers.length times (base uses drawImage, not fillText)", () => {
    const ctx = makeSpyCtx(wideMeasure);
    const cfg = textConfig({ layout: "tile", rotationDeg: 0, tileGapPct: 8 });
    // Recompute expected center count via the same mark the renderer measures.
    const margin = resolvePx(cfg.marginPct, Math.min(1000, 600));
    const tileGap = resolvePx(cfg.tileGapPct, 1000);
    const mark = { width: 50, height: 20 }; // wideMeasure box
    const centers = computeCenters(mark, 1000, 600, {
      anchor: cfg.anchor,
      layout: cfg.layout,
      margin,
      tileGap,
      rotationDeg: cfg.rotationDeg,
    });
    renderWatermark(ctx as unknown as CanvasRenderingContext2D, base, null, cfg, 1000, 600);
    expect(ctx.fillText).toHaveBeenCalledTimes(centers.length);
    expect(ctx.translate).toHaveBeenCalledTimes(centers.length);
  });
});

// ── ensureFontLoaded ──────────────────────────────────────────────────────────

describe("ensureFontLoaded", () => {
  it("no-throw when document.fonts is absent (jsdom)", async () => {
    expect(document.fonts).toBeUndefined();
    await expect(ensureFontLoaded('bold 96px "Inter", sans-serif')).resolves.toBeUndefined();
  });

  it("calls document.fonts.load with the exact cssFontSpec string when present", async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, "fonts", { value: { load }, configurable: true });
    try {
      const spec = cssFontSpec("bold", 96, '"Inter", sans-serif');
      await ensureFontLoaded(spec);
      expect(load).toHaveBeenCalledWith(spec);
    } finally {
      Object.defineProperty(document, "fonts", { value: undefined, configurable: true });
    }
  });
});

// ── watermarkToBlob ──────────────────────────────────────────────────────────

describe("watermarkToBlob", () => {
  const base: LoadedImage = {
    bitmap: { width: 800, height: 600 } as unknown as ImageBitmap,
    naturalWidth: 800,
    naturalHeight: 600,
    format: "png",
    fileName: "p.png",
    fileSize: 1234,
  };
  const logo: LoadedLogo = {
    bitmap: { width: 200, height: 100 } as unknown as ImageBitmap,
    width: 200,
    height: 100,
    fileName: "logo.png",
  };

  /** Install a fake canvas (full spy ctx) so renderWatermark's translate/rotate exist. */
  function installCanvas(opts: {
    toBlob?: (cb: (b: Blob | null) => void, mime?: string, q?: number) => void;
    toDataURL?: (mime?: string) => string;
  }) {
    const calls: { mime?: string; quality?: number }[] = [];
    const ctx = makeSpyCtx();
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = real(tag);
      if (tag === "canvas") {
        (el as unknown as Record<string, unknown>).getContext = () => ctx;
        (el as unknown as Record<string, unknown>).toBlob =
          opts.toBlob ??
          ((cb: (b: Blob | null) => void, mime?: string, q?: number) => {
            calls.push({ mime, quality: q });
            cb(new Blob(["x"], { type: mime ?? "image/png" }));
          });
        (el as unknown as Record<string, unknown>).toDataURL =
          opts.toDataURL ?? ((mime?: string) => `data:${mime ?? "image/png"};base64,mock`);
      }
      return el;
    }) as typeof document.createElement);
    return { calls };
  }

  it("PNG → toBlob with image/png and no quality; canvas sized to natural dims", async () => {
    const { calls } = installCanvas({});
    const res = await watermarkToBlob(base, logo, logoConfig(), {
      format: "png",
      quality: 90,
      jpegBackground: "#fff",
    });
    expect(calls[0]?.mime).toBe("image/png");
    expect(calls[0]?.quality).toBeUndefined();
    expect(res.mime).toBe("image/png");
    expect(res.ext).toBe("png");
    expect(res.width).toBe(800);
    expect(res.height).toBe(600);
  });

  it("JPEG → image/jpeg with quality/100", async () => {
    const { calls } = installCanvas({});
    const res = await watermarkToBlob(base, logo, logoConfig(), {
      format: "jpeg",
      quality: 80,
      jpegBackground: "#fff",
    });
    expect(calls[0]?.mime).toBe("image/jpeg");
    expect(calls[0]?.quality).toBeCloseTo(0.8, 6);
    expect(res.ext).toBe("jpg");
  });

  it("WebP-unsupported keep-format → PNG fallback", async () => {
    __resetEncodeProbeCache();
    const { calls } = installCanvas({ toDataURL: () => "data:image/png;base64,nope" });
    const webpBase: LoadedImage = { ...base, format: "webp" };
    const res = await watermarkToBlob(webpBase, logo, logoConfig(), {
      format: "keep",
      quality: 90,
      jpegBackground: "#fff",
    });
    expect(calls[0]?.mime).toBe("image/png");
    expect(res.mime).toBe("image/png");
    __resetEncodeProbeCache();
  });

  it("toBlob null → throws", async () => {
    installCanvas({ toBlob: (cb) => cb(null) });
    await expect(
      watermarkToBlob(base, logo, logoConfig(), {
        format: "png",
        quality: 90,
        jpegBackground: "#fff",
      }),
    ).rejects.toThrow(/export/i);
  });

  it("blob.type !== mime → throws (type backstop)", async () => {
    installCanvas({
      toBlob: (cb, _mime) => cb(new Blob(["x"], { type: "image/png" })),
    });
    await expect(
      watermarkToBlob(base, logo, logoConfig(), {
        format: "webp",
        quality: 90,
        jpegBackground: "#fff",
      }),
    ).rejects.toThrow(/can't encode/i);
  });
});

// ── Load path ───────────────────────────────────────────────────────────────

describe("loadOrientedImage", () => {
  function file() {
    return new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
  }

  it("orientation: createImageBitmap called with from-image; naturalW/H from bitmap (swapped)", async () => {
    vi.mocked(sniffImageMeta).mockReturnValue({ format: "png" });
    vi.mocked(readImageDims).mockReturnValue({ width: 100, height: 100 });
    const cib = vi
      .fn()
      .mockResolvedValue({ width: 600, height: 800, close: vi.fn() } as unknown as ImageBitmap);
    vi.stubGlobal("createImageBitmap", cib);

    const loaded = await loadOrientedImage(file());
    expect(cib).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ imageOrientation: "from-image" }),
    );
    expect(loaded.naturalWidth).toBe(600);
    expect(loaded.naturalHeight).toBe(800);
  });

  it("cap path: 9000×9000 → CapError BEFORE decode", async () => {
    vi.mocked(sniffImageMeta).mockReturnValue({ format: "png" });
    vi.mocked(readImageDims).mockReturnValue({ width: 9000, height: 9000 });
    const cib = vi.fn();
    vi.stubGlobal("createImageBitmap", cib);

    await expect(loadOrientedImage(file())).rejects.toBeInstanceOf(CapError);
    expect(cib).not.toHaveBeenCalled();
  });

  it("animated WebP → generic animated error, no decode", async () => {
    vi.mocked(sniffImageMeta).mockReturnValue({ format: "webp", animated: true });
    const cib = vi.fn();
    vi.stubGlobal("createImageBitmap", cib);
    await expect(loadOrientedImage(file())).rejects.toThrow(/animated/i);
    expect(cib).not.toHaveBeenCalled();
  });

  it("APNG → generic animated error, no decode", async () => {
    vi.mocked(sniffImageMeta).mockReturnValue({ format: "png", animated: true });
    const cib = vi.fn();
    vi.stubGlobal("createImageBitmap", cib);
    await expect(loadOrientedImage(file())).rejects.toThrow(/animated/i);
    expect(cib).not.toHaveBeenCalled();
  });

  it("unrecognized format → corrupt error", async () => {
    vi.mocked(sniffImageMeta).mockReturnValue({ format: null });
    const cib = vi.fn();
    vi.stubGlobal("createImageBitmap", cib);
    await expect(loadOrientedImage(file())).rejects.toThrow(/corrupt/i);
    expect(cib).not.toHaveBeenCalled();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe("buildWatermarkedFilename", () => {
  it("sanitizes and appends -watermarked.<ext>", () => {
    expect(buildWatermarkedFilename("My Photo!.png", "jpg")).toBe("My-Photo-watermarked.jpg");
  });
  it("falls back to image", () => {
    expect(buildWatermarkedFilename("!!!.png", "png")).toBe("image-watermarked.png");
  });
});

describe("format helpers", () => {
  it("mimeFor", () => {
    expect(mimeFor("png")).toBe("image/png");
    expect(mimeFor("jpeg")).toBe("image/jpeg");
    expect(mimeFor("webp")).toBe("image/webp");
  });
  it("qualityFor", () => {
    expect(qualityFor("png", 90)).toBeUndefined();
    expect(qualityFor("jpeg", 80)).toBeCloseTo(0.8, 6);
    expect(qualityFor("webp", 50)).toBeCloseTo(0.5, 6);
  });
  it("extFor", () => {
    expect(extFor("png")).toBe("png");
    expect(extFor("jpeg")).toBe("jpg");
    expect(extFor("webp")).toBe("webp");
  });
});
