import {
  CircleAlert,
  Download,
  FileText,
  Files,
  Hash,
  Loader2,
  Lock,
  Scissors,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";
import {
  MAX_OUTPUT_FILES,
  type PdfMeta,
  buildBaseName,
  buildZipName,
  downloadBlob,
  getPdfMeta,
  parsePageRanges,
  readFileBytes,
  splitByRanges,
  splitEveryN,
  splitPerPage,
  validatePdfFile,
  zipOutputs,
} from "./splitter";

type SplitMode = "ranges" | "every" | "perPage";

interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  meta: PdfMeta;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MODES: Array<{ id: SplitMode; label: string; icon: typeof Scissors }> = [
  { id: "ranges", label: "Custom ranges", icon: Scissors },
  { id: "every", label: "Every N pages", icon: Hash },
  { id: "perPage", label: "One per page", icon: Files },
];

export default function SplitPdfRoute() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [rangeSpec, setRangeSpec] = useState("");
  const [everyN, setEveryN] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageCount = pdf?.meta.pageCount ?? 0;
  const encrypted = pdf?.meta.encrypted ?? false;
  const baseName = useMemo(() => (pdf ? buildBaseName(pdf.file.name) : "document"), [pdf]);

  // Parse the range spec live against the page count (ranges mode only).
  const parseResult = useMemo(
    () => (pageCount > 0 ? parsePageRanges(rangeSpec, pageCount) : { ranges: [] }),
    [rangeSpec, pageCount],
  );

  // Computed output count per mode (without building any bytes).
  const outputCount = useMemo(() => {
    if (pageCount === 0) return 0;
    if (mode === "ranges") return parseResult.ranges.length;
    if (mode === "every") return everyN >= 1 ? Math.ceil(pageCount / everyN) : 0;
    return pageCount; // perPage
  }, [mode, pageCount, everyN, parseResult]);

  // Would the single output be the whole unchanged doc? Then there's nothing to split.
  const isWholeDoc = useMemo(() => {
    if (pageCount === 0 || outputCount !== 1) return false;
    if (mode === "ranges") {
      const r = parseResult.ranges[0];
      return !!r && r.start === 1 && r.end === pageCount;
    }
    if (mode === "every") return everyN >= pageCount;
    return pageCount === 1; // perPage on a 1-page doc
  }, [mode, pageCount, outputCount, everyN, parseResult]);

  const overCap = outputCount > MAX_OUTPUT_FILES;
  const rangeError = mode === "ranges" && rangeSpec.trim() !== "" ? parseResult.error : undefined;
  const everyInvalid = mode === "every" && (everyN < 1 || everyN > pageCount);

  const canSplit =
    status === "ready" &&
    !encrypted &&
    !isSplitting &&
    !isWholeDoc &&
    !overCap &&
    outputCount >= 1 &&
    !rangeError &&
    !everyInvalid;

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    setWarning(null);
    const validation = validatePdfFile(file);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid file.");
      return;
    }
    if (validation.warning) setWarning(validation.warning);

    setStatus("loading");
    setPdf(null);
    try {
      const bytes = await readFileBytes(file);
      const meta = await getPdfMeta(bytes);
      setPdf({ file, bytes, meta });
      setStatus("ready");
      setStatusMessage(`${file.name} ready, ${meta.pageCount} pages.`);
    } catch {
      setStatus("error");
      setError("Could not read this PDF. It may be corrupt.");
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (file) void loadFile(file);
    },
    [loadFile],
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
      if (isSplitting) return; // don't swap the file out from under an active split
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isSplitting],
  );

  const handleSplit = useCallback(async () => {
    if (!pdf || !canSplit) return;
    setIsSplitting(true);
    setError(null);
    setProgress({ done: 0, total: outputCount });
    setStatusMessage(`Splitting into ${outputCount} files.`);

    const onProgress = (done: number, total: number) => setProgress({ done, total });

    try {
      let outputs:
        | Awaited<ReturnType<typeof splitByRanges>>
        | Awaited<ReturnType<typeof splitEveryN>>;
      if (mode === "ranges") {
        outputs = await splitByRanges(pdf.bytes, parseResult.ranges, baseName, { onProgress });
      } else if (mode === "every") {
        outputs = await splitEveryN(pdf.bytes, everyN, baseName, { onProgress });
      } else {
        outputs = await splitPerPage(pdf.bytes, baseName, { onProgress });
      }

      if (outputs.length === 0) {
        setError("Nothing to split with the current settings.");
        return;
      }

      if (outputs.length === 1) {
        const only = outputs[0];
        if (!only) return;
        downloadBlob(
          new Blob([only.bytes as BlobPart], { type: "application/pdf" }),
          only.filename,
        );
        setStatusMessage(`Saved ${only.filename}.`);
        toast.success(`Split → ${only.filename}`);
      } else {
        const zipBytes = await zipOutputs(outputs);
        const zipName = buildZipName(baseName);
        downloadBlob(new Blob([zipBytes as BlobPart], { type: "application/zip" }), zipName);
        setStatusMessage(`Split into ${outputs.length} files → ${zipName}.`);
        toast.success(`Split into ${outputs.length} files → ${zipName}`);
      }
    } catch {
      setError("Split failed. The PDF may be corrupt or unreadable.");
    } finally {
      setIsSplitting(false);
    }
  }, [pdf, canSplit, mode, outputCount, parseResult, everyN, baseName]);

  useKeyboardShortcut(
    useMemo(
      () => [{ key: "Enter", meta: true, handler: () => handleSplit(), enabled: canSplit }],
      [canSplit, handleSplit],
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
        aria-label="Add a PDF: drop here, or click to browse"
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
              Drop a PDF here or click to browse
            </p>
            <p className="wb-fade-in text-sm text-ink-2">
              Splitting happens in your browser. Nothing is uploaded.
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
        accept="application/pdf,.pdf"
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

      <section className="wb-panel wb-panel--out" aria-labelledby="split-file-label">
        <PaneHeader
          label="File"
          labelId="split-file-label"
          icon={<FileText className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
        />
        <div className="space-y-3 p-3 sm:p-4">
          {status === "idle" && (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
              No PDF yet. Upload a file to get started.
            </p>
          )}
          {status === "loading" && (
            <p className="flex items-center justify-center gap-2 py-10 font-mono text-[12px] text-ink-3">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading…
            </p>
          )}
          {status === "ready" && pdf && (
            <div className="flex items-center gap-2 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink" title={pdf.file.name}>
                  {pdf.file.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone="neutral"
                    label={`${pageCount} ${pageCount === 1 ? "page" : "pages"}`}
                  />
                  {encrypted && (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="size-3.5 text-tomato" aria-hidden="true" />
                      <StatusBadge tone="invalid" label="Locked" />
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                    {formatBytes(pdf.file.size)}
                  </span>
                </div>
              </div>
            </div>
          )}
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-ink-3">
            Bookmarks, outlines, internal links, and digital signatures are not carried into the
            split files.
          </p>
        </div>
      </section>
    </div>
  );

  const right = (
    <section className="wb-panel flex flex-col lg:self-start" aria-labelledby="split-options-label">
      <PaneHeader
        label="Split options"
        labelId="split-options-label"
        icon={<Scissors className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        {/* Mode selector */}
        <div className="grid grid-cols-3 gap-2" aria-label="Split mode" data-testid="mode-selector">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={active}
                data-testid={`mode-${m.id}`}
                className={cn(
                  "wb-lift-hover flex flex-col items-center gap-1.5 rounded-md border-2 border-ink px-2 py-3 text-[12px] font-semibold shadow-pop-1 transition-[background,transform] duration-200",
                  active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="text-center leading-tight">{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mode options */}
        {mode === "ranges" && (
          <div className="space-y-2">
            <Label htmlFor="split-ranges" className="text-ink-2">
              Page ranges
            </Label>
            <Input
              id="split-ranges"
              value={rangeSpec}
              onChange={(e) => setRangeSpec(e.target.value)}
              placeholder="e.g. 1-3, 5, 8-10"
              disabled={status !== "ready"}
              className="h-11 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
              data-testid="range-input"
            />
            <p className="text-[12px] text-ink-3">
              Comma-separated. Each group becomes its own file. Open-ended like{" "}
              <span className="font-mono">8-</span> runs to the last page.
            </p>
          </div>
        )}

        {mode === "every" && (
          <div className="space-y-2">
            <Label htmlFor="split-every" className="text-ink-2">
              Pages per file
            </Label>
            <Input
              id="split-every"
              type="number"
              min={1}
              max={Math.max(pageCount, 1)}
              value={everyN}
              onChange={(e) => setEveryN(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              disabled={status !== "ready"}
              className="h-11 w-32 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
              data-testid="every-input"
            />
            <p className="text-[12px] text-ink-3">
              Splits into sequential chunks; the last file may be shorter.
            </p>
          </div>
        )}

        {mode === "perPage" && (
          <p className="text-[13px] text-ink-2">
            Every page becomes its own PDF file, named in order.
          </p>
        )}

        {/* Output preview */}
        {status === "ready" && (
          <div
            className="rounded-md border-2 border-ink bg-paper-2 px-4 py-3"
            data-testid="output-preview"
          >
            {overCap ? (
              <p className="flex items-start gap-2 text-[12.5px] font-semibold text-ink">
                <CircleAlert className="mt-px size-4 shrink-0 text-tomato" aria-hidden="true" />
                This would produce {outputCount} files — too many (max {MAX_OUTPUT_FILES}). Use a
                coarser page range or larger N.
              </p>
            ) : isWholeDoc ? (
              <p className="text-[12.5px] text-ink-2">
                Nothing to split — this would output the whole document unchanged.
              </p>
            ) : rangeError ? (
              <p className="flex items-start gap-2 text-[12.5px] font-semibold text-ink">
                <CircleAlert className="mt-px size-4 shrink-0 text-tomato" aria-hidden="true" />
                {rangeError}
              </p>
            ) : outputCount >= 1 ? (
              <p className="font-mono text-[13px] font-bold text-ink tabular-nums">
                → {outputCount} {outputCount === 1 ? "file" : "files"}
              </p>
            ) : (
              <p className="text-[12.5px] text-ink-3">Enter a page range to preview the output.</p>
            )}
          </div>
        )}

        {encrypted && (
          <WarningAlert
            warning="This PDF is password-protected. Splitting would produce blank pages — unlock it first."
            className="mt-0"
          />
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleSplit}
            disabled={!canSplit}
            className="wb-btn w-full justify-center py-4 text-[15px]"
            data-testid="split-button"
          >
            <IconSwap swapKey={isSplitting}>
              {isSplitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>
                    {progress.done > 0
                      ? `Splitting ${progress.done}/${progress.total}`
                      : "Splitting…"}
                  </span>
                </>
              ) : (
                <>
                  <Download className="size-4" aria-hidden="true" />
                  <span>Split &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {status !== "ready" && !isSplitting && (
            <p className="text-center text-[12.5px] text-ink-3">Upload a PDF to split it.</p>
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
