import {
  Download,
  Eye,
  ImageIcon,
  LayoutGrid,
  Link2,
  Link2Off,
  ListOrdered,
  Loader2,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, WarningAlert } from "../../components/tool-layout";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import { MAX_QUEUE_SIZE } from "../constants";
import {
  clampDimension,
  createBatchZip,
  downloadBlob,
  estimateSize,
  generateFilename,
  getImageDimensions,
  isFormatSupported,
  resizeImage,
  validateFile,
} from "./resizer";
import type { OutputFormat, QueueItem, ResizeMode } from "./resizer";

const DEFAULT_PREFS = {
  format: "jpeg" as OutputFormat,
  quality: 85,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let nextId = 0;
function uid(): string {
  return `img-${Date.now()}-${nextId++}`;
}

export default function ImageResizerRoute() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<ResizeMode>("single");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [prefs, setPrefs] = useToolPreferences("image-resizer", DEFAULT_PREFS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [avifSupported, setAvifSupported] = useState(true);
  const [recentAssets, setRecentAssets] = useState<
    Array<{ blob: Blob; url: string; filename: string }>
  >([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setAvifSupported(isFormatSupported("avif"));
  }, []);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    const selected = queue.find((q) => q.id === selectedItemId);
    if (!selected) {
      setPreviewUrl(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const blob = await resizeImage(selected.file, {
          width,
          height,
          format: prefs.format,
          quality: prefs.quality,
        });
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        // Preview failed silently
      }
    }, 250);
  }, [selectedItemId, width, height, prefs.format, prefs.quality, queue]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const fileArray = Array.from(files);
      const toProcess = mode === "single" ? fileArray.slice(0, 1) : fileArray;

      const newItems: QueueItem[] = [];
      for (const file of toProcess) {
        const validation = validateFile(file);
        if (!validation.valid) {
          setError(validation.error ?? "Unknown error");
          continue;
        }
        if (validation.warning) {
          setWarning(validation.warning);
        }

        try {
          const dims = await getImageDimensions(file);
          const thumbUrl = URL.createObjectURL(file);
          const item: QueueItem = {
            id: uid(),
            file,
            originalWidth: dims.width,
            originalHeight: dims.height,
            aspectRatio: dims.width / dims.height,
            thumbnailUrl: thumbUrl,
            status: "pending",
            progress: 0,
          };
          newItems.push(item);
        } catch {
          setError(`Failed to load "${file.name}".`);
        }
      }

      if (newItems.length === 0) return;

      if (mode === "single") {
        setQueue((prev) => {
          for (const q of prev) URL.revokeObjectURL(q.thumbnailUrl);
          return newItems;
        });
        const first = newItems[0];
        if (first) {
          setWidth(first.originalWidth);
          setHeight(first.originalHeight);
          setAspectRatio(first.aspectRatio);
          setSelectedItemId(first.id);
        }
      } else {
        setQueue((prev) => {
          const available = MAX_QUEUE_SIZE - prev.length;
          if (available <= 0) {
            setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files). Remove some files first.`);
            return prev;
          }
          const toAdd = newItems.length > available ? newItems.slice(0, available) : newItems;
          if (toAdd.length < newItems.length) {
            setWarning(
              `Only ${toAdd.length} of ${newItems.length} files added. Queue limit is ${MAX_QUEUE_SIZE}.`,
            );
          }
          const first = toAdd[0];
          if (first) {
            setWidth(first.originalWidth);
            setHeight(first.originalHeight);
            setAspectRatio(first.aspectRatio);
            setSelectedItemId(first.id);
          }
          return [...prev, ...toAdd];
        });
      }
    },
    [mode],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemoveItem = useCallback(
    (id: string) => {
      setQueue((prev) => {
        const item = prev.find((q) => q.id === id);
        if (item) {
          URL.revokeObjectURL(item.thumbnailUrl);
          if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        }
        return prev.filter((q) => q.id !== id);
      });
      if (selectedItemId === id) setSelectedItemId(null);
    },
    [selectedItemId],
  );

  const handleWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = clampDimension(Number(e.target.value) || 1);
      setWidth(v);
      if (aspectRatioLocked) {
        setHeight(clampDimension(Math.round(v / aspectRatio)));
      }
    },
    [aspectRatioLocked, aspectRatio],
  );

  const handleHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = clampDimension(Number(e.target.value) || 1);
      setHeight(v);
      if (aspectRatioLocked) {
        setWidth(clampDimension(Math.round(v * aspectRatio)));
      }
    },
    [aspectRatioLocked, aspectRatio],
  );

  const handleToggleAspectLock = useCallback(() => {
    setAspectRatioLocked((prev) => {
      if (!prev) {
        setAspectRatio(width / height);
      }
      return !prev;
    });
  }, [width, height]);

  const handleModeChange = useCallback(
    (newMode: ResizeMode) => {
      setMode(newMode);
      if (newMode === "single" && queue.length > 1) {
        const keepId = selectedItemId ?? queue[0]?.id;
        setQueue((prev) => {
          for (const q of prev) {
            if (q.id !== keepId) {
              URL.revokeObjectURL(q.thumbnailUrl);
              if (q.resultUrl) URL.revokeObjectURL(q.resultUrl);
            }
          }
          return prev.filter((q) => q.id === keepId);
        });
      }
    },
    [queue, selectedItemId],
  );

  const handleResizeAll = useCallback(async () => {
    if (queue.length === 0) return;
    setIsProcessing(true);
    setError(null);
    setOverallProgress(0);

    const options = { width, height, format: prefs.format, quality: prefs.quality };
    let processed = 0;

    for (const item of queue) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: "processing" as const, progress: 0 } : q,
        ),
      );

      const start = performance.now();
      try {
        const blob = await resizeImage(item.file, options);
        const resultUrl = URL.createObjectURL(blob);
        const elapsed = performance.now() - start;
        const filename = generateFilename(item.file.name, options);

        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: "done" as const,
                  progress: 100,
                  resultBlob: blob,
                  resultUrl,
                  resultSize: blob.size,
                  processingTime: Math.round(elapsed),
                }
              : q,
          ),
        );

        setRecentAssets((prev) => [{ blob, url: resultUrl, filename }, ...prev].slice(0, 10));
      } catch {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "error" as const, error: "Resize failed" } : q,
          ),
        );
      }

      processed++;
      setOverallProgress(Math.round((processed / queue.length) * 100));
    }

    setIsProcessing(false);

    if (mode === "single") {
      setQueue((prev) => {
        const doneItem = prev.find((q) => q.status === "done");
        if (doneItem?.resultBlob) {
          const filename = generateFilename(doneItem.file.name, options);
          downloadBlob(doneItem.resultBlob, filename);
        }
        return prev;
      });
    }
  }, [queue, width, height, prefs.format, prefs.quality, mode]);

  const handleDownloadZip = useCallback(async () => {
    const doneItems = queue.filter((q) => q.status === "done" && q.resultBlob);
    if (doneItems.length === 0) return;

    const options = { width, height, format: prefs.format, quality: prefs.quality };
    const zipItems = doneItems.map((item) => ({
      blob: item.resultBlob as Blob,
      filename: generateFilename(item.file.name, options),
    }));

    try {
      const zipBlob = await createBatchZip(zipItems);
      downloadBlob(zipBlob, "resized-images.zip");
    } catch {
      setError("Failed to create ZIP file.");
    }
  }, [queue, width, height, prefs.format, prefs.quality]);

  const handleDownloadSingle = useCallback(
    (item: QueueItem) => {
      if (!item.resultBlob) return;
      const filename = generateFilename(item.file.name, {
        width,
        height,
        format: prefs.format,
        quality: prefs.quality,
      });
      downloadBlob(item.resultBlob, filename);
    },
    [width, height, prefs.format, prefs.quality],
  );

  const selectedItem = queue.find((q) => q.id === selectedItemId);
  const doneCount = queue.filter((q) => q.status === "done").length;
  const processingIndex = queue.findIndex((q) => q.status === "processing");
  const hasQueue = queue.length > 0;
  const fileCountLabel = `${queue.length} ${queue.length === 1 ? "File" : "Files"}`;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => handleResizeAll(),
          enabled: hasQueue && !isProcessing,
        },
        {
          key: "s",
          meta: true,
          handler: () => handleDownloadZip(),
          enabled: mode === "batch" && doneCount > 1,
        },
      ],
      [hasQueue, isProcessing, mode, doneCount, handleResizeAll, handleDownloadZip],
    ),
  );

  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column — controls */}
        <div className="space-y-6 lg:col-span-7">
          {/* Upload zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
              isDragging
                ? "bg-lemon shadow-[6px_6px_0_var(--ink)] -translate-x-px -translate-y-px"
                : "bg-paper shadow-pop-3 hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)] hover:-translate-x-px hover:-translate-y-px",
            )}
          >
            <div className="flex flex-col items-center gap-4">
              <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper shadow-pop-2 transition-transform duration-200 group-hover:rotate-[-4deg]">
                <Upload className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <p className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                  Drag and drop images here
                </p>
                <p className="text-sm text-ink-2">
                  PNG, JPG, WebP{mode === "batch" ? " · Bulk upload up to 50 files" : ""}
                </p>
              </div>
              <span className="wb-btn wb-btn--sm wb-btn--ghost mt-1 pointer-events-none">
                Browse Files
              </span>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple={mode === "batch"}
                onChange={handleFileInput}
                onClick={(e) => e.stopPropagation()}
                data-testid="file-input"
              />
            </div>
          </button>

          <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
          <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

          {/* Configuration */}
          <section className="wb-panel">
            <PaneHeader
              label="Configuration"
              icon={<Settings className="size-4" aria-hidden="true" />}
              actions={
                <Tabs value={mode} onValueChange={(v) => handleModeChange(v as ResizeMode)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="single" className="px-3 py-1 text-xs font-bold">
                      Single
                    </TabsTrigger>
                    <TabsTrigger value="batch" className="px-3 py-1 text-xs font-bold">
                      Batch
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            />
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resize-width" className="text-ink-2">
                    Width (px)
                  </Label>
                  <Input
                    id="resize-width"
                    type="number"
                    min={1}
                    max={10000}
                    value={width}
                    onChange={handleWidthChange}
                    className="border-2 border-ink bg-paper font-mono text-[14px] tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resize-height" className="text-ink-2">
                    Height (px)
                  </Label>
                  <div className="relative flex items-center gap-2">
                    <Input
                      id="resize-height"
                      className="flex-1 border-2 border-ink bg-paper font-mono text-[14px] tabular-nums"
                      type="number"
                      min={1}
                      max={10000}
                      value={height}
                      onChange={handleHeightChange}
                    />
                    <button
                      type="button"
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-md border-2 border-ink transition-[background,color,transform] duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                        aspectRatioLocked
                          ? "bg-ink text-paper shadow-pop-1"
                          : "bg-paper text-ink-2 hover:bg-lemon hover:text-ink shadow-pop-1",
                      )}
                      title={aspectRatioLocked ? "Unlock Aspect Ratio" : "Lock Aspect Ratio"}
                      aria-label={aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                      aria-pressed={aspectRatioLocked}
                      onClick={handleToggleAspectLock}
                      data-testid="aspect-lock"
                    >
                      {aspectRatioLocked ? (
                        <Link2 className="size-4" aria-hidden="true" />
                      ) : (
                        <Link2Off className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-ink-2">Format</Label>
                  <Select
                    value={prefs.format}
                    onValueChange={(v) => setPrefs({ format: v as OutputFormat })}
                  >
                    <SelectTrigger className="border-2 border-ink bg-paper">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jpeg">JPEG</SelectItem>
                      <SelectItem value="png">PNG</SelectItem>
                      <SelectItem value="webp">WebP</SelectItem>
                      <SelectItem value="avif" disabled={!avifSupported}>
                        AVIF{!avifSupported ? " (Not supported)" : ""}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="resize-quality" className="text-ink-2">
                      Quality
                    </Label>
                    <span
                      className={cn(
                        "font-mono text-[12px] font-bold tabular-nums",
                        prefs.format === "png" ? "text-ink-3" : "text-tomato",
                      )}
                    >
                      {prefs.format === "png" ? "N/A" : `${prefs.quality}%`}
                    </span>
                  </div>
                  <Slider
                    id="resize-quality"
                    max={100}
                    min={1}
                    step={1}
                    value={[prefs.quality]}
                    disabled={prefs.format === "png"}
                    onValueChange={([v]) => setPrefs({ quality: v })}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleResizeAll}
                disabled={!hasQueue || isProcessing}
                className="wb-btn w-full justify-center py-4 text-[15px]"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <LayoutGrid className="size-4" aria-hidden="true" />
                    <span>Resize {mode === "batch" ? "& Download All" : "& Download"}</span>
                    <KbdHint>⌘⏎</KbdHint>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Processing Queue */}
          <section className="wb-panel wb-panel--out">
            <PaneHeader
              label="Processing Queue"
              icon={<ListOrdered className="size-4" aria-hidden="true" />}
              className="bg-paper-2"
              actions={
                <>
                  <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
                    {isProcessing
                      ? `${Math.min(processingIndex + 1, queue.length)} of ${queue.length}`
                      : fileCountLabel}
                  </span>
                  {mode === "batch" && doneCount > 1 && (
                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      className="wb-btn wb-btn--sm wb-btn--ghost"
                      aria-label="Download all resized images as ZIP"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      <span>Download ZIP</span>
                      <KbdHint>⌘S</KbdHint>
                    </button>
                  )}
                </>
              }
            />
            {isProcessing && (
              <div
                className="h-1.5 w-full overflow-hidden border-b-2 border-ink bg-paper"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-tomato transition-[width] duration-300 ease-out"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            )}
            <div
              className="max-h-[320px] space-y-2 overflow-y-auto p-3 sm:p-4"
              aria-label="Processing queue"
            >
              {queue.length === 0 && (
                <p className="py-10 text-center text-sm text-ink-3">
                  No images in queue. Upload files to get started.
                </p>
              )}
              {queue.map((item) => {
                const selected = selectedItemId === item.id;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border-2 p-2.5 transition-[background,box-shadow,transform,border-color] duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2",
                      selected
                        ? "border-ink bg-lemon shadow-pop-2 -translate-x-px -translate-y-px"
                        : "border-ink bg-paper shadow-pop-1 hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                    )}
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: queue items need keyboard focus for selection
                    tabIndex={0}
                    aria-current={selected || undefined}
                    aria-label={item.file.name}
                    onClick={() => setSelectedItemId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedItemId(item.id);
                      }
                    }}
                  >
                    <div className="size-11 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
                      <img className="h-full w-full object-cover" src={item.thumbnailUrl} alt="" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-ink">
                        {item.file.name}
                      </p>
                      {item.status === "processing" ? (
                        <div
                          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10"
                          aria-hidden="true"
                        >
                          <div className="h-full w-2/3 animate-pulse rounded-full bg-tomato" />
                        </div>
                      ) : (
                        <p className="font-mono text-[11px] text-ink-3 tabular-nums">
                          {formatBytes(item.file.size)}
                          {item.status === "done" && item.resultSize !== undefined && (
                            <>
                              {" → "}
                              <span className="text-grass font-semibold">
                                {formatBytes(item.resultSize)}
                              </span>
                            </>
                          )}
                          {item.status === "error" && (
                            <>
                              {" · "}
                              <span className="text-tomato font-semibold">
                                {item.error ?? "Error"}
                              </span>
                            </>
                          )}
                          {item.status === "pending" && (
                            <>
                              {" · "}
                              <span className="text-ink-2">Ready</span>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    {item.status === "done" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadSingle(item);
                        }}
                        className="grid size-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper text-ink transition-[background,transform] duration-200 hover:bg-mint hover:-translate-x-px hover:-translate-y-px shadow-pop-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2"
                        title="Download"
                        aria-label={`Download ${item.file.name}`}
                      >
                        <Download className="size-4" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveItem(item.id);
                      }}
                      className="grid size-9 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:text-tomato focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2"
                      title="Remove"
                      aria-label={`Remove ${item.file.name}`}
                      data-testid={`remove-${item.id}`}
                    >
                      <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right column — preview */}
        <div className="lg:col-span-5">
          <section className="wb-panel wb-panel--out flex h-full flex-col">
            <PaneHeader
              label="Live Preview"
              icon={<Eye className="size-4" aria-hidden="true" />}
              className="bg-paper-2"
              actions={
                <span className="inline-flex items-center rounded-md border-2 border-ink bg-paper px-2 py-1 font-mono text-[11px] font-medium text-ink shadow-pop-1 tabular-nums">
                  {width} x {height}
                </span>
              }
            />
            <div className="flex min-h-[400px] flex-1 items-center justify-center p-5 sm:p-6">
              {previewUrl ? (
                <img
                  className="max-h-[480px] rounded-md border-2 border-ink object-contain shadow-pop-3"
                  src={previewUrl}
                  alt="Resized preview"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-ink-3">
                  <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink-3 bg-paper">
                    <ImageIcon className="size-6" aria-hidden="true" />
                  </span>
                  <p className="text-sm">Upload an image to see preview</p>
                </div>
              )}
            </div>
            {selectedItem && (
              <div className="grid grid-cols-2 gap-3 border-t-2 border-ink bg-paper p-4 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                    Original
                  </span>
                  <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
                    {formatBytes(selectedItem.file.size)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                    {selectedItem.resultSize ? "Output" : "Estimated"}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-tomato tabular-nums">
                    {selectedItem.resultSize
                      ? formatBytes(selectedItem.resultSize)
                      : formatBytes(
                          estimateSize(
                            selectedItem.file.size,
                            selectedItem.originalWidth,
                            selectedItem.originalHeight,
                            width,
                            height,
                            prefs.format,
                            prefs.quality,
                          ),
                        )}
                  </span>
                </div>
                {selectedItem.processingTime !== undefined && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                      Time
                    </span>
                    <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
                      ~{selectedItem.processingTime}ms
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Recent assets */}
      {recentAssets.length > 0 && (
        <div className="mt-10">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="wb-h3 text-ink">Recent assets</h2>
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3">
              Click to download
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {recentAssets.map((asset) => (
              <button
                type="button"
                key={asset.url}
                className="group relative aspect-square overflow-hidden rounded-md border-2 border-ink bg-paper shadow-pop-1 transition-[transform,box-shadow] duration-200 hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                aria-label={`Download ${asset.filename}`}
                onClick={() => downloadBlob(asset.blob, asset.filename)}
              >
                <img className="h-full w-full object-cover" src={asset.url} alt="" />
                <div className="absolute inset-0 flex items-center justify-center bg-ink/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Download className="size-6 text-paper" aria-hidden="true" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
