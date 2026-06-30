import {
  Download,
  FileImage,
  ImageUp,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Stamp,
  Type,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  ErrorAlert,
  PaneHeader,
  StatusBadge,
  ToolShell,
  TwoPane,
  WarningAlert,
} from "../../components/tool-layout";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { MAX_TOTAL_SIZE } from "../../lib/image";
import { cn } from "../../lib/utils";
import {
  type Anchor,
  CapError,
  DEFAULT_PREFS,
  FONTS,
  type LoadedImage,
  type LoadedLogo,
  MAX_CANVAS_DIM,
  MAX_DRAWS,
  MAX_QUEUE_SIZE,
  type MarkBox,
  type NormFormat,
  type OutputFormat,
  type WatermarkConfig,
  type WatermarkPrefs,
  buildWatermarkedFilename,
  canEncode,
  clampToCanvasLimits,
  computeCenters,
  createBatchZip,
  cssFontSpec,
  downloadBlob,
  ensureFontLoaded,
  fitFontPx,
  formatBytes,
  loadLogo,
  loadOrientedImage,
  logoMarkBox,
  readImageDims,
  renderWatermark,
  resolvePx,
  sniffImageMeta,
  textMarkBox,
  validateImageFile,
  watermarkToBlob,
} from "./watermarker";

interface QueueItem {
  id: string;
  file: File;
  fileName: string;
  format: NormFormat;
  width: number;
  height: number;
  beforeUrl: string;
  error?: string;
}

let nextId = 0;
function uid(): string {
  return `wm-${Date.now()}-${nextId++}`;
}

/** Lightweight oriented-dims fallback via <img> when the header parser can't (compress Route.tsx:88). */
function imgDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. It may be corrupt."));
    };
    img.src = url;
  });
}

const CAP_MSG = "Image too large to watermark in your browser (over ~16 MP).";
const ANIMATED_MSG = "Animated images aren't supported — upload a static PNG, JPEG, or WebP.";

