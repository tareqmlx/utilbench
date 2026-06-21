import { Download, FileText, Loader2, Lock, Settings2, Upload } from "lucide-react";
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
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";
import {
  DEFAULT_DPI,
  DEFAULT_JPEG_QUALITY,
  DPI_PRESETS,
  type ImageFormat,
  type PageSize,
  type RenderOptions,
  buildBaseName,
  computeOutputDims,
  downloadBlob,
  maxOutputPages,
  probePdf,
  readFileBytes,
  renderPdfToImages,
  resolvePageList,
  validatePdfFile,
  zipImages,
} from "./renderer";

interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  encrypted: boolean;
  pageSizes: PageSize[];
  dimsKnown: boolean; // false ⇒ probe couldn't read sizes (encrypted); revealed at render
}

type PasswordKind = "need" | "incorrect";

interface PendingPassword {
  resolve: (password: string) => void;
  reject: (reason: Error) => void;
}

const FORMATS: Array<{ id: ImageFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PdfToImageRoute() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dpi, setDpi] = useState<number>(DEFAULT_DPI);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [jpegQuality, setJpegQuality] = useState<number>(DEFAULT_JPEG_QUALITY);
  const [pageRange, setPageRange] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  // Password modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [pwKind, setPwKind] = useState<PasswordKind>("need");
  const [pwValue, setPwValue] = useState("");
  const pendingPw = useRef<PendingPassword | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pageCount = pdf?.pageCount ?? 0;
  const encrypted = pdf?.encrypted ?? false;
  const dimsKnown = pdf?.dimsKnown ?? false;

  // Live output px readout for page 1 (computeOutputDims is the single source).
  const firstPageDims = useMemo(() => {
    const first = pdf?.pageSizes[0];
    if (!first) return null;
    return computeOutputDims(first.width, first.height, dpi);
  }, [pdf, dpi]);

  // Clamp warning: scan ALL page sizes; chip if the chosen DPI clamps the largest page.
  const anyClamped = useMemo(() => {
    if (!pdf) return false;
    return pdf.pageSizes.some((p) => computeOutputDims(p.width, p.height, dpi).clamped);
  }, [pdf, dpi]);

  // Validate the page range only when non-empty (empty ⇒ all pages).
  const rangeError = useMemo(() => {
    if (pageCount === 0 || pageRange.trim() === "") return undefined;
    try {
      resolvePageList(pageRange, pageCount);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid page range.";
    }
  }, [pageRange, pageCount]);

  // Resolved output page count (empty ⇒ all pages).
  const resolvedCount = useMemo(() => {
    if (pageCount === 0) return 0;
    if (pageRange.trim() === "") return pageCount;
    try {
      return resolvePageList(pageRange, pageCount).length;
    } catch {
      return 0;
    }
  }, [pageRange, pageCount]);

  // DPI-aware cap — list dpi in deps so raising DPI re-checks the cap.
  const overCap = useMemo(() => resolvedCount > maxOutputPages(dpi), [resolvedCount, dpi]);

  const canConvert =
    status === "ready" &&
    !isConverting &&
    !rangeError &&
    !overCap &&
    // Unknown dims (encrypted): page count is revealed after unlock, so allow Convert
    // and let pdf.js drive the password prompt + render (§5.6).
    (dimsKnown ? pageCount > 0 && resolvedCount >= 1 : true);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    setWarning(null);
    const validation = validatePdfFile(file);
    if (!validation.valid) {
      setStatus("error");
      setError(validation.error ?? "Invalid file.");
      return;
    }
    if (validation.warning) setWarning(validation.warning);

    setStatus("loading");
    setPdf(null);
    try {
      const bytes = await readFileBytes(file);
      const probe = await probePdf(bytes);
      setPdf({
        file,
        bytes,
        pageCount: probe.pageCount,
        encrypted: probe.encrypted,
        pageSizes: probe.pageSizes,
        dimsKnown: probe.dimsKnown,
      });
      setStatus("ready");
      setStatusMessage(
        probe.dimsKnown
          ? `${file.name} ready, ${probe.pageCount} ${probe.pageCount === 1 ? "page" : "pages"}.`
          : `${file.name} ready. Password-protected — you'll be asked to unlock it when you convert.`,
      );
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
      // Match handleDrop's guard: don't swap the file out from under an active render.
      if (!isConverting && files && files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles, isConverting],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Ignore leave events fired while the pointer crosses between child
    // elements still inside the dropzone — otherwise the lemon drag state
    // flickers as the cursor passes over the icon plate and labels.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isConverting) return; // don't swap the file out from under an active render
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isConverting],
  );

  // Password prompt: opens the modal and resolves with the typed password.
  const onPassword = useCallback((kind: PasswordKind): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      pendingPw.current = { resolve, reject };
      setPwKind(kind);
      setPwValue("");
      setPwOpen(true);
    });
  }, []);

  const submitPassword = useCallback(() => {
    const pending = pendingPw.current;
    pendingPw.current = null;
    setPwOpen(false);
    pending?.resolve(pwValue);
  }, [pwValue]);

  const cancelPassword = useCallback(() => {
    const pending = pendingPw.current;
    pendingPw.current = null;
    setPwOpen(false);
    pending?.reject(new Error("Password entry cancelled."));
  }, []);

  const handleConvert = useCallback(async () => {
    if (!pdf || !canConvert) return;
    setError(null);
    setWarning(null);
    setIsConverting(true);
    setProgress({ done: 0, total: dimsKnown ? resolvedCount : 0 });
    setStatusMessage(
      dimsKnown
        ? `Rendering ${resolvedCount} ${resolvedCount === 1 ? "image" : "images"}.`
        : "Unlocking and rendering…",
    );

    const ac = new AbortController();
    abortRef.current = ac;

    const opts: RenderOptions = { dpi, format, jpegQuality, pageRange };

    try {
      const { pages, failures } = await renderPdfToImages(pdf.bytes, pdf.file.name, opts, {
        onProgress: (done, total) => setProgress({ done, total }),
        onPassword,
        signal: ac.signal,
      });

      if (pages.length === 0) {
        setError("No pages could be rendered.");
        return;
      }

      if (pages.length === 1) {
        const only = pages[0];
        if (!only) return;
        downloadBlob(only.blob, only.filename);
        setStatusMessage(`Saved ${only.filename}.`);
      } else {
        const zipName = `${buildBaseName(pdf.file.name)}-images.zip`;
        const zipBlob = await zipImages(pages);
        // The render loop honors Cancel up to the last page, but zipping is a
        // further await — a Cancel pressed while the ZIP is being built would
        // otherwise still download it. Re-check here so Cancel means no output (§6.4).
        if (ac.signal.aborted) {
          setStatusMessage("Cancelled.");
          return;
        }
        downloadBlob(zipBlob, zipName);
        setStatusMessage(`Rendered ${pages.length} images → ${zipName}.`);
      }

      toast.success(`Rendered ${pages.length} ${pages.length === 1 ? "image" : "images"}`);

      const clampedCount = pages.filter((p) => p.clamped).length;
      if (failures.length > 0) {
        const total = pages.length + failures.length;
        setWarning(
          `Rendered ${pages.length} of ${total} pages; ${failures.length} could not be rendered.`,
        );
      } else if (clampedCount > 0) {
        setWarning(
          "Some pages exceeded the browser's canvas limit and were rendered at a lower effective DPI.",
        );
      }
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") {
        // Quiet cancel (§6.4): sr-only status only, no success toast.
        setStatusMessage("Cancelled.");
      } else if (e instanceof Error && e.message) {
        setError(e.message);
      } else {
        setError("Rendering failed. The PDF may be corrupt or unsupported.");
      }
    } finally {
      // Reject any password prompt left dangling (e.g. on abort).
      if (pendingPw.current) {
        pendingPw.current.reject(new Error("Cancelled."));
        pendingPw.current = null;
        setPwOpen(false);
      }
      abortRef.current = null;
      setIsConverting(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [pdf, canConvert, dimsKnown, resolvedCount, dpi, format, jpegQuality, pageRange, onPassword]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useKeyboardShortcut(
    useMemo(
      () => [{ key: "Enter", meta: true, handler: () => handleConvert(), enabled: canConvert }],
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
        disabled={isConverting}
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
              Rendering happens in your browser — nothing is uploaded.
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

      <section className="wb-panel wb-panel--out" aria-labelledby="pdf-file-label">
        <PaneHeader
          label="File"
          labelId="pdf-file-label"
          icon={<FileText className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
        />
        <div className="space-y-3 p-3 sm:p-4">
          {status === "idle" && (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-2">
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
            <div className="wb-item-enter flex items-center gap-2 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink" title={pdf.file.name}>
                  {pdf.file.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {dimsKnown && (
                    <StatusBadge
                      tone="neutral"
                      label={`${pageCount} ${pageCount === 1 ? "page" : "pages"}`}
                    />
                  )}
                  {encrypted && (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="size-3.5 text-tomato" aria-hidden="true" />
                      <StatusBadge tone="invalid" label="Password-protected" />
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                    {formatBytes(pdf.file.size)}
                  </span>
                </div>
                {encrypted && (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
                    You'll be asked for the password when you convert.
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-ink-2">
            Each selected page becomes its own image. Multiple pages download as a ZIP.
          </p>
        </div>
      </section>
    </div>
  );

  const right = (
    <section className="wb-panel flex flex-col lg:self-start" aria-labelledby="pdf-options-label">
      <PaneHeader
        label="Render options"
        labelId="pdf-options-label"
        icon={<Settings2 className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        {/* DPI */}
        <div className="space-y-2">
          <Label className="text-ink-2" id="dpi-label">
            Resolution (DPI)
          </Label>
          <fieldset
            className="m-0 grid min-w-0 grid-cols-4 gap-2 border-0 p-0"
            aria-labelledby="dpi-label"
            data-testid="dpi-selector"
          >
            {DPI_PRESETS.map((preset) => {
              const active = dpi === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDpi(preset)}
                  aria-pressed={active}
                  data-testid={`dpi-${preset}`}
                  className={cn(
                    "wb-lift-hover rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 tabular-nums",
                    active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  {preset}
                </button>
              );
            })}
          </fieldset>
          <p className="text-[12px] text-ink-3">
            Higher DPI = sharper, bigger files. 72 for web previews, 300 for print.
          </p>
          {status === "ready" && firstPageDims && (
            <p className="font-mono text-[12px] text-ink-2 tabular-nums" data-testid="dims-readout">
              Page 1 → {firstPageDims.width}×{firstPageDims.height} px at{" "}
              {firstPageDims.clamped
                ? `~${Math.round(firstPageDims.effectiveDpi)} DPI (reduced from ${dpi})`
                : `${dpi} DPI`}
            </p>
          )}
          {anyClamped && (
            <p
              className="wb-fade-in inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-lemon px-3 py-1 text-[12px] font-semibold text-ink shadow-pop-1"
              data-testid="clamp-chip"
            >
              DPI reduced for the largest page (canvas limit).
            </p>
          )}
        </div>

        {/* Format */}
        <div className="space-y-2">
          <Label className="text-ink-2" id="format-label">
            Format
          </Label>
          <fieldset
            className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0"
            aria-labelledby="format-label"
            data-testid="format-selector"
          >
            {FORMATS.map((f) => {
              const active = format === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id)}
                  aria-pressed={active}
                  data-testid={`format-${f.id}`}
                  className={cn(
                    "wb-lift-hover rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200",
                    active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </fieldset>
          <p className="text-[12px] text-ink-3">
            PNG is lossless; JPEG yields smaller files for many-page documents. Pages render on a
            white background.
          </p>
        </div>

        {/* JPEG quality — only when JPEG */}
        {format === "jpeg" && (
          <div className="wb-fade-in space-y-2" data-testid="jpeg-quality">
            <div className="flex items-center justify-between">
              <Label className="text-ink-2" id="quality-label">
                JPEG quality
              </Label>
              <span className="font-mono text-[12px] text-ink-2 tabular-nums">
                {Math.round(jpegQuality * 100)}%
              </span>
            </div>
            <Slider
              aria-labelledby="quality-label"
              min={60}
              max={100}
              step={1}
              value={[Math.round(jpegQuality * 100)]}
              onValueChange={(v) => {
                const pct = v[0];
                if (pct !== undefined) setJpegQuality(pct / 100);
              }}
            />
          </div>
        )}

        {/* Page range */}
        <div className="space-y-2">
          <Label htmlFor="pdf-range" className="text-ink-2">
            Page range
          </Label>
          <Input
            id="pdf-range"
            value={pageRange}
            onChange={(e) => setPageRange(e.target.value)}
            placeholder="e.g. 1-5, 8, 11-"
            disabled={status !== "ready"}
            className="h-11 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
            data-testid="range-input"
          />
          <p className="text-[12px] text-ink-3">Leave empty to render every page.</p>
        </div>

        {/* Output preview */}
        {status === "ready" && (
          <output
            className="wb-fade-in block rounded-md border-2 border-ink bg-paper-2 px-4 py-3"
            data-testid="output-preview"
            aria-atomic="true"
          >
            {!dimsKnown ? (
              <p className="text-[12.5px] text-ink-2">
                Page count is available after you unlock the PDF. Your page range applies then —
                leave it empty to render every page.
              </p>
            ) : pageCount === 0 ? (
              <p className="text-[12.5px] font-semibold text-tomato">This PDF has no pages.</p>
            ) : rangeError ? (
              <p className="text-[12.5px] font-semibold text-tomato">{rangeError}</p>
            ) : overCap ? (
              <p className="text-[12.5px] font-semibold text-tomato">
                Too many pages ({resolvedCount}) at {dpi} DPI — the limit is {maxOutputPages(dpi)}.
                Lower the DPI or narrow the page range.
              </p>
            ) : resolvedCount >= 1 ? (
              <p
                key={resolvedCount}
                className="wb-stat-tick font-mono text-[13px] font-bold text-ink tabular-nums"
              >
                → {resolvedCount} {resolvedCount === 1 ? "image" : "images"}
              </p>
            ) : (
              <p className="text-[12.5px] text-ink-2">Enter a page range to preview the output.</p>
            )}
          </output>
        )}

        <div className="space-y-3">
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
                      ? `Rendering ${progress.done}/${progress.total}`
                      : "Rendering…"}
                  </span>
                </>
              ) : (
                <>
                  <Download className="size-4" aria-hidden="true" />
                  <span>Convert &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {isConverting &&
            (progress.total > 0 ? (
              // Determinate: expose render progress to assistive tech. progressbar
              // is a status role (not a keyboard widget), so it is intentionally
              // not a tab stop.
              // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, must not be focusable
              <div
                className="wb-progress-track"
                data-testid="progress-bar"
                role="progressbar"
                aria-label="Rendering pages"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div
                  className="wb-progress-fill"
                  style={{ transform: `scaleX(${progress.done / progress.total})` }}
                />
              </div>
            ) : (
              // Indeterminate (page count not yet known): decorative — the sr-only
              // live region announces "Unlocking and rendering…" for screen readers.
              <div className="wb-progress-track" data-testid="progress-bar" aria-hidden="true">
                <div className="wb-progress-fill" data-indeterminate="true" />
              </div>
            ))}
          {isConverting && (
            <button
              type="button"
              onClick={handleCancel}
              className="wb-btn w-full justify-center py-3 text-[14px]"
              data-testid="cancel-button"
            >
              Cancel
            </button>
          )}
          {status !== "ready" && !isConverting && (
            <p className="text-center text-[12.5px] text-ink-3">Upload a PDF to convert it.</p>
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

      <Dialog
        open={pwOpen}
        onOpenChange={(open) => {
          if (!open) cancelPassword();
        }}
      >
        <DialogContent data-testid="password-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="size-4" aria-hidden="true" />
              Password required
            </DialogTitle>
            <DialogDescription>
              {pwKind === "incorrect"
                ? "That password was incorrect. Try again."
                : "This PDF is password-protected. Enter the open password to render it."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="pdf-password">Password</Label>
              <Input
                id="pdf-password"
                type="password"
                autoFocus
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                className="border-2 border-ink bg-paper"
                data-testid="password-input"
              />
              {pwKind === "incorrect" && (
                <p className="text-[12.5px] font-semibold text-tomato" data-testid="password-error">
                  Incorrect password.
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={cancelPassword}
                data-testid="password-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="password-submit">
                Unlock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ToolShell>
  );
}
