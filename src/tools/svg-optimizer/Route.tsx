import {
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  Eye,
  FileCode2,
  Loader2,
  RefreshCw,
  Settings2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell, WarningAlert } from "../../components/tool-layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
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
  formatFileSize,
  quickValidateSvgContent,
  validateSvgContent,
  validateSvgFile,
} from "./svg-optimizer";
import { svgPool } from "./svg-pool";

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

const OPTION_TOGGLES: Array<{
  key: keyof SvgOptimizerOptions;
  label: string;
}> = [
  { key: "removeComments", label: "Remove Comments" },
  { key: "removeMetadata", label: "Remove Metadata" },
  { key: "simplifyPaths", label: "Simplify Path Data" },
  { key: "removeUnusedIds", label: "Remove Unused IDs" },
  { key: "prefixIds", label: "Prefix IDs" },
  { key: "convertColorsToHex", label: "Convert Colors to Hex" },
];

export default function SvgOptimizerRoute() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [prefs, setPrefs] = useToolPreferences("svg-optimizer", DEFAULT_PREFS);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [isZipping, setIsZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const processingRef = useRef(false);

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

  const processPending = useCallback(() => {
    if (processingRef.current) return;
    const pendingFiles = filesRef.current.filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);
    setBatchTotal(pendingFiles.length);
    setProcessedCount(0);

    const pendingIds = new Set(pendingFiles.map((f) => f.id));
    setFiles((prev) =>
      prev.map((f) => (pendingIds.has(f.id) ? { ...f, status: "processing" } : f)),
    );

    const tasks = pendingFiles.map((file) =>
      svgPool
        .dispatch<string>("optimize-svg", {
          content: file.originalContent,
          options: optionsRef.current,
        })
        .promise.then(
          (result) => {
            const optimizedSize = new TextEncoder().encode(result).byteLength;
            const reduction = calculateReduction(file.originalSize, optimizedSize);
            setFiles((prev) =>
              prev.map((f) =>
                f.id === file.id
                  ? { ...f, status: "done", optimizedContent: result, optimizedSize, error: null }
                  : f,
              ),
            );
            setAnnouncement(`${file.name}: optimized, ${reduction}% smaller`);
          },
          (err) => {
            const message = err instanceof Error ? err.message : "Optimization failed";
            setFiles((prev) =>
              prev.map((f) => (f.id === file.id ? { ...f, status: "error", error: message } : f)),
            );
            setAnnouncement(`${file.name}: failed — ${message}`);
          },
        )
        .finally(() => {
          setProcessedCount((c) => c + 1);
        }),
    );

    Promise.allSettled(tasks).then(() => {
      processingRef.current = false;
      setIsProcessing(false);
      if (filesRef.current.some((f) => f.status === "pending")) {
        processPending();
      }
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: kick processor on any files mutation; reads via refs
  useEffect(() => {
    processPending();
  }, [files, processPending]);

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
          const contentValidation = quickValidateSvgContent(content);
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
          const contentValidation = quickValidateSvgContent(content);
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
      const buffer = await svgPool.dispatch<ArrayBuffer>("zip-svgs", {
        files: completedFiles.map((f) => ({
          name: f.name,
          content: f.optimizedContent as string,
        })),
      }).promise;
      const blob = new Blob([buffer], { type: "application/zip" });
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

  const completedFiles = useMemo(() => files.filter((f) => f.status === "done"), [files]);
  const allDownloaded = completedFiles.length > 0 && completedFiles.every((f) => f.downloaded);
  const previewFile = previewFileId ? files.find((f) => f.id === previewFileId) : null;

  const previewUrl = useMemo(() => {
    if (!previewFile?.optimizedContent) return null;
    return URL.createObjectURL(createSvgBlob(previewFile.optimizedContent));
  }, [previewFile?.optimizedContent]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!isProcessing) return;
    const sync = () => {
      document.body.dataset.docHidden = document.hidden ? "true" : "false";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete document.body.dataset.docHidden;
    };
  }, [isProcessing]);

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
      <div className="flex flex-col gap-8">
        <output aria-live="polite" className="sr-only">
          {announcement}
        </output>
        {/* Drop Zone */}
        <div className="flex flex-col">
          <section
            aria-label="SVG drop zone"
            className={`flex flex-col items-center gap-6 rounded-lg border-2 border-ink px-6 py-10 shadow-pop-3 transition-colors sm:py-14 ${
              isDragging ? "bg-mint" : "bg-paper-2"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-dragging={isDragging}
          >
            <div className="flex flex-col items-center gap-4">
              <div
                className="wb-svg-drop-icon grid size-16 place-items-center rounded-[14px] border-2 border-ink bg-pink shadow-pop-2"
                data-dragging={isDragging}
              >
                <Upload className="size-7 text-ink" strokeWidth={2.25} />
              </div>
              <div className="text-center">
                <h2 className="font-display text-[24px] font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">
                  Drop SVGs to optimize
                </h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                  Or browse to select. Minified instantly.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                className="wb-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" strokeWidth={2.25} />
                <span>Select Files</span>
              </button>
              <button
                type="button"
                className="wb-btn wb-btn--ghost"
                onClick={() => setShowPasteArea((prev) => !prev)}
                aria-expanded={showPasteArea}
                aria-controls="svg-paste-area"
              >
                <span>Paste Code</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".svg,image/svg+xml"
              onChange={handleFileInput}
              aria-label="Upload SVG files"
              data-testid="file-input"
            />
          </section>

          {/* Paste Area */}
          {showPasteArea && (
            <div id="svg-paste-area" className="wb-fade-in mt-4 flex flex-col gap-3">
              <Textarea
                aria-label="SVG markup"
                className="h-44 w-full resize-none rounded-md border-2 border-ink bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink shadow-pop-1 placeholder:text-ink-3 focus-visible:ring-tomato focus-visible:ring-offset-paper"
                placeholder="Paste your SVG markup here…"
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                data-testid="paste-textarea"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="wb-btn"
                  onClick={handlePasteSubmit}
                  disabled={!pasteContent.trim()}
                >
                  Process
                </button>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Markup never leaves your browser.
                </span>
              </div>
            </div>
          )}

          <ErrorAlert error={error} onDismiss={() => setError(null)} />
          <WarningAlert warning={warning} onDismiss={() => setWarning(null)} />
        </div>

        {/* File Queue */}
        {files.length > 0 && (
          <section className="overflow-hidden rounded-lg border-2 border-ink bg-paper shadow-pop-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-paper-2 px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-[20px] font-extrabold leading-none tracking-tight text-ink">
                  Optimization Queue
                </h2>
                <span className="rounded-full border-2 border-ink bg-paper px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink">
                  {isProcessing
                    ? `Working ${processedCount}/${batchTotal}`
                    : `${files.length} ${files.length === 1 ? "file" : "files"}`}
                </span>
              </div>
              {completedFiles.length > 0 &&
                (allDownloaded ? (
                  <button
                    type="button"
                    className="wb-btn wb-btn--lemon"
                    disabled
                    aria-label="All files already downloaded"
                  >
                    <Check
                      aria-hidden="true"
                      className="wb-svg-check-pop size-4"
                      strokeWidth={2.5}
                    />
                    <span>Downloaded</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wb-btn"
                    onClick={handleDownloadAll}
                    disabled={isZipping}
                  >
                    {isZipping ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" strokeWidth={2.25} />
                    )}
                    <span>{isZipping ? "Creating ZIP…" : "Download All"}</span>
                    {!isZipping && <KbdHint>⌘S</KbdHint>}
                  </button>
                ))}
            </div>

            <ul className="px-5">
              {files.map((file) => {
                const thumbBg =
                  file.status === "done"
                    ? "bg-mint"
                    : file.status === "error"
                      ? "bg-pink"
                      : "bg-paper-2";
                return (
                  <li
                    key={file.id}
                    className={`wb-item-enter flex flex-wrap items-center justify-between gap-4 py-4 ${
                      file.status === "processing" ? "opacity-80" : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div
                        aria-hidden="true"
                        className={`grid size-11 shrink-0 place-items-center rounded-md border-2 border-ink shadow-pop-1 transition-colors ${thumbBg}`}
                      >
                        {file.status === "processing" ? (
                          <Loader2 className="size-5 animate-spin text-ink" />
                        ) : file.status === "error" ? (
                          <CircleAlert className="size-5 text-ink" strokeWidth={2.5} />
                        ) : (
                          <FileCode2 className="size-5 text-ink" strokeWidth={2} />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[14px] font-semibold text-ink">
                          {file.name}
                        </span>
                        {file.status === "done" && file.optimizedSize !== null && (
                          <span className="wb-svg-done-meta flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                            <span className="text-ink-2 line-through">
                              {formatFileSize(file.originalSize)}
                            </span>
                            <ArrowRight
                              aria-hidden="true"
                              className="size-3 text-ink-2"
                              strokeWidth={2.5}
                            />
                            <span className="font-semibold text-ink">
                              {formatFileSize(file.optimizedSize)}
                            </span>
                            <span className="wb-svg-badge rounded-md border-2 border-ink bg-mint px-1.5 py-px text-[10.5px] font-bold text-ink">
                              -{calculateReduction(file.originalSize, file.optimizedSize)}%
                            </span>
                          </span>
                        )}
                        {file.status === "processing" && (
                          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
                            Optimizing…
                          </span>
                        )}
                        {file.status === "pending" && (
                          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
                            Pending · {formatFileSize(file.originalSize)}
                          </span>
                        )}
                        {file.status === "error" && (
                          <span className="text-[12px] font-medium text-ink">{file.error}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {file.status === "done" && (
                        <>
                          <button
                            type="button"
                            className="grid size-11 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-transform hover:-translate-y-0.5"
                            onClick={() => setPreviewFileId(file.id)}
                            aria-label={`Preview ${file.name}`}
                          >
                            <Eye className="size-5" strokeWidth={2} />
                          </button>
                          {file.downloaded ? (
                            <button
                              type="button"
                              disabled
                              aria-label={`${file.name} already downloaded`}
                              className="inline-flex items-center gap-1.5 rounded-md border-2 border-ink bg-mint px-3 py-2 text-[12px] font-bold text-ink shadow-pop-1 disabled:opacity-100"
                            >
                              <Check
                                aria-hidden="true"
                                className="wb-svg-check-pop size-4"
                                strokeWidth={2.5}
                              />
                              Downloaded
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                              onClick={() => handleDownloadFile(file)}
                            >
                              <Download className="size-4" strokeWidth={2.25} />
                              <span>Download</span>
                            </button>
                          )}
                        </>
                      )}
                      {file.status === "error" && (
                        <button
                          type="button"
                          className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                          onClick={() => handleRetry(file.id)}
                        >
                          <RefreshCw className="size-4" strokeWidth={2.25} />
                          <span>Retry</span>
                        </button>
                      )}
                      {file.status === "processing" && (
                        <div
                          className="wb-svg-shimmer h-1.5 w-24 rounded-full border-2 border-ink"
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        className="grid size-11 place-items-center rounded-md border-2 border-ink bg-paper text-ink-3 shadow-pop-1 transition-[transform,color] hover:-translate-y-0.5 hover:text-tomato"
                        onClick={() => handleRemoveFile(file.id)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="size-5" strokeWidth={2.25} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Options & Presets */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <section
            aria-label="Optimization options"
            className="rounded-lg border-2 border-ink bg-paper p-5 shadow-pop-3"
          >
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              <Settings2 aria-hidden="true" className="size-4 text-ink" strokeWidth={2.25} />
              Options
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {OPTION_TOGGLES.map(({ key, label }) => (
                <label
                  key={key}
                  htmlFor={`opt-${key}`}
                  className="flex cursor-pointer items-center justify-between gap-3 text-[13.5px] font-medium text-ink"
                >
                  <span>{label}</span>
                  <Switch
                    id={`opt-${key}`}
                    checked={prefs[key]}
                    onCheckedChange={(v) => handleOptionChange(key, v)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section
            aria-label="Optimization presets"
            className="rounded-lg border-2 border-ink bg-paper-2 p-5 shadow-pop-3"
          >
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
              <Wand2 aria-hidden="true" className="size-4 text-ink" strokeWidth={2.25} />
              Presets
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABELS) as PresetName[]).map((preset) => {
                const active = prefs.activePreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    data-active={active}
                    className={`wb-chip min-h-11 font-mono text-[11px] tracking-[0.1em] sm:min-h-0 ${active ? "on" : ""}`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-2">
              Presets overwrite the toggles above.
            </p>
          </section>
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
          <DialogHeader className="border-b-2 border-ink bg-paper-2 px-6 py-4">
            <DialogTitle className="font-display text-[18px] font-extrabold leading-none tracking-tight text-ink">
              {previewFile?.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Optimized SVG preview with size comparison
            </DialogDescription>
            {previewFile?.optimizedSize !== null && previewFile?.optimizedSize !== undefined && (
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                <span className="text-ink-2 line-through">
                  {formatFileSize(previewFile.originalSize)}
                </span>
                <ArrowRight aria-hidden="true" className="size-3 text-ink-2" strokeWidth={2.5} />
                <span className="font-semibold text-ink">
                  {formatFileSize(previewFile.optimizedSize)}
                </span>
                <span className="rounded-md border-2 border-ink bg-mint px-1.5 py-px text-[10.5px] font-bold text-ink">
                  -{calculateReduction(previewFile.originalSize, previewFile.optimizedSize)}%
                </span>
                <KbdHint>Esc to close</KbdHint>
              </div>
            )}
          </DialogHeader>
          <div className="flex items-center justify-center overflow-auto bg-paper p-8">
            {previewUrl && previewFile && (
              <img
                src={previewUrl}
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