const ANCHORS: Anchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const ANCHOR_LABELS: Record<Anchor, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-left": "Middle left",
  center: "Center",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string }> = [
  { value: "keep", label: "Keep" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

const ROTATION_SNAPS = [-90, -45, 0, 45, 90];

// `WatermarkPrefs` is an `interface`, which (unlike a type literal) has no implicit index
// signature and so fails `useToolPreferences`'s `T extends Record<string, unknown>` constraint.
// This homomorphic mapped type re-expresses the same shape as a type literal, restoring the
// implicit index signature. Structurally identical to WatermarkPrefs, so it stays interchangeable.
type WatermarkPrefsRecord = { [K in keyof WatermarkPrefs]: WatermarkPrefs[K] };

/** Build the discriminated WatermarkConfig from persisted prefs (NOT the logo bitmap). */
function buildConfig(prefs: WatermarkPrefs): WatermarkConfig {
  const placement = {
    anchor: prefs.anchor,
    layout: prefs.layout,
    marginPct: prefs.marginPct,
    tileGapPct: prefs.tileGapPct,
    rotationDeg: prefs.rotationDeg,
    opacity: prefs.opacity,
    blend: prefs.blend,
  };
  if (prefs.kind === "text") {
    return {
      kind: "text",
      text: prefs.text,
      fontId: prefs.fontId,
      fontWeight: prefs.fontWeight,
      fontSizePct: prefs.fontSizePct,
      color: prefs.color,
      outline: prefs.outline,
      outlineColor: prefs.outlineColor,
      outlineWidthPct: prefs.outlineWidthPct,
      ...placement,
    };
  }
  return { kind: "image", scalePct: prefs.scalePct, ...placement };
}

export default function ImageWatermarkRoute() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LoadedImage | null>(null);
  const [logo, setLogo] = useState<LoadedLogo | null>(null);
  const [prefs, setPrefs, resetPrefs] = useToolPreferences<WatermarkPrefsRecord>(
    "image-watermark",
    DEFAULT_PREFS,
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [webpSupported, setWebpSupported] = useState(true);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const redrawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef<string>(prefs.kind === "text" ? prefs.text : "");

  // Mirror live state into refs so the empty-deps unmount cleanup never captures stale values.
  const queueRef = useRef<QueueItem[]>([]);
  const previewBitmapRef = useRef<LoadedImage | null>(null);
  // Which queue id `preview` was decoded for. `preview` lags `selectedId` until the async
  // decode resolves, so export must reuse the preview bitmap ONLY when this matches the item —
  // otherwise an apply fired right after a selection switch pairs the old bitmap with a new name.
  const previewForIdRef = useRef<string | null>(null);
  const logoRef = useRef<LoadedLogo | null>(null);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    previewBitmapRef.current = preview;
  }, [preview]);
  useEffect(() => {
    logoRef.current = logo;
  }, [logo]);

  const config = useMemo(() => buildConfig(prefs), [prefs]);
  const selectedItem = useMemo(
    () => queue.find((q) => q.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const effFormat: NormFormat =
    prefs.format === "keep" ? (selectedItem?.format ?? "png") : prefs.format;
  const showQuality = effFormat === "jpeg" || effFormat === "webp";
  const showJpegBg = effFormat === "jpeg";

  // WebP encode probe (once at mount). Fall back to PNG if a persisted pref selected an
  // unsupported WebP export so we never ship a silently-empty file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a one-shot mount probe; re-running on prefs.format would loop the PNG fallback
  useEffect(() => {
    const ok = canEncode("image/webp");
    setWebpSupported(ok);
    if (!ok && prefs.format === "webp") {
      setPrefs({ format: "png" });
      setWarning("WebP export isn't supported in this browser — using PNG instead.");
    }
  }, []);

  // ── Preview decode: only the SELECTED image is materialized full-res (§6.3) ──────
  useEffect(() => {
    if (!selectedId) {
      previewForIdRef.current = null;
      setPreview((prev) => {
        prev?.bitmap.close();
        return null;
      });
      return;
    }
    const item = queueRef.current.find((q) => q.id === selectedId);
    if (!item || item.error) return;
    let cancelled = false;
    loadOrientedImage(item.file)
      .then((loaded) => {
        if (cancelled) {
          loaded.bitmap.close();
          return;
        }
        previewForIdRef.current = selectedId;
        setPreview((prev) => {
          prev?.bitmap.close();
          return loaded;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof CapError ? CAP_MSG : (err as Error).message || ANIMATED_MSG;
        setError(msg);
        setQueue((prev) => prev.map((q) => (q.id === selectedId ? { ...q, error: msg } : q)));
        // Decode failed for the newly-selected item — drop the previous item's preview so the
        // canvas can't keep showing a different image than the one that's selected + errored.
        previewForIdRef.current = null;
        setPreview((prev) => {
          prev?.bitmap.close();
          return null;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Live preview redraw (rAF-coalesced + ~120ms text debounce, §6.3) ─────────────
  const drawPreview = useCallback(async () => {
    const canvas = previewRef.current;
    const base = preview;
    if (!canvas || !base) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || Math.min(base.naturalWidth, 600);
    const ratio = base.naturalHeight / base.naturalWidth;
    const bufW = Math.min(Math.ceil(cssW * dpr), MAX_CANVAS_DIM);
    const bufH = Math.min(Math.ceil(cssW * ratio * dpr), MAX_CANVAS_DIM);
    canvas.width = Math.max(1, bufW);
    canvas.height = Math.max(1, bufH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (config.kind === "text") {
      const family =
        (FONTS.find((f) => f.id === config.fontId) ?? FONTS[0])?.cssFamily ?? "sans-serif";
      await ensureFontLoaded(
        cssFontSpec(config.fontWeight, resolvePx(config.fontSizePct, bufW), family),
      );
      // The selection (or this canvas) may have changed while the font loaded.
      if (previewRef.current !== canvas || previewBitmapRef.current !== base) return;
    }

    // Match the JPEG export's transparency flatten (watermarker.ts:545) so the preview is true
    // WYSIWYG for a transparent base exported as JPEG (§5.6/§6.3/§11.4). Without this, a transparent
    // PNG previews as checkerboard but exports white-backed — preview and export disagree.
    const flattenBackground = effFormat === "jpeg" ? prefs.jpegBackground : undefined;
    renderWatermark(
      ctx,
      base.bitmap,
      config.kind === "image" ? (logo?.bitmap ?? null) : null,
      config,
      canvas.width,
      canvas.height,
      flattenBackground,
    );
  }, [preview, config, logo, effFormat, prefs.jpegBackground]);

  // The rAF callback must run the LATEST drawPreview, not the one captured when it was
  // scheduled — otherwise a config/preview change that lands while a frame is already pending
  // is coalesced into a redraw of the STALE state and the new state never paints.
  const drawPreviewRef = useRef(drawPreview);
  useEffect(() => {
    drawPreviewRef.current = drawPreview;
  }, [drawPreview]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
    rafRef.current = raf(() => {
      rafRef.current = null;
      void drawPreviewRef.current();
    });
  }, []);

  // Redraw on any config/preview/logo change; debounce text typing so a large bitmap
  // isn't recomposited per keystroke (the §6.3 jank guard).
  // biome-ignore lint/correctness/useExhaustiveDependencies: preview/logo are intentional redraw triggers — the body reads them only via the stable drawPreviewRef, so they must stay in the deps to re-schedule a frame when the selected image or logo changes
  useEffect(() => {
    const isText = config.kind === "text";
    const textChanged = isText && config.text !== lastTextRef.current;
    if (isText) lastTextRef.current = config.text;
    if (redrawTimerRef.current) clearTimeout(redrawTimerRef.current);
    if (textChanged) {
      redrawTimerRef.current = setTimeout(scheduleRedraw, 120);
    } else {
      scheduleRedraw();
    }
    return () => {
      if (redrawTimerRef.current) clearTimeout(redrawTimerRef.current);
    };
  }, [config, preview, logo, effFormat, prefs.jpegBackground, scheduleRedraw]);

  // Cleanup on unmount: close live bitmaps + revoke every object URL (§11.5).
  useEffect(() => {
    return () => {
      if (rafRef.current != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafRef.current);
      }
      if (redrawTimerRef.current) clearTimeout(redrawTimerRef.current);
      previewBitmapRef.current?.bitmap.close();
      logoRef.current?.bitmap.close();
      for (const item of queueRef.current) URL.revokeObjectURL(item.beforeUrl);
    };
  }, []);

  // ── Enqueue (mirrors image-compress; NO decode at enqueue, §6.2) ─────────────────
  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const incoming = Array.from(fileList);
      const accepted: QueueItem[] = [];
      const rejected: string[] = [];
      let runningTotal = queue.reduce((s, i) => s + i.file.size, 0);

      for (const file of incoming) {
        if (queue.length + accepted.length >= MAX_QUEUE_SIZE) {
          setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files).`);
          break;
        }
        const validation = validateImageFile(file, ["png", "jpeg", "webp"]);
        if (!validation.valid) {
          rejected.push(validation.error ?? `Unsupported file: "${file.name}".`);
          continue;
        }
        if (validation.warning) setWarning(validation.warning);
        if (runningTotal + file.size > MAX_TOTAL_SIZE) {
          rejected.push(
            `"${file.name}" skipped — would exceed the ${Math.round(
              MAX_TOTAL_SIZE / (1024 * 1024),
            )} MB total queue limit.`,
          );
          continue;
        }

        try {
          const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
          const meta = sniffImageMeta(head);
          if (!meta.format) {
            rejected.push(`Couldn't read "${file.name}".`);
            continue;
          }
          // Hard-reject animated at enqueue — a first-frame-only watermark is wrong output (§6.2 step 4).
          if (meta.animated) {
            rejected.push(ANIMATED_MSG);
            continue;
          }
          let dims: { width: number; height: number };
          try {
            dims = readImageDims(head, meta.format);
          } catch {
            dims = await imgDims(file);
          }
          if (clampToCanvasLimits(dims.width, dims.height).downscaled) {
            rejected.push(
              `"${file.name}" exceeds your browser's canvas limit (max ~16 MP, 8192 px per side).`,
            );
            continue;
          }
          runningTotal += file.size;
          accepted.push({
            id: uid(),
            file,
            fileName: file.name,
            format: meta.format,
            width: dims.width,
            height: dims.height,
            beforeUrl: URL.createObjectURL(file),
          });
        } catch {
          rejected.push(`Couldn't read "${file.name}" — it may be corrupt.`);
        }
      }

      if (rejected.length > 0) {
        setError(
          rejected.length === 1
            ? (rejected[0] ?? "Some files were skipped.")
            : `${rejected.length} files were skipped — ${rejected.join(" ")}`,
        );
      }
      if (accepted.length === 0) return;
      setQueue((prev) => [...prev, ...accepted]);
      const first = accepted[0];
      if (first && !selectedId) setSelectedId(first.id);
    },
    [queue, selectedId],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) addFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFiles],
  );

  const removeItem = useCallback(
    (id: string) => {
      setQueue((prev) => {
        const item = prev.find((i) => i.id === id);
        if (item) URL.revokeObjectURL(item.beforeUrl);
        return prev.filter((i) => i.id !== id);
      });
      if (selectedId === id) {
        setSelectedId((prevSel) => {
          if (prevSel !== id) return prevSel;
          const remaining = queueRef.current.filter((i) => i.id !== id);
          return remaining[0]?.id ?? null;
        });
      }
    },
    [selectedId],
  );

  const selectItem = useCallback((id: string) => setSelectedId(id), []);

  const loadLogoFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const next = await loadLogo(file);
        setLogo((prev) => {
          prev?.bitmap.close();
          return next;
        });
        setPrefs({ kind: "image" });
      } catch (err) {
        const msg =
          err instanceof CapError ? CAP_MSG : (err as Error).message || "Couldn't read this logo.";
        setError(msg);
      }
    },
    [setPrefs],
  );

  const handleLogoInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void loadLogoFile(file);
      if (logoInputRef.current) logoInputRef.current.value = "";
    },
    [loadLogoFile],
  );

  const removeLogo = useCallback(() => {
    setLogo((prev) => {
      prev?.bitmap.close();
      return null;
    });
  }, []);

  // ── Tile-budget pre-flight (§6.8) using stored oriented dims — no full decode ─────
  const exceedsTileBudget = useCallback(
    (item: QueueItem): boolean => {
      if (prefs.layout !== "tile") return false;
      const W = item.width;
      const H = item.height;
      const margin = resolvePx(prefs.marginPct, Math.min(W, H));
      const tileGap = resolvePx(prefs.tileGapPct, W);
      let mark: MarkBox;
      if (config.kind === "image") {
        if (!logo) return false;
        mark = logoMarkBox(logo.width, logo.height, W, H, prefs.scalePct, margin);
      } else {
        const scratch = document.createElement("canvas").getContext("2d");
        if (!scratch || typeof scratch.measureText !== "function") return false;
        const family =
          (FONTS.find((f) => f.id === config.fontId) ?? FONTS[0])?.cssFamily ?? "sans-serif";
        const fontPx = fitFontPx(
          scratch,
          config.text,
          resolvePx(config.fontSizePct, W),
          W - 2 * margin,
          config.fontWeight,
          family,
        );
        scratch.font = cssFontSpec(config.fontWeight, fontPx, family);
        mark = textMarkBox(scratch, config.text, fontPx);
      }
      const centers = computeCenters(mark, W, H, {
        anchor: prefs.anchor,
        layout: "tile",
        margin,
        tileGap,
        rotationDeg: prefs.rotationDeg,
      });
      return centers.length > MAX_DRAWS;
    },
    [prefs, config, logo],
  );

  const hasMark = prefs.kind === "text" ? prefs.text.trim().length > 0 : logo !== null;
  const canApply = queue.length > 0 && hasMark && !isExporting;

  const applyAndDownload = useCallback(async () => {
    if (!canApply) return;
    setError(null);
    setWarning(null);

    // Pre-flight the tile budget on every queued item's stored oriented dims.
    for (const item of queue) {
      if (item.error) continue;
      if (exceedsTileBudget(item)) {
        setError("Too many watermark tiles — increase the tile gap");
        return;
      }
    }

    const total = queue.length;
    setIsExporting(true);
    setProgress({ done: 0, total });

    const successes: Array<{ blob: Blob; filename: string }> = [];
    const opts = {
      format: prefs.format,
      quality: prefs.quality,
      jpegBackground: prefs.jpegBackground,
    };
    let done = 0;
    let skipped = 0;

    for (const item of queue) {
      if (item.error) {
        skipped += 1;
        done += 1;
        setProgress({ done, total });
        continue;
      }
      try {
        let loaded: LoadedImage;
        let reused = false;
        if (item.id === selectedId && preview && previewForIdRef.current === item.id) {
          loaded = preview;
          reused = true;
        } else {
          loaded = await loadOrientedImage(item.file);
        }
        const out = await watermarkToBlob(
          loaded,
          config.kind === "image" ? logo : null,
          config,
          opts,
        );
        if (!reused) loaded.bitmap.close();
        successes.push({
          blob: out.blob,
          filename: buildWatermarkedFilename(item.fileName, out.ext),
        });
      } catch (err) {
        const msg =
          err instanceof CapError
            ? CAP_MSG
            : (err as Error).message || "Couldn't process this image.";
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, error: msg } : q)));
        skipped += 1;
      }
      done += 1;
      setProgress({ done, total });
      if (total > 1) await new Promise((r) => setTimeout(r, 0));
    }

    setIsExporting(false);
    setProgress(null);

    if (successes.length === 0) {
      setError("Couldn't watermark any images — they may be corrupt or unsupported.");
      return;
    }

    if (total === 1) {
      const only = successes[0];
      if (only) {
        downloadBlob(only.blob, only.filename);
        toast.success(`Watermarked → ${only.filename}`);
      }
      return;
    }

    try {
      const zip = await createBatchZip(successes);
      downloadBlob(zip, "watermarked-images.zip");
    } catch {
      setError("Failed to create ZIP file.");
      return;
    }
    if (skipped > 0) {
      const summary = `Watermarked ${successes.length} of ${total} — ${skipped} couldn't be processed.`;
      setWarning(summary);
      toast.success(summary);
    } else {
      toast.success(`Watermarked ${total} images.`);
    }
  }, [canApply, queue, exceedsTileBudget, prefs, selectedId, preview, config, logo]);

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "Enter", meta: true, handler: () => void applyAndDownload(), enabled: canApply },
      ],
      [canApply, applyAndDownload],
    ),
  );

  // Drag handlers.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const applyLabel = queue.length > 1 ? `Download all (${queue.length})` : "Apply & download";

  // ── Render ──────────────────────────────────────────────────────────────────────
  const left = (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        disabled={isExporting}
        aria-label="Add images: drop here, or click to browse"
        className={cn(
          "group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-60 sm:p-10",
          isDragging
            ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
            : "bg-paper shadow-pop-3 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)]",
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper shadow-pop-2 group-hover:rotate-[-4deg]">
            <Upload className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
              Drag and drop images here
            </p>
            <p className="text-sm text-ink-2">JPEG, PNG, WebP — up to {MAX_QUEUE_SIZE} files</p>
          </div>
          <span
            aria-hidden="true"
            className="pointer-events-none mt-1 inline-flex items-center rounded-full border-2 border-ink bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-ink shadow-pop-1 group-hover:bg-lemon"
          >
            Browse Files
          </span>
        </div>
      </button>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

      {/* Preview stage */}
      <section className="wb-panel wb-panel--out flex flex-col">
        <PaneHeader
          label="Preview"
          icon={<Stamp className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
          actions={
            selectedItem && !selectedItem.error ? (
              <StatusBadge
                tone="neutral"
                label={`${selectedItem.width} × ${selectedItem.height}`}
              />
            ) : undefined
          }
        />
        <div className="p-5 sm:p-6">
          {!selectedItem || selectedItem.error ? (
            // No selection, OR the selected item failed to decode — never leave the prior image's
            // pixels on the canvas under a different selection (the stale-preview defect).
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-ink-3">
              <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink-3 bg-paper">
                <Stamp className="size-6" aria-hidden="true" />
              </span>
              <p className="text-sm">
                {selectedItem?.error
                  ? "This image couldn't be loaded. Remove it and try another."
                  : "Upload and select an image to watermark."}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-h-[460px] w-full overflow-hidden rounded-md border-2 border-ink bg-[repeating-conic-gradient(var(--bg-3)_0_25%,var(--bg)_0_50%)] bg-[length:20px_20px]">
              <canvas
                ref={previewRef}
                data-testid="preview-canvas"
                aria-label="Watermark preview"
                className="block h-auto max-h-[460px] w-full object-contain"
              />
            </div>
          )}
        </div>
      </section>

      {/* Queue strip */}
      <section className="wb-panel wb-panel--out">
        <PaneHeader
          label="Queue"
          icon={<FileImage className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
          actions={
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
              {isExporting && progress
                ? `${progress.done} of ${progress.total}`
                : `${queue.length} Files`}
            </span>
          }
        />
        <div className="max-h-[300px] space-y-2 overflow-y-auto p-3 sm:p-4">
          {queue.length === 0 && (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
              No images yet. Upload files to get started.
            </p>
          )}
          {queue.map((item) => {
            const selected = item.id === selectedId;
            return (
              <div
                key={item.id}
                className={cn(
                  "wb-item-enter flex items-center gap-3 rounded-md border-2 border-ink p-2.5 transition-[background,box-shadow,transform] duration-200",
                  item.error
                    ? "bg-paper opacity-60 shadow-pop-1"
                    : selected
                      ? "-translate-x-px -translate-y-px bg-lemon shadow-pop-2"
                      : "bg-paper shadow-pop-1 hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                )}
              >
                <button
                  type="button"
                  aria-current={selected || undefined}
                  onClick={() => selectItem(item.id)}
                  // Locked during export: switching selection mid-batch would close the reused
                  // preview bitmap the export loop is still drawing from (InvalidStateError).
                  disabled={isExporting || Boolean(item.error)}
                  className="-m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm p-1 text-left disabled:cursor-not-allowed"
                >
                  <span className="size-11 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
                    <img
                      className="h-full w-full object-cover"
                      src={item.beforeUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">
                      {item.fileName}
                    </span>
                    <span className="block font-mono text-[11px] text-ink-3 tabular-nums">
                      {formatBytes(item.file.size)}
                      {item.error && (
                        <span className="font-semibold text-tomato"> · {item.error}</span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={isExporting}
                  className="grid size-9 shrink-0 place-items-center rounded-md text-ink-3 hover:text-tomato disabled:opacity-40 pointer-coarse:size-11"
                  aria-label={`Remove ${item.fileName}`}
                >
                  <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  const right = (
    <div className="space-y-6">
      {/* Kind toggle */}
      <section className="wb-panel">
        <PaneHeader label="Watermark" icon={<Stamp className="size-4" aria-hidden="true" />} />
        <div className="flex flex-col gap-6 p-5 sm:p-6">
          <fieldset
            className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0"
            aria-label="Watermark type"
            data-testid="kind-selector"
          >
            {(
              [
                { id: "text", label: "Text", icon: Type },
                { id: "image", label: "Logo", icon: ImageUp },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const active = prefs.kind === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPrefs({ kind: m.id })}
                  aria-pressed={active}
                  data-testid={`kind-${m.id}`}
                  className={cn(
                    "wb-lift-hover flex min-h-11 items-center justify-center gap-1.5 rounded-md border-2 border-ink px-2 py-3 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 sm:min-h-10",
                    active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </fieldset>

          {/* Text controls */}
          {prefs.kind === "text" && (
            <div className="wb-fade-in space-y-5">
              <div className="space-y-2">
                <Label htmlFor="wm-text" className="text-ink-2">
                  Watermark text
                </Label>
                <Input
                  id="wm-text"
                  value={prefs.text}
                  onChange={(e) => setPrefs({ text: e.target.value })}
                  placeholder="© Your Name"
                  className="h-11 border-2 border-ink bg-paper text-[14px] sm:h-10"
                  data-testid="text-input"
                />
                {prefs.text.trim() === "" && (
                  <p className="text-[12px] text-ink-3">Enter some text to stamp onto the image.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wm-font" className="text-ink-2">
                    Font
                  </Label>
                  <select
                    id="wm-font"
                    value={prefs.fontId}
                    onChange={(e) => setPrefs({ fontId: e.target.value })}
                    className="h-11 w-full rounded-md border-2 border-ink bg-paper px-3 text-[14px] text-ink shadow-pop-1 sm:h-10"
                    data-testid="font-select"
                  >
                    {FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wm-weight" className="text-ink-2">
                    Weight
                  </Label>
                  <select
                    id="wm-weight"
                    value={prefs.fontWeight}
                    onChange={(e) => setPrefs({ fontWeight: e.target.value as "normal" | "bold" })}
                    className="h-11 w-full rounded-md border-2 border-ink bg-paper px-3 text-[14px] text-ink shadow-pop-1 sm:h-10"
                    data-testid="weight-select"
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex justify-between text-ink-2">
                  <span>Size — % of image width</span>
                  <span className="font-mono tabular-nums">{prefs.fontSizePct}%</span>
                </Label>
                <Slider
                  aria-label="Size — % of image width"
                  min={1}
                  max={40}
                  step={1}
                  value={[prefs.fontSizePct]}
                  onValueChange={([v]) => setPrefs({ fontSizePct: v ?? 6 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="wm-color" className="text-ink-2">
                  Color
                </Label>
                <div className="flex items-center gap-3">
                  <input
                    id="wm-color"
                    type="color"
                    value={prefs.color}
                    onChange={(e) => setPrefs({ color: e.target.value })}
                    className="h-11 w-16 cursor-pointer rounded-md border-2 border-ink bg-paper shadow-pop-1 sm:h-10"
                    data-testid="color-input"
                  />
                  <span className="font-mono text-[13px] text-ink-2 tabular-nums">
                    {prefs.color}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="wm-outline" className="text-ink-2">
                    Outline
                  </Label>
                  <Switch
                    id="wm-outline"
                    checked={prefs.outline}
                    onCheckedChange={(v) => setPrefs({ outline: v })}
                    data-testid="outline-toggle"
                  />
                </div>
                {prefs.outline && (
                  <div className="wb-fade-in space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        id="wm-outline-color"
                        type="color"
                        value={prefs.outlineColor}
                        onChange={(e) => setPrefs({ outlineColor: e.target.value })}
                        className="h-11 w-16 cursor-pointer rounded-md border-2 border-ink bg-paper shadow-pop-1 sm:h-10"
                        data-testid="outline-color-input"
                        aria-label="Outline color"
                      />
                      <span className="font-mono text-[13px] text-ink-2 tabular-nums">
                        {prefs.outlineColor}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex justify-between text-ink-2">
                        <span>Outline — % of text size</span>
                        <span className="font-mono tabular-nums">{prefs.outlineWidthPct}%</span>
                      </Label>
                      <Slider
                        aria-label="Outline — % of text size"
                        min={1}
                        max={25}
                        step={1}
                        value={[prefs.outlineWidthPct]}
                        onValueChange={([v]) => setPrefs({ outlineWidthPct: v ?? 6 })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Logo controls */}
          {prefs.kind === "image" && (
            <div className="wb-fade-in space-y-4">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                // Locked during export: swapping the logo mid-batch would close the logo bitmap the
                // export loop is still drawing from (silent unwatermarked output in WKWebView).
                disabled={isExporting}
                aria-label="Add a logo: click to browse"
                className="wb-lift-hover block w-full rounded-[14px] border-2 border-ink bg-paper p-5 text-center shadow-pop-2 transition-[background,box-shadow,transform] duration-200 hover:bg-lemon disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-paper"
              >
                {logo ? (
                  <div className="flex items-center gap-3 text-left">
                    <span className="grid size-14 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper-2 font-mono text-[10px] text-ink-3">
                      LOGO
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-[13px] font-semibold text-ink"
                        title={logo.fileName}
                      >
                        {logo.fileName}
                      </p>
                      <p className="font-mono text-[11px] text-ink-3">
                        {logo.width} × {logo.height}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <ImageUp className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
                    <p className="text-[13px] font-semibold text-ink">Upload a PNG/JPG/WebP logo</p>
                    <p className="text-[11.5px] text-ink-3">A transparent PNG works best.</p>
                  </div>
                )}
              </button>
              <input
                ref={logoInputRef}
                className="hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoInput}
                data-testid="logo-input"
              />
              {logo && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={isExporting}
                    className="wb-btn wb-btn--sm wb-btn--ghost flex-1 justify-center"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={removeLogo}
                    disabled={isExporting}
                    className="wb-btn wb-btn--sm wb-btn--ghost flex-1 justify-center"
                    data-testid="logo-remove"
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="space-y-2">
                <Label className="flex justify-between text-ink-2">
                  <span>Scale — % of image width</span>
                  <span className="font-mono tabular-nums">{prefs.scalePct}%</span>
                </Label>
                <Slider
                  aria-label="Scale — % of image width"
                  min={5}
                  max={100}
                  step={1}
                  value={[prefs.scalePct]}
                  onValueChange={([v]) => setPrefs({ scalePct: v ?? 25 })}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Placement controls */}
      <section className="wb-panel">
        <PaneHeader
          label="Placement"
          icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
        />
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          {/* Layout */}
          <div className="space-y-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
              Layout
            </span>
            <fieldset
              className="m-0 grid grid-cols-2 gap-2 border-0 p-0"
              aria-label="Layout"
              data-testid="layout-selector"
            >
              {(["single", "tile"] as const).map((l) => {
                const active = prefs.layout === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setPrefs({ layout: l })}
                    aria-pressed={active}
                    data-testid={`layout-${l}`}
                    className={cn(
                      "wb-lift-hover min-h-11 rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold capitalize shadow-pop-1 transition-[background,transform] duration-200 sm:min-h-10",
                      active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    {l}
                  </button>
                );
              })}
            </fieldset>
          </div>

          {/* 9-anchor grid (disabled when tiling) */}
          <div className="space-y-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
              Position
            </span>
            <fieldset
              className={cn(
                "m-0 grid grid-cols-3 gap-1.5 border-0 p-0 transition-opacity",
                prefs.layout === "tile" && "pointer-events-none opacity-40",
              )}
              aria-label="Position"
              disabled={prefs.layout === "tile"}
              data-testid="anchor-grid"
            >
              {ANCHORS.map((a) => {
                const active = prefs.anchor === a;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setPrefs({ anchor: a })}
                    aria-pressed={active}
                    aria-label={ANCHOR_LABELS[a]}
                    disabled={prefs.layout === "tile"}
                    data-testid={`anchor-${a}`}
                    className={cn(
                      "aspect-square rounded-md border-2 border-ink transition-[background] duration-150 disabled:pointer-events-none",
                      active ? "bg-lemon shadow-pop-1" : "bg-paper hover:bg-paper-2",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mx-auto block size-2 rounded-full",
                        active ? "bg-ink" : "bg-ink-3",
                      )}
                    />
                  </button>
                );
              })}
            </fieldset>
          </div>

          {/* Margin */}
          <div className="space-y-2">
            <Label className="flex justify-between text-ink-2">
              <span>Margin</span>
              <span className="font-mono tabular-nums">{prefs.marginPct}%</span>
            </Label>
            <Slider
              aria-label="Margin"
              min={0}
              max={25}
              step={1}
              value={[prefs.marginPct]}
              onValueChange={([v]) => setPrefs({ marginPct: v ?? 3 })}
            />
          </div>

          {/* Tile gap (tile only) */}
          {prefs.layout === "tile" && (
            <div className="wb-fade-in space-y-2">
              <Label className="flex justify-between text-ink-2">
                <span>Tile gap</span>
                <span className="font-mono tabular-nums">{prefs.tileGapPct}%</span>
              </Label>
              <Slider
                aria-label="Tile gap"
                min={0}
                max={50}
                step={1}
                value={[prefs.tileGapPct]}
                onValueChange={([v]) => setPrefs({ tileGapPct: v ?? 8 })}
              />
            </div>
          )}

          {/* Rotation */}
          <div className="space-y-2">
            <Label className="flex justify-between text-ink-2">
              <span>Rotation</span>
              <span className="font-mono tabular-nums">{prefs.rotationDeg}°</span>
            </Label>
            <Slider
              aria-label="Rotation"
              min={-180}
              max={180}
              step={1}
              value={[prefs.rotationDeg]}
              onValueChange={([v]) => setPrefs({ rotationDeg: v ?? 0 })}
            />
            <div className="flex flex-wrap gap-1.5">
              {ROTATION_SNAPS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => setPrefs({ rotationDeg: deg })}
                  data-testid={`rotate-snap-${deg}`}
                  className={cn(
                    "rounded-md border-2 border-ink px-2.5 py-1 text-[12px] font-semibold transition-colors",
                    prefs.rotationDeg === deg
                      ? "bg-ink text-paper"
                      : "bg-paper text-ink-2 hover:bg-lemon",
                  )}
                >
                  {deg}°
                </button>
              ))}
            </div>
          </div>

          {/* Opacity */}
          <div className="space-y-2">
            <Label className="flex justify-between text-ink-2">
              <span>Opacity</span>
              <span className="font-mono tabular-nums">{Math.round(prefs.opacity * 100)}%</span>
            </Label>
            <Slider
              aria-label="Opacity"
              min={0}
              max={100}
              step={1}
              value={[Math.round(prefs.opacity * 100)]}
              onValueChange={([v]) => setPrefs({ opacity: (v ?? 50) / 100 })}
            />
          </div>

          {/* Blend */}
          <div className="space-y-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Blend</span>
            <fieldset
              className="m-0 grid grid-cols-2 gap-2 border-0 p-0"
              aria-label="Blend mode"
              data-testid="blend-selector"
            >
              {(
                [
                  { id: "normal", label: "Normal" },
                  { id: "multiply", label: "Multiply" },
                ] as const
              ).map((b) => {
                const active = prefs.blend === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setPrefs({ blend: b.id })}
                    aria-pressed={active}
                    data-testid={`blend-${b.id}`}
                    className={cn(
                      "wb-lift-hover min-h-11 rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 sm:min-h-10",
                      active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    {b.label}
                  </button>
                );
              })}
            </fieldset>
            {prefs.blend === "multiply" && (
              <p className="text-[12px] text-ink-3">
                Multiply blends into the photo but may disappear on dark images.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Format & quality */}
      <section className="wb-panel">
        <PaneHeader
          label="Output format"
          icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
        />
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="grid grid-cols-4 gap-2">
            {FORMAT_OPTIONS.filter((opt) => opt.value !== "webp" || webpSupported).map((opt) => {
              const active = prefs.format === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrefs({ format: opt.value })}
                  aria-pressed={active}
                  data-testid={`format-${opt.value}`}
                  className={cn(
                    "inline-flex items-center justify-center rounded-md border-2 border-ink py-2 text-[13px] font-bold transition-[background,transform] duration-150 pointer-coarse:min-h-11",
                    active
                      ? "-translate-y-px bg-ink text-paper shadow-pop-1"
                      : "bg-paper text-ink hover:bg-lemon",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {prefs.format === "keep" && (
            <p className="text-[12.5px] text-ink-2">Export in each image's own format.</p>
          )}

          {showJpegBg && (
            <div className="space-y-2">
              <Label htmlFor="wm-jpeg-bg" className="text-ink-2">
                Background color
              </Label>
              <div className="flex items-center gap-3">
                <input
                  id="wm-jpeg-bg"
                  type="color"
                  value={prefs.jpegBackground}
                  onChange={(e) => setPrefs({ jpegBackground: e.target.value })}
                  className="h-11 w-16 cursor-pointer rounded-md border-2 border-ink bg-paper shadow-pop-1 sm:h-10"
                  data-testid="jpeg-bg-input"
                />
                <span className="font-mono text-[13px] text-ink-2 tabular-nums">
                  {prefs.jpegBackground}
                </span>
              </div>
              <p className="text-[12px] text-tomato">
                JPEG has no transparency — transparent areas are filled with this color.
              </p>
            </div>
          )}

          {showQuality && (
            <div className="space-y-2">
              <Label className="flex justify-between text-ink-2">
                <span>Quality</span>
                <span className="font-mono tabular-nums">{prefs.quality}</span>
              </Label>
              <Slider
                aria-label="Quality"
                min={1}
                max={100}
                step={1}
                value={[prefs.quality]}
                onValueChange={([v]) => setPrefs({ quality: v ?? 92 })}
              />
            </div>
          )}
        </div>
      </section>

      {/* Apply + reset */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={applyAndDownload}
            disabled={!canApply}
            className="wb-btn flex-1 justify-center py-4 text-[15px]"
            data-testid="apply-button"
          >
            <IconSwap swapKey={isExporting}>
              {isExporting && progress ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>{`${progress.done} / ${progress.total}`}</span>
                </>
              ) : (
                <>
                  <Download className="size-4" aria-hidden="true" />
                  <span>{applyLabel}</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          <button
            type="button"
            onClick={() => resetPrefs()}
            disabled={isExporting}
            className="wb-btn wb-btn--ghost justify-center px-5"
            data-testid="reset-button"
            aria-label="Reset watermark settings"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
        </div>
        {isExporting && progress && progress.total > 1 && (
          // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role for live values, not an operable widget — it is not meant to receive focus
          <div
            className="wb-fade-in h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-paper-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={`Watermarking images, ${progress.done} of ${progress.total} done`}
          >
            <div
              className="h-full origin-left bg-tomato transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress.done / progress.total})` }}
            />
          </div>
        )}
        {queue.length === 0 && !isExporting && (
          <p className="text-center text-[12.5px] text-ink-3">Upload an image to watermark it.</p>
        )}
      </div>
    </div>
  );

  return (
    <ToolShell variant="wide">
      <TwoPane gap="8" left={left} right={right} />
    </ToolShell>
  );
}
