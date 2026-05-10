import {
  Check,
  CloudUpload,
  Download,
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filesRef = useRef(files);
  filesRef.current = files;

  // Auto-dismiss warning after 8s
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  // Clean up preview URLs on unmount
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
        `Only ${available} of ${newItems.length} files added — queue limit is ${MAX_QUEUE_SIZE}.`,
      );
      newItems.splice(available);
    }

    setFiles((prev) => [...prev, ...newItems]);

    // Analyze metadata for each new file
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

    // Include any previously done files too
    for (const item of files) {
      if (item.cleanedBlob && !processable.find((p) => p.id === item.id)) {
        const data = new Uint8Array(await item.cleanedBlob.arrayBuffer());
        results.push({ name: item.file.name, data });
      }
    }

    if (results.length > 0) {
      try {
        setZipBlob(buildZip(results));
      } catch {
        setError("Failed to generate ZIP archive.");
      }
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
      <section className="space-y-8">
        {/* Upload Area */}
        <div
          className={`group rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${
            isDragging
              ? "border-primary bg-primary/10"
              : "border-border bg-card hover:border-primary"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 transition-transform group-hover:scale-110">
            <CloudUpload className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-2 text-xl font-bold">Drop your images here</h2>
          <p className="mb-6 text-muted-foreground">
            Support for JPG, PNG, WebP (Max 50MB per file)
          </p>
          <Button size="lg" onClick={() => fileInputRef.current?.click()}>
            Select Files
          </Button>
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

        {/* Error Banner */}
        <ErrorAlert error={error} className="mt-0" />

        {warning !== null && (
          <Alert className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        {/* Processing Queue */}
        {files.length > 0 && (
          <Card className="divide-y divide-border overflow-hidden">
            <div className="flex items-center justify-between bg-muted p-4">
              <h3 className="font-bold text-foreground">Processing Queue ({files.length})</h3>
            </div>

            {files.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 p-4 ${
                  item.status === "done" ? "bg-green-50/30 dark:bg-green-500/5" : ""
                }`}
              >
                {/* Thumbnail */}
                <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded">
                  <img
                    className={`h-full w-full object-cover ${
                      item.status === "done" ? "opacity-50 grayscale" : ""
                    }`}
                    src={item.previewUrl}
                    alt={item.file.name}
                  />
                  {item.status === "analyzing" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-card/60">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  {item.status === "processing" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-card/60">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  {item.status === "done" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-green-500/20">
                      <Check className="h-5 w-5 font-bold text-green-600" />
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                      <X className="h-5 w-5 font-bold text-red-600" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-semibold ${
                      item.status === "done" ? "text-muted-foreground" : ""
                    }`}
                  >
                    {item.file.name}
                  </p>

                  {item.status === "analyzing" && (
                    <p className="text-[10px] font-bold uppercase tracking-tighter text-primary">
                      Analyzing...
                    </p>
                  )}

                  {item.status === "ready" && item.metadata && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {item.metadata.hasGps && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500 dark:bg-red-500/10">
                          GPS Data Detected
                        </span>
                      )}
                      {item.metadata.cameraModel && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {item.metadata.cameraModel}
                        </span>
                      )}
                      {item.metadata.exifVersion && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          EXIF {item.metadata.exifVersion}
                        </span>
                      )}
                      {item.metadata.tagCount > 0 && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Metadata: {item.metadata.tagCount} tags
                        </span>
                      )}
                      {item.metadata.tagCount === 0 && (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:bg-green-500/10">
                          No Metadata Found
                        </span>
                      )}
                    </div>
                  )}

                  {item.status === "processing" && (
                    <p className="text-[10px] font-bold uppercase tracking-tighter text-primary">
                      Stripping metadata...
                    </p>
                  )}

                  {item.status === "done" && (
                    <p className="text-[10px] font-bold uppercase tracking-tighter text-green-600">
                      Cleaned &amp; Ready
                    </p>
                  )}

                  {item.status === "error" && (
                    <p className="text-[10px] font-bold uppercase tracking-tighter text-red-600">
                      {item.error ?? "Error"}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {item.status === "done" ? (
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(item.id);
                    }}
                    aria-label={`Remove ${item.file.name}`}
                    data-testid={`remove-${item.id}`}
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}

        {/* Actions */}
        {files.length > 0 && (
          <div className="flex flex-col items-center gap-6 border-t border-border py-6">
            <Button
              size="lg"
              className="w-full max-w-md py-4 text-lg font-bold shadow-xl shadow-primary/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
              onClick={handleProcess}
              disabled={isProcessing || readyCount === 0}
            >
              <Wand2 className="h-5 w-5" />
              Remove Metadata &amp; Download ZIP
              <KbdHint>⌘⏎</KbdHint>
            </Button>

            {/* Progress State */}
            {isProcessing && (
              <div className="w-full max-w-md space-y-2" data-testid="progress-bar">
                <div className="flex justify-between text-xs font-bold uppercase text-muted-foreground">
                  <span>Processing images...</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Success State Banner */}
            {zipBlob && (
              <div className="flex w-full max-w-lg items-center gap-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                  <Download className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-green-800 dark:text-green-300">
                    Processing Complete!
                  </p>
                  <p className="text-xs text-green-700/80 dark:text-green-400/80">
                    {doneCount} image{doneCount !== 1 ? "s" : ""} stripped of all metadata. Archive
                    ready.
                  </p>
                </div>
                <Button
                  className="bg-green-600 text-white hover:bg-green-700"
                  onClick={handleDownloadZip}
                >
                  Download ZIP
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </ToolShell>
  );
}
