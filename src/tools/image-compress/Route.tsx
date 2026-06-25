import {
  Download,
  FileImage,
  Gauge,
  ImageIcon,
  Loader2,
  Minimize2,
  Palette,
  SlidersHorizontal,
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
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import {
  MAX_QUEUE_SIZE,
  MAX_TOTAL_SIZE,
  buildCompressedFilename,
  compressViaWorker,
  createBatchZip,
  downloadBlob,
  formatBytes,
  formatRatio,
  readFileBytes,
  readImageDims,
  sniffImageMeta,
  terminateCompressWorker,
  validateImageFile,
} from "./compressor";
import {
  type CompressPrefs,
  type CompressResult,
  DEFAULT_PREFS,
  type NormFormat,
  type OutputFormat,
  type PngMode,
  resolveOptions,
} from "./compressor-types";

const MAX_AREA = 16_777_216; // ~16.7 MP — reject above this (geometry never downscales).

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string; note?: string }> = [
  { value: "keep", label: "Keep" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
  {
    value: "avif",
    label: "AVIF",
    note: "Best compression, slower, ~2 MB one-time codec download.",
  },
  { value: "png", label: "PNG" },
];

interface QueueItem {
  id: string;
  file: File;
  format: NormFormat;
  width: number;
  height: number;
  animated: boolean;
  status: "ready" | "compressing" | "done" | "error";
  result?: CompressResult;
  error?: string;
  beforeUrl: string; // object URL from the File (thumbnail + diff "before")
}

let nextId = 0;
function uid(): string {
  return `cmp-${Date.now()}-${nextId++}`;
}

/** Lightweight oriented-dims fallback via <img> when the header parser can't. */
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

/** Effective concrete format given prefs + the selected item's own format. */
function effectiveFormat(format: OutputFormat, itemFormat: NormFormat): NormFormat {
  return format === "keep" ? itemFormat : format;
}

export default function ImageCompressRoute() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences<CompressPrefs>("image-compress", DEFAULT_PREFS);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Live-preview state for the selected item.
  const [preview, setPreview] = useState<CompressResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [reveal, setReveal] = useState(50);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqIdRef = useRef(0);
  const batchCancelledRef = useRef(false);
  // Cache the selected item's bytes across debounced previews (plan §7.2).
  const bytesCacheRef = useRef<{ id: string; bytes: Uint8Array } | null>(null);
  // Mirror latest preview URL + queue into refs so the unmount cleanup (empty
  // deps) can revoke every live object URL without capturing stale state.
  const previewUrlRef = useRef<string | null>(null);
  const itemsRef = useRef<QueueItem[]>([]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const effFormat = selectedItem ? effectiveFormat(prefs.format, selectedItem.format) : "jpeg";
  const isPng = effFormat === "png";

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Cleanup on unmount: revoke every live object URL + tear down the worker.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      for (const item of itemsRef.current) URL.revokeObjectURL(item.beforeUrl);
      terminateCompressWorker();
    };
  }, []);

  // Read (and cache) the selected item's bytes on demand.
  const getSelectedBytes = useCallback(async (item: QueueItem): Promise<Uint8Array> => {
    const cached = bytesCacheRef.current;
    if (cached && cached.id === item.id) return cached.bytes;
    const bytes = await readFileBytes(item.file);
    bytesCacheRef.current = { id: item.id, bytes };
    return bytes;
  }, []);

  // Live preview: debounced real re-encode of the selected item (plan §6.5).
  useEffect(() => {
    if (!selectedItem || isBusy) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Codec-aware debounce: AVIF/OxiPNG are heavy (plan §6.5).
    const heavy = effFormat === "avif" || (isPng && prefs.pngMode === "oxipng");
    const delay = heavy ? 600 : 250;

    debounceRef.current = setTimeout(async () => {
      const item = selectedItem;
      const fmt = effectiveFormat(prefs.format, item.format);
      const options = { ...resolveOptions(prefs, fmt), format: prefs.format };
      const requestId = ++reqIdRef.current;
      setIsPreviewing(true);
      try {
        const bytes = await getSelectedBytes(item);
        const result = await compressViaWorker({
          input: bytes,
          inputFormat: item.format,
          options,
          requestId,
        });
        if (requestId !== reqIdRef.current) return; // stale — discard
        setPreview(result);
        const url = URL.createObjectURL(
          new Blob([result.bytes as BlobPart], { type: result.mime }),
        );
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (requestId === reqIdRef.current) setPreview(null);
      } finally {
        if (requestId === reqIdRef.current) setIsPreviewing(false);
      }
    }, delay);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedItem, prefs, effFormat, isPng, isBusy, getSelectedBytes]);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const incoming = Array.from(fileList);

      const accepted: QueueItem[] = [];
      let runningTotal = items.reduce((s, i) => s + i.file.size, 0);

      for (const file of incoming) {
        if (items.length + accepted.length >= MAX_QUEUE_SIZE) {
          setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files).`);
          break;
        }
        const validation = validateImageFile(file, ["png", "jpeg", "webp", "avif"]);
        if (!validation.valid) {
          setError(validation.error ?? "Unsupported file.");
          continue;
        }
        if (validation.warning) setWarning(validation.warning);
        if (runningTotal + file.size > MAX_TOTAL_SIZE) {
          setWarning("Total queue size would exceed the limit. Some files were skipped.");
          break;
        }

        try {
          const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
          const meta = sniffImageMeta(head);
          if (!meta.format) {
            setError(`Couldn't read "${file.name}".`);
            continue;
          }
          let dims: { width: number; height: number };
          try {
            dims = readImageDims(head, meta.format);
          } catch {
            dims = await imgDims(file);
          }
          if (dims.width * dims.height > MAX_AREA) {
            setError(`"${file.name}" is too large to compress in your browser (over ~16 MP).`);
            continue;
          }
          runningTotal += file.size;
          accepted.push({
            id: uid(),
            file,
            format: meta.format,
            width: dims.width,
            height: dims.height,
            animated: Boolean(meta.animated),
            status: "ready",
            beforeUrl: URL.createObjectURL(file),
          });
        } catch {
          setError(`Couldn't read "${file.name}" — it may be corrupt.`);
        }
      }

      if (accepted.length === 0) return;
      const animatedHit = accepted.find((i) => i.animated);
      if (animatedHit) {
        setWarning("Animated images: only the first frame is compressed.");
      }
      setItems((prev) => [...prev, ...accepted]);
      const first = accepted[0];
      if (first && !selectedId) setSelectedId(first.id);
    },
    [items, selectedId],
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
      setItems((prev) => {
        const item = prev.find((i) => i.id === id);
        if (item) URL.revokeObjectURL(item.beforeUrl);
        return prev.filter((i) => i.id !== id);
      });
      if (bytesCacheRef.current?.id === id) bytesCacheRef.current = null;
      if (selectedId === id) {
        setSelectedId(null);
        setPreview(null);
      }
    },
    [selectedId],
  );

  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
    setPreview(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setReveal(50);
  }, []);

  const compressAll = useCallback(async () => {
    const ready = items.filter((i) => i.status !== "compressing");
    if (ready.length === 0) return;
    setIsBusy(true);
    setError(null);
    batchCancelledRef.current = false;
    setProgress({ done: 0, total: ready.length });

    let done = 0;
    let savedBytes = 0;
    for (const item of ready) {
      if (batchCancelledRef.current) break;
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "compressing" as const } : i)),
      );
      const fmt = effectiveFormat(prefs.format, item.format);
      const options = { ...resolveOptions(prefs, fmt), format: prefs.format };
      const requestId = ++reqIdRef.current;
      try {
        const bytes = await readFileBytes(item.file);
        const result = await compressViaWorker({
          input: bytes,
          inputFormat: item.format,
          options,
          requestId,
        });
        if (batchCancelledRef.current) break;
        savedBytes += Math.max(0, result.inputSize - result.outputSize);
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "done" as const, result } : i)),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "error" as const,
                  error: e instanceof Error ? e.message : "Compression failed.",
                }
              : i,
          ),
        );
      }
      done += 1;
      setProgress({ done, total: ready.length });
    }

    // Items left untouched after a cancel return to "ready".
    setItems((prev) =>
      prev.map((i) => (i.status === "compressing" ? { ...i, status: "ready" as const } : i)),
    );
    setIsBusy(false);
    if (!batchCancelledRef.current && done > 0) {
      toast.success(
        `Compressed ${done} image${done === 1 ? "" : "s"} — saved ${formatBytes(savedBytes)}`,
      );
    }
  }, [items, prefs]);

  const cancelBatch = useCallback(() => {
    batchCancelledRef.current = true;
    reqIdRef.current += 1; // discard any in-flight result
  }, []);

  const downloadItem = useCallback((item: QueueItem) => {
    if (!item.result) return;
    const { result } = item;
    const blob = new Blob([result.bytes as BlobPart], { type: result.mime });
    const filename = result.keptOriginal
      ? item.file.name
      : buildCompressedFilename(item.file.name, result.ext);
    downloadBlob(blob, filename);
  }, []);

  const downloadAll = useCallback(async () => {
    const doneItems = items.filter((i) => i.status === "done" && i.result);
    if (doneItems.length === 0) return;
    const zipItems = doneItems.map((i) => {
      const result = i.result as CompressResult;
      return {
        blob: new Blob([result.bytes as BlobPart], { type: result.mime }),
        filename: result.keptOriginal
          ? i.file.name
          : buildCompressedFilename(i.file.name, result.ext),
      };
    });
    try {
      const zip = await createBatchZip(zipItems);
      downloadBlob(zip, "compressed-images.zip");
    } catch {
      setError("Failed to create ZIP file.");
    }
  }, [items]);

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasQueue = items.length > 0;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => compressAll(),
          enabled: hasQueue && !isBusy,
        },
      ],
      [hasQueue, isBusy, compressAll],
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

  const ratioInfo = preview ? formatRatio(preview.ratio) : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ToolShell variant="wide">
      <TwoPane
        gap="8"
        left={
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              disabled={isBusy}
              aria-label="Add images: drop here, or click to browse"
              className={cn(
                "group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
                isBusy && "cursor-not-allowed opacity-60",
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
                  <p className="text-sm text-ink-2">
                    JPEG, PNG, WebP, AVIF — up to {MAX_QUEUE_SIZE} files
                  </p>
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
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              onChange={handleFileInput}
              data-testid="file-input"
            />

            <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
            <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

            <section className="wb-panel wb-panel--out">
              <PaneHeader
                label="Queue"
                icon={<FileImage className="size-4" aria-hidden="true" />}
                className="bg-paper-2"
                actions={
                  <>
                    <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
                      {isBusy ? `${progress.done} of ${progress.total}` : `${items.length} Files`}
                    </span>
                    {doneCount > 1 && (
                      <button
                        type="button"
                        onClick={downloadAll}
                        className="wb-btn wb-btn--sm wb-btn--ghost"
                        aria-label="Download all compressed images as ZIP"
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        <span>Download ZIP</span>
                      </button>
                    )}
                  </>
                }
              />
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3 sm:p-4">
                {items.length === 0 && (
                  <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
                    No images yet. Upload files to get started.
                  </p>
                )}
                {items.map((item) => {
                  const selected = item.id === selectedId;
                  const r = item.result;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border-2 border-ink p-2.5 transition-[background,box-shadow,transform] duration-200",
                        selected
                          ? "-translate-x-px -translate-y-px bg-lemon shadow-pop-2"
                          : "bg-paper shadow-pop-1 hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                      )}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: queue items are keyboard-selectable
                      tabIndex={0}
                      aria-current={selected || undefined}
                      onClick={() => selectItem(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectItem(item.id);
                        }
                      }}
                    >
                      <div className="size-11 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
                        <img
                          className="h-full w-full object-cover"
                          src={item.beforeUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-ink">
                          {item.file.name}
                        </p>
                        <p className="font-mono text-[11px] text-ink-3 tabular-nums">
                          {formatBytes(item.file.size)}
                          {item.status === "done" && r && (
                            <span className="inline-flex items-center gap-1">
                              <span aria-hidden="true"> → </span>
                              <span
                                className={cn(
                                  "font-semibold",
                                  r.keptOriginal
                                    ? "text-ink-2"
                                    : r.ratio < 0
                                      ? "text-tomato"
                                      : "text-grass",
                                )}
                              >
                                {r.keptOriginal ? "already optimized" : formatBytes(r.outputSize)}
                              </span>
                            </span>
                          )}
                          {item.status === "compressing" && " · compressing…"}
                          {item.status === "error" && (
                            <span className="font-semibold text-tomato"> · {item.error}</span>
                          )}
                        </p>
                      </div>
                      {item.status === "done" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadItem(item);
                          }}
                          className="grid size-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 hover:bg-mint"
                          aria-label={`Download ${item.file.name}`}
                        >
                          <Download className="size-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(item.id);
                        }}
                        disabled={isBusy}
                        className="grid size-9 shrink-0 place-items-center rounded-md text-ink-3 hover:text-tomato disabled:opacity-40"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        }
        right={
          <div className="space-y-6">
            {/* Format selector */}
            <section className="wb-panel">
              <PaneHeader
                label="Output format"
                icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
              />
              <div className="space-y-5 p-5 sm:p-6">
                <div className="grid grid-cols-5 gap-2">
                  {FORMAT_OPTIONS.map((opt) => {
                    const active = prefs.format === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={isBusy}
                        onClick={() => setPrefs({ format: opt.value })}
                        aria-pressed={active}
                        className={cn(
                          "rounded-md border-2 border-ink py-2 text-[13px] font-bold transition-[background,transform] duration-150 disabled:opacity-50",
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
                {prefs.format === "avif" && (
                  <p className="text-[12.5px] text-ink-2">
                    Best compression, slower to encode, ~2 MB one-time codec download.
                  </p>
                )}

                {/* Mode controls (per effective format) */}
                <div className="space-y-5">
                  {(effFormat === "jpeg" || effFormat === "webp" || effFormat === "avif") && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-ink-2">Quality</Label>
                        <span className="font-mono text-[12px] font-bold tabular-nums text-tomato">
                          {prefs.qualityByFormat[effFormat]}
                        </span>
                      </div>
                      <Slider
                        min={1}
                        max={100}
                        step={1}
                        disabled={isBusy || (effFormat === "webp" && prefs.lossless)}
                        value={[prefs.qualityByFormat[effFormat]]}
                        onValueChange={([v]) =>
                          setPrefs({
                            qualityByFormat: {
                              ...prefs.qualityByFormat,
                              [effFormat]: v ?? 75,
                            },
                          })
                        }
                      />
                    </div>
                  )}

                  {effFormat === "webp" && (
                    <div className="flex items-center justify-between">
                      <Label htmlFor="webp-lossless" className="text-ink-2">
                        Lossless
                      </Label>
                      <Switch
                        id="webp-lossless"
                        disabled={isBusy}
                        checked={prefs.lossless}
                        onCheckedChange={(v) => setPrefs({ lossless: v })}
                      />
                    </div>
                  )}

                  {isPng && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        {(["oxipng", "palette"] as PngMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={isBusy}
                            onClick={() => setPrefs({ pngMode: m })}
                            aria-pressed={prefs.pngMode === m}
                            className={cn(
                              "inline-flex items-center justify-center gap-1.5 rounded-md border-2 border-ink py-2 text-[13px] font-bold disabled:opacity-50",
                              prefs.pngMode === m
                                ? "bg-ink text-paper"
                                : "bg-paper text-ink hover:bg-lemon",
                            )}
                          >
                            {m === "palette" ? (
                              <Palette className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Gauge className="size-3.5" aria-hidden="true" />
                            )}
                            {m === "oxipng" ? "Lossless" : "Palette"}
                          </button>
                        ))}
                      </div>
                      {prefs.pngMode === "palette" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-ink-2">Colors</Label>
                            <span className="font-mono text-[12px] font-bold tabular-nums text-tomato">
                              {prefs.paletteColors}
                            </span>
                          </div>
                          <Slider
                            min={2}
                            max={256}
                            step={1}
                            disabled={isBusy}
                            value={[prefs.paletteColors]}
                            onValueChange={([v]) => setPrefs({ paletteColors: v ?? 256 })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Visual diff + size readout */}
            <section className="wb-panel wb-panel--out flex flex-col">
              <PaneHeader
                label="Before / after"
                icon={<ImageIcon className="size-4" aria-hidden="true" />}
                className="bg-paper-2"
                actions={
                  ratioInfo && !preview?.keptOriginal ? (
                    <StatusBadge
                      tone={ratioInfo.larger ? "invalid" : "valid"}
                      label={ratioInfo.label}
                    />
                  ) : preview?.keptOriginal ? (
                    <StatusBadge tone="neutral" label="already optimized" />
                  ) : undefined
                }
              />
              <div className="p-5 sm:p-6">
                {!selectedItem ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-ink-3">
                    <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink-3 bg-paper">
                      <Minimize2 className="size-6" aria-hidden="true" />
                    </span>
                    <p className="text-sm">Upload and select an image to compress.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Reveal slider over display-scaled images (NOT full-res — plan §6.6) */}
                    <div className="relative mx-auto max-h-[420px] w-full overflow-hidden rounded-md border-2 border-ink bg-[repeating-conic-gradient(#e9e9e9_0_25%,#fff_0_50%)] bg-[length:20px_20px]">
                      <img
                        src={selectedItem.beforeUrl}
                        alt="Original"
                        className="block max-h-[420px] w-full object-contain"
                        decoding="async"
                      />
                      {previewUrl && (
                        <img
                          src={previewUrl}
                          alt="Compressed"
                          className="absolute inset-0 block max-h-[420px] w-full object-contain"
                          style={{ clipPath: `inset(0 0 0 ${reveal}%)` }}
                          decoding="async"
                        />
                      )}
                      {isPreviewing && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-paper px-2 py-0.5 text-[11px] font-bold shadow-pop-1">
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> encoding
                        </span>
                      )}
                    </div>
                    <Slider
                      aria-label="Reveal compressed image"
                      min={0}
                      max={100}
                      step={1}
                      value={[reveal]}
                      onValueChange={([v]) => setReveal(v ?? 50)}
                    />
                    <p className="text-center font-mono text-[11px] uppercase tracking-wider text-ink-3">
                      Preview encodes at full resolution
                    </p>

                    {/* Size readout */}
                    <div className="grid grid-cols-2 gap-3 border-t-2 border-ink pt-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          Original
                        </span>
                        <span className="font-mono text-[14px] font-bold text-ink tabular-nums">
                          {formatBytes(selectedItem.file.size)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          {preview?.keptOriginal ? "Kept original" : "Compressed"}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[14px] font-bold tabular-nums",
                            !preview
                              ? "text-ink-3"
                              : preview.keptOriginal
                                ? "text-ink-2"
                                : preview.ratio < 0
                                  ? "text-tomato"
                                  : "text-grass",
                          )}
                        >
                          {preview ? formatBytes(preview.outputSize) : "—"}
                        </span>
                      </div>
                    </div>
                    {preview && preview.ratio < 0 && !preview.keptOriginal && (
                      <p className="text-[12.5px] text-tomato">
                        This came out larger than the original — try a lower quality or a different
                        format.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Compress action */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={compressAll}
                disabled={!hasQueue || isBusy}
                className="wb-btn flex-1 justify-center py-4 text-[15px]"
              >
                <IconSwap swapKey={isBusy}>
                  {isBusy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      <span>
                        Compressing… {progress.done}/{progress.total}
                      </span>
                    </>
                  ) : (
                    <>
                      <Minimize2 className="size-4" aria-hidden="true" />
                      <span>Compress all</span>
                      <KbdHint>⌘⏎</KbdHint>
                    </>
                  )}
                </IconSwap>
              </button>
              {isBusy && (
                <button
                  type="button"
                  onClick={cancelBatch}
                  className="wb-btn wb-btn--ghost justify-center px-5"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        }
      />
    </ToolShell>
  );
}
