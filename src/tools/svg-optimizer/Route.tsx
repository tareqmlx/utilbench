import {
  ArrowRight,
  Check,
  CheckCircle,
  CircleAlert,
  Download,
  Eye,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { MAX_QUEUE_SIZE } from "../constants";
import type { PresetName, QueuedFile, SvgOptimizerOptions } from "./svg-optimizer";
import {
  DEFAULT_OPTIONS,
  PRESET_CONFIGS,
  calculateReduction,
  createSvgBlob,
  createZipBlob,
  formatFileSize,
  optimizeSvg,
  validateSvgContent,
  validateSvgFile,
} from "./svg-optimizer";

const DEFAULT_PREFS = {
  ...DEFAULT_OPTIONS,
  activePreset: null as PresetName | null,
};

const PRESET_LABELS: Record<PresetName, string> = {
  "ui-icons": "UI ICONS",
  mobile: "MOBILE",
  print: "PRINT",
  legacy: "LEGACY",
};

export default function SvgOptimizerRoute() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [prefs, setPrefs] = useToolPreferences("svg-optimizer", DEFAULT_PREFS);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [isZipping, setIsZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  const currentOptions: SvgOptimizerOptions = {
    removeComments: prefs.removeComments,
    removeMetadata: prefs.removeMetadata,
    simplifyPaths: prefs.simplifyPaths,
    removeUnusedIds: prefs.removeUnusedIds,
    prefixIds: prefs.prefixIds,
    convertColorsToHex: prefs.convertColorsToHex,
  };
  const optionsRef = useRef(currentOptions);
  optionsRef.current = currentOptions;

  // Auto-clear error after 5s
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  // Auto-dismiss warning after 8s
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  // Process pending files
  useEffect(() => {
    const pendingFiles = files.filter((f) => f.status === "pending");
    if (pendingFiles.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setProcessedCount(0);

    const processBatch = async () => {
      let completed = 0;
      for (const file of pendingFiles) {
        // Mark processing
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, status: "processing" } : f)),
        );

        // Yield for UI update
        await new Promise((r) => setTimeout(r, 0));

        try {
          const result = optimizeSvg(file.originalContent, optionsRef.current);
          const optimizedSize = new TextEncoder().encode(result).byteLength;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === file.id
                ? { ...f, status: "done", optimizedContent: result, optimizedSize, error: null }
                : f,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Optimization failed";
          setFiles((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, status: "error", error: message } : f)),
          );
        }
        completed++;
        setProcessedCount(completed);
      }
      setIsProcessing(false);
    };

    processBatch();
  }, [files, isProcessing]);

  const addFilesToQueue = useCallback((svgFiles: Array<{ name: string; content: string }>) => {
    const currentCount = filesRef.current.length;
    const available = MAX_QUEUE_SIZE - currentCount;
    if (available <= 0) {
      setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files). Remove some files first.`);
      return;
    }
    const toAdd = available < svgFiles.length ? svgFiles.slice(0, available) : svgFiles;
    if (toAdd.length < svgFiles.length) {
      setWarning(
        `Only ${toAdd.length} of ${svgFiles.length} files added. Queue limit is ${MAX_QUEUE_SIZE}.`,
      );
    }
    const newFiles: QueuedFile[] = toAdd.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      originalContent: f.content,
      originalSize: new TextEncoder().encode(f.content).byteLength,
      optimizedContent: null,
      optimizedSize: null,
      status: "pending",
      error: null,
      downloaded: false,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputFiles = e.target.files;
      if (!inputFiles) return;
      setError(null);

      setWarning(null);
      const readers: Array<{ name: string; content: string }> = [];
      let pending = inputFiles.length;

      for (const file of Array.from(inputFiles)) {
        const validation = validateSvgFile(file);
        if (!validation.valid) {
          setError(validation.error ?? "Invalid file");
          pending--;
          if (pending === 0 && readers.length > 0) addFilesToQueue(readers);
          continue;
        }
        if (validation.warning) {
          setWarning(validation.warning);
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          const contentValidation = validateSvgContent(content);
          if (!contentValidation.valid) {
            setError(contentValidation.error ?? "Invalid SVG content");
          } else {
            readers.push({ name: file.name, content });
          }
          pending--;
          if (pending === 0 && readers.length > 0) addFilesToQueue(readers);
        };
        reader.readAsText(file);
      }

      // Reset input so same files can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFilesToQueue],
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
      setError(null);
      setWarning(null);

      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles.length) return;

      const readers: Array<{ name: string; content: string }> = [];
      let pending = droppedFiles.length;

      for (const file of Array.from(droppedFiles)) {
        const validation = validateSvgFile(file);
        if (!validation.valid) {
          setError(validation.error ?? "Invalid file");
          pending--;
          if (pending === 0 && readers.length > 0) addFilesToQueue(readers);
          continue;
        }
        if (validation.warning) {
          setWarning(validation.warning);
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          const contentValidation = validateSvgContent(content);
          if (!contentValidation.valid) {
            setError(contentValidation.error ?? "Invalid SVG content");
          } else {
            readers.push({ name: file.name, content });
          }
          pending--;
          if (pending === 0 && readers.length > 0) addFilesToQueue(readers);
        };
        reader.readAsText(file);
      }
    },
    [addFilesToQueue],
  );

  const handlePasteSubmit = useCallback(() => {
    setError(null);
    const validation = validateSvgContent(pasteContent);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid SVG content");
      return;
    }
    addFilesToQueue([{ name: "pasted-svg.svg", content: pasteContent.trim() }]);
    setPasteContent("");
    setShowPasteArea(false);
  }, [pasteContent, addFilesToQueue]);

  const handleOptionChange = useCallback(
    (key: keyof SvgOptimizerOptions, value: boolean) => {
      setPrefs({ [key]: value, activePreset: null });
    },
    [setPrefs],
  );

  const handlePresetClick = useCallback(
    (preset: PresetName) => {
      setPrefs({ ...PRESET_CONFIGS[preset], activePreset: preset });
    },
    [setPrefs],
  );

  const handleRetry = useCallback((fileId: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? { ...f, status: "pending", error: null, optimizedContent: null, optimizedSize: null }
          : f,
      ),
    );
  }, []);

  const handleRemoveFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const handleDownloadFile = useCallback((file: QueuedFile) => {
    if (!file.optimizedContent) return;
    const blob = createSvgBlob(file.optimizedContent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, downloaded: true } : f)));
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const completedFiles = filesRef.current.filter(
      (f) => f.status === "done" && f.optimizedContent,
    );
    if (completedFiles.length === 0) return;

    setIsZipping(true);
    try {
      const blob = createZipBlob(
        completedFiles.map((f) => ({ name: f.name, content: f.optimizedContent as string })),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "optimized-svgs.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFiles((prev) => prev.map((f) => (f.status === "done" ? { ...f, downloaded: true } : f)));
    } catch {
      setError("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  }, []);

  const completedFiles = files.filter((f) => f.status === "done");
  const allDownloaded = completedFiles.length > 0 && completedFiles.every((f) => f.downloaded);
  const previewFile = previewFileId ? files.find((f) => f.id === previewFileId) : null;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "s",
          meta: true,
          handler: () => handleDownloadAll(),
          enabled: completedFiles.length > 0,
        },
      ],
      [completedFiles.length, handleDownloadAll],
    ),
  );

  return (
    <ToolShell>
      <div className="flex flex-col gap-6">
        {/* Drop Zone */}
        <div className="flex flex-col">
          <div
            className={`group flex flex-col items-center gap-6 rounded-[6px] border-2 border-dashed px-6 py-6 transition-colors sm:py-12 ${
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <Upload className="h-8 w-8" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold leading-tight tracking-tight text-foreground">
                  Drop multiple SVGs here
                </p>
                <p className="mt-1 text-sm font-normal leading-normal text-muted-foreground">
                  Files will be queued for automatic optimization
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => fileInputRef.current?.click()}>
                <span className="truncate">Select Files</span>
              </Button>
              <Button variant="secondary" onClick={() => setShowPasteArea((prev) => !prev)}>
                <span className="truncate">Paste Code</span>
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".svg,image/svg+xml"
              onChange={handleFileInput}
              data-testid="file-input"
            />
          </div>

          {/* Paste Area */}
          {showPasteArea && (
            <div className="mt-4 flex flex-col gap-3">
              <Textarea
                className="h-40 w-full font-mono text-sm"
                placeholder="Paste your SVG code here..."
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                data-testid="paste-textarea"
              />
              <Button className="w-fit" onClick={handlePasteSubmit} disabled={!pasteContent.trim()}>
                Process
              </Button>
            </div>
          )}

          {/* Error Banner */}
          <ErrorAlert error={error} />

          {warning !== null && (
            <output className="block mt-4 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-lemon px-4 py-3 shadow-pop-2">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={2.5} />
              <p className="font-mono text-[13px] leading-relaxed text-ink">{warning}</p>
            </output>
          )}
        </div>

        {/* File Queue */}
        {files.length > 0 && (
          <Card className="p-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">Optimization Queue</h2>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                  {files.length} {files.length === 1 ? "File" : "Files"}
                </span>
              </div>
              {completedFiles.length > 0 && (
                <Button
                  variant={allDownloaded ? "outline" : "default"}
                  className={allDownloaded ? "border-ink bg-mint text-ink" : ""}
                  onClick={handleDownloadAll}
                  disabled={isZipping || allDownloaded}
                >
                  {allDownloaded ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : isZipping ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>
                    {allDownloaded ? "Downloaded" : isZipping ? "Creating ZIP..." : "Download All"}
                  </span>
                  {!allDownloaded && !isZipping && <KbdHint>⌘S</KbdHint>}
                </Button>
              )}
            </div>

            <div className="flex flex-col divide-y divide-border">
              {files.map((file) => (
                <div
                  key={file.id}
                  className={`group flex items-center justify-between py-4 ${
                    file.status === "processing" ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex size-10 items-center justify-center overflow-hidden rounded-[6px] border border-border bg-muted">
                      {file.status === "processing" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : file.status === "error" ? (
                        <CircleAlert className="h-5 w-5 text-tomato" />
                      ) : (
                        <div className="h-6 w-6 rounded-[2px] bg-primary/20" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-foreground">{file.name}</span>
                      {file.status === "done" && file.optimizedSize !== null && (
                        <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider">
                          <span className="text-muted-foreground line-through">
                            {formatFileSize(file.originalSize)}
                          </span>
                          <span className="font-bold text-grass">
                            {formatFileSize(file.optimizedSize)}
                          </span>
                          <span className="rounded-[6px] border border-ink bg-mint px-1.5 text-ink">
                            -{calculateReduction(file.originalSize, file.optimizedSize)}%
                          </span>
                        </div>
                      )}
                      {file.status === "processing" && (
                        <span className="text-[11px] font-medium uppercase italic tracking-wider text-muted-foreground">
                          Processing {processedCount + 1} of{" "}
                          {processedCount + files.filter((f) => f.status === "pending").length + 1}{" "}
                          files...
                        </span>
                      )}
                      {file.status === "pending" && (
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Pending ({formatFileSize(file.originalSize)})
                        </span>
                      )}
                      {file.status === "error" && (
                        <span className="text-[11px] font-medium text-tomato">{file.error}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === "done" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPreviewFileId(file.id)}
                          aria-label={`Preview ${file.name}`}
                        >
                          <Eye className="h-5 w-5" />
                        </Button>
                        {file.downloaded ? (
                          <span className="flex items-center gap-2 rounded-[6px] border-2 border-ink bg-mint px-3 py-1.5 text-xs font-bold text-ink">
                            <Check className="h-4 w-4" />
                            Downloaded
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            className="text-xs font-bold text-primary hover:bg-primary/10"
                            onClick={() => handleDownloadFile(file)}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </Button>
                        )}
                      </>
                    )}
                    {file.status === "error" && (
                      <Button
                        variant="ghost"
                        className="text-xs font-bold text-primary hover:bg-primary/10"
                        onClick={() => handleRetry(file.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                      </Button>
                    )}
                    {file.status === "processing" && (
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-tomato"
                      onClick={() => handleRemoveFile(file.id)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Options & Presets */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <Settings2 className="h-5 w-5 text-primary" />
                Cleanup Options
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-removeComments"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Remove Comments
                  </Label>
                  <Switch
                    id="opt-removeComments"
                    checked={prefs.removeComments}
                    onCheckedChange={(v) => handleOptionChange("removeComments", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-removeMetadata"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Remove Metadata
                  </Label>
                  <Switch
                    id="opt-removeMetadata"
                    checked={prefs.removeMetadata}
                    onCheckedChange={(v) => handleOptionChange("removeMetadata", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-simplifyPaths"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Simplify Path Data
                  </Label>
                  <Switch
                    id="opt-simplifyPaths"
                    checked={prefs.simplifyPaths}
                    onCheckedChange={(v) => handleOptionChange("simplifyPaths", v)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <KeyRound className="h-5 w-5 text-primary" />
                Attributes
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-removeUnusedIds"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Remove Unused IDs
                  </Label>
                  <Switch
                    id="opt-removeUnusedIds"
                    checked={prefs.removeUnusedIds}
                    onCheckedChange={(v) => handleOptionChange("removeUnusedIds", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-prefixIds"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Prefix IDs
                  </Label>
                  <Switch
                    id="opt-prefixIds"
                    checked={prefs.prefixIds}
                    onCheckedChange={(v) => handleOptionChange("prefixIds", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="opt-convertColorsToHex"
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Convert Colors to Hex
                  </Label>
                  <Switch
                    id="opt-convertColorsToHex"
                    checked={prefs.convertColorsToHex}
                    onCheckedChange={(v) => handleOptionChange("convertColorsToHex", v)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <Wand2 className="h-5 w-5 text-primary" />
                Presets
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(PRESET_LABELS) as PresetName[]).map((preset) => (
                  <Button
                    key={preset}
                    variant={prefs.activePreset === preset ? "default" : "secondary"}
                    size="sm"
                    className={`text-[10px] font-bold ${
                      prefs.activePreset === preset
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : ""
                    }`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    {PRESET_LABELS[preset]}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preview Modal */}
      <Dialog
        open={!!previewFile?.optimizedContent}
        onOpenChange={(open) => {
          if (!open) setPreviewFileId(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="text-sm font-bold">{previewFile?.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Optimized SVG preview with size comparison
            </DialogDescription>
            {previewFile?.optimizedSize !== null && previewFile?.optimizedSize !== undefined && (
              <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider">
                <span className="text-muted-foreground">
                  {formatFileSize(previewFile.originalSize)}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-bold text-grass">
                  {formatFileSize(previewFile.optimizedSize)}
                </span>
                <span className="rounded-[6px] border border-ink bg-mint px-1.5 text-ink">
                  -{calculateReduction(previewFile.originalSize, previewFile.optimizedSize)}%
                </span>
              </div>
            )}
          </DialogHeader>
          <div className="flex items-center justify-center overflow-auto p-8">
            {previewFile?.optimizedContent && (
              <img
                src={URL.createObjectURL(createSvgBlob(previewFile.optimizedContent))}
                alt={`Preview of ${previewFile.name}`}
                className="max-h-[50vh] max-w-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ToolShell>
  );
}
