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
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
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

  // Detect AVIF support on mount
  useEffect(() => {
    setAvifSupported(isFormatSupported("avif"));
  }, []);

  // Auto-dismiss warning after 8s
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Debounced preview generation
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
        // Replace entire queue with the single item
        setQueue((prev) => {
          for (const q of prev) URL.revokeObjectURL(q.thumbnailUrl);
          return newItems;
        });
        // Single mode always enqueues, so defaults are always valid
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
          // Set defaults from first actually-added item
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
      // Reset input so same file can be re-selected
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
        // Locking: compute ratio from current dimensions
        setAspectRatio(width / height);
      }
      return !prev;
    });
  }, [width, height]);

  const handleModeChange = useCallback(
    (newMode: ResizeMode) => {
      setMode(newMode);
      if (newMode === "single" && queue.length > 1) {
        // Keep only the selected (or first) item
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

        // Add to recent assets (cap at 10)
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

    // Auto-download for single mode
    if (mode === "single") {
      // Need fresh queue state for the result
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
  const hasQueue = queue.length > 0;

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
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-7">
          {/* Upload zone */}
          <div
            className={`group cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 transition-transform group-hover:scale-110 sm:h-16 sm:w-16">
                <Upload className="h-6 w-6 text-primary sm:h-8 sm:w-8" />
              </div>
              <div>
                <p className="text-base font-bold text-foreground sm:text-lg">
                  Drag and drop images here
                </p>
                <p className="text-muted-foreground">
                  Supports PNG, JPG, WebP{mode === "batch" ? " (Bulk upload supported)" : ""}
                </p>
              </div>
              <Button className="mt-2" onClick={() => fileInputRef.current?.click()}>
                Browse Files
              </Button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple={mode === "batch"}
                onChange={handleFileInput}
                data-testid="file-input"
              />
            </div>
          </div>

          <ErrorAlert error={error} className="mt-0" />

          {warning !== null && (
            <output className="block flex items-start gap-3 rounded-[14px] border-2 border-ink bg-lemon px-4 py-3 shadow-pop-2">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={2.5} />
              <p className="font-mono text-[13px] leading-relaxed text-ink">{warning}</p>
            </output>
          )}

          {/* Configuration */}
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0 border-b border-border px-6 py-4">
              <Settings className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-bold">Configuration</CardTitle>
              <Tabs
                value={mode}
                onValueChange={(v) => handleModeChange(v as ResizeMode)}
                className="ml-auto"
              >
                <TabsList className="h-8">
                  <TabsTrigger value="single" className="px-3 py-1 text-xs font-bold">
                    Single
                  </TabsTrigger>
                  <TabsTrigger value="batch" className="px-3 py-1 text-xs font-bold">
                    Batch
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resize-width">Width (px)</Label>
                  <Input
                    id="resize-width"
                    type="number"
                    min={1}
                    max={10000}
                    value={width}
                    onChange={handleWidthChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resize-height">Height (px)</Label>
                  <div className="relative flex items-center gap-2">
                    <Input
                      id="resize-height"
                      className="flex-1"
                      type="number"
                      min={1}
                      max={10000}
                      value={height}
                      onChange={handleHeightChange}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className={
                        aspectRatioLocked
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      }
                      title={aspectRatioLocked ? "Unlock Aspect Ratio" : "Lock Aspect Ratio"}
                      aria-label={aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                      onClick={handleToggleAspectLock}
                      data-testid="aspect-lock"
                    >
                      {aspectRatioLocked ? (
                        <Link2 className="h-5 w-5" />
                      ) : (
                        <Link2Off className="h-5 w-5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select
                    value={prefs.format}
                    onValueChange={(v) => setPrefs({ format: v as OutputFormat })}
                  >
                    <SelectTrigger>
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
                    <Label htmlFor="resize-quality">Quality</Label>
                    <span className="text-xs font-bold text-primary">
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

              <Button
                className="w-full py-4 font-bold"
                size="lg"
                onClick={handleResizeAll}
                disabled={!hasQueue || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <LayoutGrid className="h-4 w-4" />
                    Resize {mode === "batch" ? "& Download All" : "& Download"}
                    <KbdHint>⌘⏎</KbdHint>
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Processing Queue */}
          <Card className="mt-6">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-primary" />
                <CardTitle className="text-base font-bold">Processing Queue</CardTitle>
              </div>
              <div className="relative flex items-center gap-3 pb-2">
                {mode === "batch" && doneCount > 1 && (
                  <Button variant="outline" size="sm" onClick={handleDownloadZip}>
                    <Download className="h-3.5 w-3.5" />
                    Download as ZIP
                  </Button>
                )}
                {isProcessing && (
                  <div className="absolute -bottom-1 left-0 right-0 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                )}
                <span className="text-xs font-bold text-muted-foreground">
                  {isProcessing
                    ? `Processing ${queue.filter((q) => q.status === "done").length + 1} of ${queue.length}...`
                    : `${queue.length} ${queue.length === 1 ? "File" : "Files"}`}
                </span>
              </div>
            </CardHeader>
            <CardContent
              className="max-h-[300px] space-y-3 overflow-y-auto p-4"
              aria-label="Processing queue"
            >
              {queue.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No images in queue. Upload files to get started.
                </p>
              )}
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-[background,border-color,transform] duration-200 ${
                    selectedItemId === item.id
                      ? "border-primary bg-primary/5 -translate-y-px"
                      : "border-border bg-muted hover:border-primary/30 hover:-translate-y-px"
                  }`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: queue items need keyboard focus for selection
                  tabIndex={0}
                  aria-current={selectedItemId === item.id || undefined}
                  aria-label={item.file.name}
                  onClick={() => setSelectedItemId(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedItemId(item.id);
                    }
                  }}
                >
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
                    <img
                      className="h-full w-full object-cover"
                      src={item.thumbnailUrl}
                      alt={`${item.file.name} preview`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.file.name}</p>
                    {item.status === "processing" ? (
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(item.file.size)} •{" "}
                        {item.status === "done"
                          ? `Done (${formatBytes(item.resultSize ?? 0)})`
                          : item.status === "error"
                            ? (item.error ?? "Error")
                            : "Ready"}
                      </p>
                    )}
                  </div>
                  {item.status === "done" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-primary hover:text-primary/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadSingle(item);
                      }}
                      title="Download"
                      aria-label={`Download ${item.file.name}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveItem(item.id);
                    }}
                    title="Remove"
                    aria-label={`Remove ${item.file.name}`}
                    data-testid={`remove-${item.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column -- Preview */}
        <div className="lg:col-span-5">
          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                <CardTitle className="text-base font-bold">Live Preview</CardTitle>
              </div>
              <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                {width} x {height}
              </span>
            </CardHeader>
            <CardContent className="flex min-h-[400px] flex-1 items-center justify-center bg-muted p-6">
              {previewUrl ? (
                <img
                  className="max-h-[500px] rounded-lg border-2 border-ink object-contain shadow-pop-3"
                  src={previewUrl}
                  alt="Resized preview"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <ImageIcon className="h-12 w-12" />
                  <p className="text-sm">Upload an image to see preview</p>
                </div>
              )}
            </CardContent>
            {selectedItem && (
              <div className="flex flex-wrap gap-4 bg-muted p-4 text-xs">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Original Size</span>
                  <span className="font-bold">{formatBytes(selectedItem.file.size)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Estimated Size</span>
                  <span className="font-bold text-primary">
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
                  <div className="ml-auto flex flex-col">
                    <span className="text-muted-foreground">Processing Time</span>
                    <span className="font-bold">~{selectedItem.processingTime}ms</span>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Recent Assets */}
      {recentAssets.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-4 text-xl font-bold text-foreground">Recent Assets</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {recentAssets.map((asset) => (
              <button
                type="button"
                key={asset.url}
                className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-border bg-muted"
                aria-label={`Download ${asset.filename}`}
                onClick={() => downloadBlob(asset.blob, asset.filename)}
              >
                <img className="h-full w-full object-cover" src={asset.url} alt={asset.filename} />
                <div className="absolute inset-0 flex items-center justify-center bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Download className="h-6 w-6 text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
