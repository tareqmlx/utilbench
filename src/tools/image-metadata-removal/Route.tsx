import {
  Check,
  CloudUpload,
  Download,
  ListOrdered,
  Loader2,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, WarningAlert } from "../../components/tool-layout";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";
import { MAX_QUEUE_SIZE } from "../constants";
import { buildZip, downloadBlob, extractMetadata, stripMetadata, validateFile } from "./metadata";
import type { FileItem } from "./metadata";

export default function ImageMetadataRemovalRoute() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    return () => {
      for (const f of filesRef.current) {
        URL.revokeObjectURL(f.previewUrl);
      }
    };
  }, []);

  const handleFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    setWarning(null);
    setZipBlob(null);

    const newItems: FileItem[] = [];
    for (const file of Array.from(fileList)) {
      const validation = validateFile(file);
      if (!validation.valid) {
        setError(validation.error ?? "Unknown error");
        continue;
      }
      if (validation.warning) {
        setWarning(validation.warning);
      }
      newItems.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "analyzing",
        metadata: null,
        cleanedBlob: null,
        error: null,
      });
    }

    if (newItems.length === 0) return;

    const currentCount = filesRef.current.length;
    const available = MAX_QUEUE_SIZE - currentCount;
    if (available <= 0) {
      setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files). Remove some files first.`);
      return;
    }
    if (newItems.length > available) {
      setWarning(
        `Only ${available} of ${newItems.length} files added. Queue limit is ${MAX_QUEUE_SIZE}.`,
      );
      newItems.splice(available);
    }

    setFiles((prev) => [...prev, ...newItems]);
    setStatusMessage(
      newItems.length === 1
        ? `Added ${newItems[0]?.file.name}. Analyzing metadata.`
        : `Added ${newItems.length} files. Analyzing metadata.`,
    );

    for (const item of newItems) {
      try {
        const metadata = await extractMetadata(item.file);
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "ready", metadata } : f)),
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: "error", error: "Failed to analyze metadata" } : f,
          ),
        );
      }
    }
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) handleFiles(e.target.files);
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
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemoveFile = useCallback((id: string) => {
    setFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
    setZipBlob(null);
  }, []);

  const handleProcess = useCallback(async () => {
    const processable = files.filter((f) => f.status === "ready" || f.status === "error");
    if (processable.length === 0) return;

    setIsProcessing(true);
    setZipBlob(null);
    setError(null);
    setProgress({ current: 0, total: processable.length });
    setStatusMessage(
      `Stripping metadata from ${processable.length} image${processable.length === 1 ? "" : "s"}.`,
    );

    const results: Array<{ name: string; data: Uint8Array }> = [];

    for (const item of processable) {
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "processing", error: null } : f)),
      );

      try {
        const cleanedBlob = await stripMetadata(item.file);
        const data = new Uint8Array(await cleanedBlob.arrayBuffer());
        results.push({ name: item.file.name, data });

        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "done", cleanedBlob } : f)),
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: "error", error: "Failed to strip metadata" } : f,
          ),
        );
      }

      setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
    }

    for (const item of files) {
      if (item.cleanedBlob && !processable.find((p) => p.id === item.id)) {
        const data = new Uint8Array(await item.cleanedBlob.arrayBuffer());
        results.push({ name: item.file.name, data });
      }
    }

    if (results.length > 0) {
      try {
        setZipBlob(buildZip(results));
        setStatusMessage(
          `Done. ${results.length} clean image${results.length === 1 ? "" : "s"} ready to download.`,
        );
      } catch {
        setError("Failed to generate ZIP archive.");
        setStatusMessage("Failed to generate ZIP archive.");
      }
    } else {
      setStatusMessage("Processing finished with no successful files.");
    }

    setIsProcessing(false);
  }, [files]);

  const handleDownloadZip = useCallback(() => {
    if (zipBlob) downloadBlob(zipBlob, "cleaned-images.zip");
  }, [zipBlob]);

  const readyCount = files.filter((f) => f.status === "ready").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => handleProcess(),
          enabled: !isProcessing && readyCount > 0,
        },
        {
          key: "s",
          meta: true,
          handler: () => handleDownloadZip(),
          enabled: !!zipBlob,
        },
      ],
      [isProcessing, readyCount, handleProcess, zipBlob, handleDownloadZip],
    ),
  );

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <section className="space-y-6">
        {/* Upload zone */}
        <div
          className={cn(
            "group relative rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
            isDragging
              ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
              : "bg-paper shadow-pop-3 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)]",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-4">
            <span
              className="wb-svg-drop-icon grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper text-ink shadow-pop-2 group-hover:rotate-[-4deg]"
              data-dragging={isDragging}
              aria-hidden="true"
            >
              <CloudUpload className="size-6" strokeWidth={2.25} />
            </span>
            <div className="space-y-1">
              <h2 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                Drop your images here
              </h2>
              <p className="text-sm text-ink-2">
                JPG, PNG, or WebP, up to 50 MB. Stripped locally, never uploaded.
              </p>
            </div>
            <button
              type="button"
              className="wb-btn wb-btn--lemon wb-btn--sm mt-1"
              onClick={() => fileInputRef.current?.click()}
            >
              Select Files
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleFileInput}
            data-testid="file-input"
          />
        </div>

        <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
        <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

        {/* Processing Queue */}
        {files.length > 0 && (
          <section className="wb-fade-in wb-panel wb-panel--out">
            <PaneHeader
              label={`Processing Queue (${files.length})`}
              icon={<ListOrdered className="size-4" aria-hidden="true" />}
              className="bg-paper-2"
              actions={
                <span
                  key={`${doneCount}-${readyCount}`}
                  className="wb-fade-in font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums"
                >
                  {doneCount > 0
                    ? `${doneCount} cleaned · ${readyCount} ready`
                    : `${readyCount} ready`}
                </span>
              }
            />

            {isProcessing && (
              <div
                className="wb-fade-in h-1.5 w-full overflow-hidden border-b-2 border-ink bg-paper"
                aria-hidden="true"
                data-testid="progress-bar"
              >
                <div
                  className="h-full bg-tomato transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            <ul className="space-y-2 p-3 sm:p-4" aria-label="Queue items">
              {files.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "wb-item-enter flex items-center gap-3 rounded-md border-2 border-ink p-2.5 transition-[background,box-shadow,transform] duration-200",
                    item.status === "done"
                      ? "bg-mint shadow-pop-1"
                      : item.status === "error"
                        ? "bg-paper shadow-pop-1"
                        : "bg-paper shadow-pop-1",
                  )}
                >
                  {/* Thumbnail */}
                  <div className="relative size-11 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
                    <img
                      className={cn(
                        "h-full w-full object-cover",
                        item.status === "done" && "opacity-60 grayscale",
                      )}
                      src={item.previewUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    {(item.status === "analyzing" || item.status === "processing") && (
                      <span className="absolute inset-0 grid place-items-center bg-paper/70">
                        <Loader2
                          className="size-5 animate-spin text-ink"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    {item.status === "done" && (
                      <span className="wb-fade-in absolute inset-0 grid place-items-center bg-mint/80">
                        <span className="wb-svg-check-pop">
                          <Check className="size-5 text-grass" strokeWidth={3} aria-hidden="true" />
                        </span>
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="wb-fade-in absolute inset-0 grid place-items-center bg-tomato/25">
                        <X className="size-5 text-tomato" strokeWidth={3} aria-hidden="true" />
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-[13.5px] font-semibold",
                        item.status === "done" ? "text-ink-2" : "text-ink",
                      )}
                    >
                      {item.file.name}
                    </p>

                    {item.status === "analyzing" && (
                      <p className="wb-fade-in mt-0.5 font-mono text-[11px] uppercase tracking-wider text-ink-3">
                        Analyzing…
                      </p>
                    )}

                    {item.status === "ready" && item.metadata && (
                      <div className="wb-fade-in mt-1.5 flex flex-wrap items-center gap-1.5">
                        {item.metadata.hasGps && (
                          <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-tomato px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" />
                            GPS Data Detected
                          </span>
                        )}
                        {item.metadata.cameraModel && (
                          <span className="inline-flex items-center rounded-md border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-2">
                            {item.metadata.cameraModel}
                          </span>
                        )}
                        {item.metadata.exifVersion && (
                          <span className="inline-flex items-center rounded-md border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-2">
                            EXIF {item.metadata.exifVersion}
                          </span>
                        )}
                        {item.metadata.tagCount > 0 && (
                          <span className="inline-flex items-center rounded-md border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-2 tabular-nums">
                            Metadata: {item.metadata.tagCount} tags
                          </span>
                        )}
                        {item.metadata.tagCount === 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-mint px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-grass" />
                            No Metadata Found
                          </span>
                        )}
                      </div>
                    )}

                    {item.status === "processing" && (
                      <p className="wb-fade-in mt-0.5 font-mono text-[11px] uppercase tracking-wider text-ink-3">
                        Stripping metadata…
                      </p>
                    )}

                    {item.status === "done" && (
                      <p className="wb-fade-in mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-grass" />
                        Cleaned &amp; ready
                      </p>
                    )}

                    {item.status === "error" && (
                      <p className="wb-fade-in mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-tomato" />
                        {item.error ?? "Error"}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  {item.status === "done" ? (
                    <span
                      role="img"
                      aria-label="Cleaned"
                      title="Metadata stripped"
                      className="wb-fade-in grid size-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper text-grass shadow-pop-1"
                    >
                      <ShieldCheck className="size-4" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="grid size-11 shrink-0 place-items-center rounded-md text-ink-3 transition-[color,transform] duration-200 hover:-translate-y-px hover:text-tomato focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2 sm:size-9"
                      onClick={() => handleRemoveFile(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                      data-testid={`remove-${item.id}`}
                    >
                      <Trash2 className="size-4" strokeWidth={2.25} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Action row */}
        {files.length > 0 && (
          <div className="flex flex-col items-stretch gap-4 sm:items-center">
            <button
              type="button"
              className="wb-btn w-full justify-center py-4 text-[15px] sm:max-w-md"
              onClick={handleProcess}
              disabled={isProcessing || readyCount === 0}
            >
              <Wand2 className="size-5" aria-hidden="true" />
              <span>Remove Metadata &amp; Download ZIP</span>
              <KbdHint>⌘⏎</KbdHint>
            </button>

            {isProcessing && (
              <div className="wb-fade-in w-full max-w-md space-y-2">
                <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-ink-3 tabular-nums">
                  <span>Processing images…</span>
                  <span>{progressPercent}%</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full border-2 border-ink bg-paper"
                  aria-hidden="true"
                >
                  <div
                    className="h-full bg-tomato transition-[width] duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {zipBlob && (
              <div className="wb-fade-in flex w-full max-w-lg flex-wrap items-center gap-4 rounded-[18px] border-2 border-ink bg-mint p-4 shadow-pop-2">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper text-grass"
                  aria-hidden="true"
                >
                  <span className="wb-svg-check-pop">
                    <Download className="size-5" strokeWidth={2.5} />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">Processing Complete!</p>
                  <p className="text-xs text-ink-2">
                    {doneCount} image{doneCount !== 1 ? "s" : ""} stripped clean. Archive ready.
                  </p>
                </div>
                <button
                  type="button"
                  className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  onClick={handleDownloadZip}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  <span>Download ZIP</span>
                  <KbdHint>⌘S</KbdHint>
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </ToolShell>
  );
}
