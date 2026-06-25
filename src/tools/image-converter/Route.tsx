import {
  ArrowLeftRight,
  CircleAlert,
  Download,
  Images,
  Loader2,
  Settings2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import {
  type ConvertOptions,
  DEFAULT_BG_COLOR,
  DEFAULT_QUALITY,
  type ImageMeta,
  LARGE_OUTPUT_WARN_SIZE,
  MAX_QUEUE_SIZE,
  MAX_TOTAL_SIZE,
  type OutputFormat,
  buildOutputFilename,
  buildZipName,
  canDecodeAvif,
  canEncode,
  convertImage,
  createBatchZip,
  downloadBlob,
  readImageMeta,
  validateImageFile,
} from "./converter";

interface ImageEntry {
  id: string;
  file: File;
  previewUrl: string;
  meta?: ImageMeta;
  status: "loading" | "ready" | "converting" | "done" | "error";
  outputBlob?: Blob;
  outputSize?: number;
  downscaled?: boolean;
  error?: string;
}

// DEFAULT_QUALITY (0..1) is the single source of truth; the slider/prefs store a 0–100 integer.
const DEFAULT_PREFS = {
  format: "png" as OutputFormat,
  quality: Math.round(DEFAULT_QUALITY * 100),
  bgColor: DEFAULT_BG_COLOR,
};

// Input formats that can carry transparency — only then does the JPEG background color matter.
const ALPHA_CAPABLE = new Set<ImageMeta["format"]>(["png", "webp", "gif", "avif"]);

const FORMAT_LABELS: Record<OutputFormat, string> = {
  png: "PNG",
  jpeg: "JPG",
  webp: "WebP",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sizeDelta(input: number, output: number): { label: string; grew: boolean } {
  const grew = output > input;
  const diff = Math.abs(output - input);
  const pct = input > 0 ? Math.round((diff / input) * 100) : 0;
  return { label: `${grew ? "+" : "−"}${formatBytes(diff)} (${pct}%)`, grew };
}

export default function ImageConverterRoute() {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [prefs, setPrefs] = useToolPreferences("image-converter", DEFAULT_PREFS);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [avifSupported, setAvifSupported] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(entries);
  filesRef.current = entries;

  const webpSupported = useMemo(() => canEncode("image/webp"), []);

  // Coerce an unsupported persisted format (e.g. "webp" on a browser that can't encode it) back to a
  // safe default — otherwise the format Select renders blank and every convert fails the blob.type check.
  useEffect(() => {
    if (!webpSupported && prefs.format === "webp") setPrefs({ format: "png" });
  }, [webpSupported, prefs.format, setPrefs]);

  useEffect(() => {
    let active = true;
    canDecodeAvif().then((supported) => {
      if (active) setAvifSupported(supported);
    });
    return () => {
      active = false;
    };
  }, []);

  // Revoke every thumbnail object URL on unmount.
  useEffect(() => {
    return () => {
      for (const e of filesRef.current) {
        URL.revokeObjectURL(e.previewUrl);
      }
    };
  }, []);

  const setEntry = useCallback((id: string, patch: Partial<ImageEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const setEntryStatus = useCallback(
    (id: string, status: ImageEntry["status"]) => setEntry(id, { status }),
    [setEntry],
  );

  const readMeta = useCallback(
    async (toRead: ImageEntry[]) => {
      // Sequential — readImageMeta decodes the bitmap; a parallel fan-out spikes memory on a big drop.
      for (const entry of toRead) {
        try {
          const meta = await readImageMeta(entry.file);
          setEntry(entry.id, { meta, status: "ready" });
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Could not read this image. It may be corrupt.";
          setEntry(entry.id, { status: "error", error: message });
        }
      }
    },
    [setEntry],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      setWarning(null);

      const accepted: ImageEntry[] = [];
      for (const file of Array.from(fileList)) {
        const validation = validateImageFile(file);
        if (!validation.valid) {
          setError(validation.error ?? "Invalid file.");
          continue;
        }
        if (validation.warning) setWarning(validation.warning);
        accepted.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "loading",
        });
      }
      if (accepted.length === 0) return;

      const prev = filesRef.current;
      const available = MAX_QUEUE_SIZE - prev.length;
      if (available <= 0) {
        setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} images). Remove some first.`);
        for (const e of accepted) URL.revokeObjectURL(e.previewUrl);
        return;
      }

      const queueLimited = accepted.length > available ? accepted.slice(0, available) : accepted;
      if (queueLimited.length < accepted.length) {
        setWarning(
          `Only ${queueLimited.length} of ${accepted.length} images added. Limit is ${MAX_QUEUE_SIZE}.`,
        );
        for (const e of accepted.slice(queueLimited.length)) URL.revokeObjectURL(e.previewUrl);
      }

      // Cap cumulative input footprint.
      let runningSize = prev.reduce((sum, e) => sum + e.file.size, 0);
      const toAdd: ImageEntry[] = [];
      for (const entry of queueLimited) {
        if (runningSize + entry.file.size > MAX_TOTAL_SIZE) break;
        runningSize += entry.file.size;
        toAdd.push(entry);
      }
      if (toAdd.length < queueLimited.length) {
        const capMb = Math.round(MAX_TOTAL_SIZE / (1024 * 1024));
        setWarning(`Total size limit reached (max ${capMb}MB). Some images were not added.`);
        for (const e of queueLimited.slice(toAdd.length)) URL.revokeObjectURL(e.previewUrl);
      }
      if (toAdd.length === 0) return;

      setEntries((cur) => [...cur, ...toAdd]);
      setStatusMessage(
        toAdd.length === 1 ? `Added ${toAdd[0]?.file.name}.` : `Added ${toAdd.length} images.`,
      );
      await readMeta(toAdd);
    },
    [readMeta],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) void handleFiles(files);
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
      if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemove = useCallback((id: string) => {
    // Side effects run in the handler body (not inside the setEntries updater, which must stay pure —
    // React double-invokes updaters under StrictMode). filesRef mirrors the committed entries.
    const item = filesRef.current.find((e) => e.id === id);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
      setStatusMessage(`Removed ${item.file.name}.`);
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const isLoadingAny = useMemo(() => entries.some((e) => e.status === "loading"), [entries]);
  const convertibleCount = useMemo(
    () => entries.filter((e) => e.status !== "loading").length,
    [entries],
  );
  const hasAlphaInput = useMemo(
    () => entries.some((e) => e.meta && ALPHA_CAPABLE.has(e.meta.format)),
    [entries],
  );
  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.file.size, 0), [entries]);
  const doneCount = useMemo(() => entries.filter((e) => e.status === "done").length, [entries]);

  const canConvert = convertibleCount >= 1 && !isConverting && !isLoadingAny;
  const showQuality = prefs.format === "jpeg" || prefs.format === "webp";
  const showBgColor = prefs.format === "jpeg" && hasAlphaInput;

  const handleConvert = useCallback(async () => {
    if (isConverting) return;
    setError(null);
    setWarning(null);

    // Snapshot from the ref so per-iteration setEntry updates don't fight a stale closure.
    // Convertible = ready | done | error (skip only loading) so re-convert and retry both work.
    const ready = filesRef.current.filter((e) => e.status !== "loading");
    if (ready.length === 0) return;

    const opts: ConvertOptions = {
      format: prefs.format,
      quality: prefs.quality / 100,
      bgColor: prefs.bgColor,
    };

    setIsConverting(true);
    setProgress({ done: 0, total: ready.length });
    setStatusMessage(`Converting ${ready.length} image${ready.length === 1 ? "" : "s"}.`);

    const succeeded: { id: string; blob: Blob; filename: string }[] = [];
    const failedNames: string[] = [];
    let downscaledCount = 0;

    for (let i = 0; i < ready.length; i++) {
      const e = ready[i];
      if (!e) continue;
      // Skip rows removed from the queue after the snapshot was taken — a mid-convert removal must not
      // land the removed file in the downloaded zip.
      if (!filesRef.current.some((x) => x.id === e.id)) continue;
      setEntryStatus(e.id, "converting");
      try {
        const r = await convertImage(e.file, opts);
        succeeded.push({
          id: e.id,
          blob: r.blob,
          filename: buildOutputFilename(e.file.name, opts.format),
        });
        if (r.downscaled) downscaledCount++;
        setEntry(e.id, {
          status: "done",
          outputBlob: r.blob,
          outputSize: r.blob.size,
          downscaled: r.downscaled,
        });
      } catch (err) {
        failedNames.push(e.file.name);
        setEntry(e.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Conversion failed",
        });
      }
      setProgress({ done: i + 1, total: ready.length });
      if (i + 1 < ready.length) await new Promise((res) => setTimeout(res, 0));
    }

    setIsConverting(false);

    // Drop any row removed from the queue mid-run (even after it converted) so it isn't packaged.
    const present = new Set(filesRef.current.map((x) => x.id));
    const finalOutputs = succeeded.filter((s) => present.has(s.id));

    if (finalOutputs.length === 0) {
      setError("No images could be converted.");
      setStatusMessage("Conversion failed.");
      return;
    }

    // Download policy keyed on SUCCESS count: 1 → single file, >1 → zip.
    try {
      if (finalOutputs.length === 1) {
        const only = finalOutputs[0];
        if (only) downloadBlob(only.blob, only.filename);
      } else {
        const zip = await createBatchZip(finalOutputs);
        downloadBlob(zip, buildZipName(finalOutputs.length));
      }
    } catch {
      setError("Could not package the converted images.");
      return;
    }

    const label = FORMAT_LABELS[opts.format];
    toast.success(
      `Converted ${finalOutputs.length} image${finalOutputs.length === 1 ? "" : "s"} to ${label}`,
    );
    setStatusMessage(
      `Converted ${finalOutputs.length} image${finalOutputs.length === 1 ? "" : "s"}.`,
    );

    const warnings: string[] = [];
    if (failedNames.length > 0) {
      warnings.push(`Couldn't convert: ${failedNames.join(", ")}.`);
    }
    if (downscaledCount > 0) {
      warnings.push(
        `${downscaledCount} image${downscaledCount === 1 ? " was" : "s were"} downscaled to fit canvas limits.`,
      );
    }
    const totalOutput = finalOutputs.reduce((sum, s) => sum + s.blob.size, 0);
    if (totalOutput > LARGE_OUTPUT_WARN_SIZE) {
      warnings.push(`Converted images total ~${formatBytes(totalOutput)}.`);
    }
    if (warnings.length > 0) setWarning(warnings.join(" "));
  }, [isConverting, prefs, setEntry, setEntryStatus]);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => handleConvert(),
          enabled: canConvert,
        },
      ],
      [canConvert, handleConvert],
    ),
  );

  const left = (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label="Add images: drop here, or click to browse"
        className={cn(
          "wb-lift-hover group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
          isDragging
            ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
            : "bg-paper shadow-pop-3 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)]",
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <span
            className="wb-plate-tilt grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper shadow-pop-2 group-hover:rotate-[-4deg]"
            data-dragging={isDragging}
          >
            <Upload className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
              Drop images here or click to browse
            </p>
            <p className="wb-fade-in text-sm text-ink-2">
              PNG, JPG, WebP, GIF, BMP{avifSupported ? ", AVIF" : ""}. Conversion happens in your
              browser — nothing is uploaded.
            </p>
            <p className="text-[12px] text-ink-3">
              Animated GIF/WebP convert the first frame only. EXIF/GPS metadata is removed.
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
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/x-ms-bmp,image/avif"
        multiple
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      <WarningAlert
        warning={warning}
        testId="warning"
        className="mt-0"
        onDismiss={() => setWarning(null)}
      />

      <section className="wb-panel wb-panel--out" aria-labelledby="images-list-label">
        <PaneHeader
          label="Images"
          labelId="images-list-label"
          icon={<Images className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
          actions={
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
              {entries.length} {entries.length === 1 ? "Image" : "Images"}
            </span>
          }
        />
        <div className="space-y-2 p-3 sm:p-4">
          {entries.length === 0 ? (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
              No images yet. Add some above, then pick an output format and convert.
            </p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="wb-item-enter flex items-center gap-3 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1"
              >
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-ink bg-paper-2">
                  <img
                    src={entry.previewUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13.5px] font-semibold text-ink"
                    title={entry.file.name}
                  >
                    {entry.file.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {entry.status === "loading" && (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        Reading…
                      </span>
                    )}
                    {entry.meta && (
                      <>
                        <StatusBadge
                          tone="neutral"
                          label={`${entry.meta.width}×${entry.meta.height}`}
                        />
                        <StatusBadge tone="neutral" label={entry.meta.format} />
                      </>
                    )}
                    {entry.status === "converting" && (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        Converting…
                      </span>
                    )}
                    {entry.status === "error" && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-ink">
                        <CircleAlert className="size-3.5 shrink-0 text-tomato" aria-hidden="true" />
                        {entry.error ?? "Error"}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                      {formatBytes(entry.file.size)}
                      {entry.status === "done" && entry.outputSize !== undefined && (
                        <>
                          {" → "}
                          <span
                            className={cn(
                              "font-semibold",
                              sizeDelta(entry.file.size, entry.outputSize).grew
                                ? "text-tomato"
                                : "text-grass",
                            )}
                          >
                            {formatBytes(entry.outputSize)}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:text-tomato sm:size-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                  title="Remove"
                  aria-label={`Remove ${entry.file.name}`}
                  data-testid={`remove-${entry.id}`}
                >
                  <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const right = (
    <section
      className="wb-panel flex flex-col lg:self-start"
      aria-labelledby="convert-options-label"
    >
      <PaneHeader
        label="Output Options"
        labelId="convert-options-label"
        icon={<Settings2 className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="output-format" className="text-ink-2">
            Output format
          </Label>
          <Select
            value={prefs.format}
            onValueChange={(v) => setPrefs({ format: v as OutputFormat })}
          >
            <SelectTrigger
              id="output-format"
              className="h-11 border-2 border-ink bg-paper sm:h-10"
              data-testid="format-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="jpeg">JPG</SelectItem>
              {webpSupported && <SelectItem value="webp">WebP</SelectItem>}
            </SelectContent>
          </Select>
          {!webpSupported && (
            <p className="text-[12px] text-ink-3">WebP output is not supported in this browser.</p>
          )}
        </div>

        {showQuality && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="convert-quality" className="text-ink-2">
                Quality
              </Label>
              <span className="font-mono text-[12px] font-bold tabular-nums text-tomato">
                {prefs.quality}%
              </span>
            </div>
            <Slider
              id="convert-quality"
              max={100}
              min={60}
              step={1}
              value={[prefs.quality]}
              onValueChange={([v]) => setPrefs({ quality: v ?? DEFAULT_PREFS.quality })}
            />
            <p className="text-[12px] text-ink-3">
              Higher = better quality, larger file. PNG is always lossless.
            </p>
          </div>
        )}

        {showBgColor && (
          <div className="space-y-2">
            <Label htmlFor="bg-color" className="text-ink-2">
              Background color
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id="bg-color"
                type="color"
                value={prefs.bgColor}
                onChange={(e) => setPrefs({ bgColor: e.target.value })}
                className="h-11 w-16 border-2 border-ink bg-paper p-1 sm:h-10"
                data-testid="bg-color-input"
                aria-label="JPEG background color"
              />
              <span className="font-mono text-[12px] text-ink-2 tabular-nums">{prefs.bgColor}</span>
            </div>
            <p className="text-[12px] text-ink-3">
              JPEG has no transparency; transparent areas use this color.
            </p>
          </div>
        )}

        <div className="space-y-3 border-t-2 border-ink pt-5">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-mono uppercase tracking-wider text-ink-3">Output</span>
            <span className="font-mono font-semibold text-ink tabular-nums">
              {convertibleCount} {convertibleCount === 1 ? "image" : "images"} ·{" "}
              {formatBytes(totalSize)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleConvert}
            disabled={!canConvert}
            className="wb-btn w-full justify-center py-4 text-[15px]"
            data-testid="convert-button"
          >
            <IconSwap swapKey={isConverting}>
              {isConverting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>
                    {progress.total > 0
                      ? `Converting ${progress.done}/${progress.total}`
                      : "Converting…"}
                  </span>
                </>
              ) : (
                <>
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                  <span>Convert &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {isConverting && progress.total > 0 && (
            // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, not an operable widget
            <div
              className="wb-fade-in h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-paper-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label={`Converting, ${progress.done} of ${progress.total} done`}
            >
              <div
                className="h-full origin-left bg-tomato transition-transform duration-200 ease-out motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress.done / progress.total})` }}
              />
            </div>
          )}
          {convertibleCount === 0 && !isConverting && (
            <p className="text-center text-[12.5px] text-ink-3">
              Add at least one image to convert.
            </p>
          )}
          {doneCount > 0 && !isConverting && (
            <p className="wb-fade-in flex items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-2">
              <Download className="size-3.5" aria-hidden="true" />
              Converted {doneCount} image{doneCount === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>
      <TwoPane gap="8" left={left} right={right} />
    </ToolShell>
  );
}
