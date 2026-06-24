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
  type CompressMode,
  type CompressResult,
  DEFAULT_STRONG_DPI,
  DEFAULT_STRONG_QUALITY,
  type PdfProbe,
  STRONG_DPI_PRESETS,
  type StrongDpi,
  buildCompressedFilename,
  compressPdf,
  downloadBlob,
  formatBytes,
  probePdf,
  readFileBytes,
  validatePdfFile,
} from "./compressor";

interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  probe: PdfProbe;
}

type PasswordKind = "need" | "incorrect";

interface PendingPassword {
  resolve: (password: string) => void;
  reject: (reason: Error) => void;
}

export default function CompressPdfRoute() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mode, setMode] = useState<CompressMode>("lossless");
  const [dpi, setDpi] = useState<StrongDpi>(DEFAULT_STRONG_DPI);
  const [quality, setQuality] = useState<number>(DEFAULT_STRONG_QUALITY);
  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<CompressResult | null>(null);
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

  const encrypted = pdf?.probe.encrypted ?? false;
  const dimsKnown = pdf?.probe.dimsKnown ?? false;
  const pageCount = pdf?.probe.pageCount ?? 0;

  const canCompress =
    status === "ready" && !isCompressing && (mode === "strong" || !pdf?.probe.encrypted);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    setWarning(null);
    setResult(null);
    const validation = validatePdfFile(file);
    if (!validation.valid) {
      setStatus("error");
      const msg = validation.error ?? "Invalid file.";
      setError(msg);
      setStatusMessage(msg); // keep the sr-only live region in sync with the visible alert
      return;
    }
    if (validation.warning) setWarning(validation.warning);

    setStatus("loading");
    setPdf(null);
    try {
      const bytes = await readFileBytes(file);
      const probe = await probePdf(bytes);
      setPdf({ file, bytes, probe });
      // Encrypted PDFs must use Strong (pdf-lib can't decrypt for lossless). A
      // fresh non-encrypted file resets to the lossless default, so a previous
      // encrypted upload's forced Strong doesn't silently rasterize the next
      // normal PDF the user only meant to losslessly compress.
      setMode(probe.encrypted ? "strong" : "lossless");
      setStatus("ready");
      setStatusMessage(
        probe.dimsKnown
          ? `${file.name} ready, ${probe.pageCount} ${probe.pageCount === 1 ? "page" : "pages"}.`
          : probe.encrypted
            ? `${file.name} ready. Password-protected — you'll be asked to unlock it when you compress.`
            : `${file.name} ready.`,
      );
    } catch {
      setStatus("error");
      const msg = "Could not read this PDF. It may be corrupt.";
      setError(msg);
      setStatusMessage(msg); // keep the sr-only live region in sync with the visible alert
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
      if (!isCompressing && files && files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles, isCompressing],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isCompressing) return; // don't swap the file out from under an active run
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isCompressing],
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

  const handleCompress = useCallback(async () => {
    if (!pdf || !canCompress) return;
    setError(null);
    setWarning(null);
    setResult(null);
    setIsCompressing(true);
    setProgress({ done: 0, total: 0 });
    setStatusMessage("Compressing…");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const compressed = await compressPdf(
        pdf.bytes,
        mode,
        { dpi, jpegQuality: quality },
        {
          onProgress: (done, total) => setProgress({ done, total }),
          onPassword,
          signal: ac.signal,
        },
      );

      setResult(compressed);

      if (compressed.keptOriginal) {
        // An identical file under a "-compressed" name would mislead — keep the
        // original filename when nothing smaller was produced.
        downloadBlob(
          new Blob([compressed.bytes as BlobPart], { type: "application/pdf" }),
          pdf.file.name,
        );
        // Encrypted source ⇒ the kept original is still password-protected; say
        // so, or the user who just unlocked it is surprised it's still locked.
        const keptMsg = encrypted
          ? "Already optimized — your original (still password-protected) was kept."
          : "Already optimized — your original was kept.";
        setStatusMessage(keptMsg);
        toast.success(keptMsg);
      } else {
        downloadBlob(
          new Blob([compressed.bytes as BlobPart], { type: "application/pdf" }),
          buildCompressedFilename(pdf.file.name),
        );
        const pct = Math.round(compressed.ratio * 100);
        setStatusMessage(`Compressed → −${pct}%.`);
        toast.success(`Compressed → −${pct}%`);
      }

      // Clamp warning is meaningless when the rasterized output was discarded by
      // the regression guard (keptOriginal) — only surface it for a real result.
      if (!compressed.keptOriginal && compressed.clampedPages > 0) {
        setWarning(
          `${compressed.clampedPages} large page${
            compressed.clampedPages === 1 ? " was" : "s were"
          } rendered below the target DPI to stay within browser limits.`,
        );
      }
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") {
        // Quiet cancel: sr-only status only, no red alert, no success toast.
        setStatusMessage("Cancelled.");
      } else {
        // Surface the compressor's user-facing message (e.g. "Too many pages…",
        // "Couldn't compress page N…", "This file is not a valid PDF or is
        // corrupt.") instead of masking every failure behind one generic line.
        // Internal asserts and non-Error throws fall back to the generic copy,
        // and the live region is updated too (it must not stay on "Compressing…").
        const message =
          e instanceof Error && e.message && !e.message.startsWith("Internal")
            ? e.message
            : "Compression failed. The PDF may be corrupt or unreadable.";
        setError(message);
        setStatusMessage(message);
      }
    } finally {
      // Reject any password prompt left dangling (e.g. on abort).
      if (pendingPw.current) {
        pendingPw.current.reject(new Error("Cancelled."));
        pendingPw.current = null;
        setPwOpen(false);
      }
      abortRef.current = null;
      setIsCompressing(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [pdf, canCompress, mode, dpi, quality, onPassword, encrypted]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Changing a compression option (mode/DPI/quality) invalidates the last result's
  // readout — a strong −90% left on screen after switching to Lossless would mislead.
  // Clear it so the preview reverts to "choose a mode and compress". Guard on `result`:
  // when none exists nothing is stale, and clearing `warning` then would wipe the
  // load-time large-file notice (handleCompress nulls that before producing a result,
  // so the only warning present alongside a result is the clamp notice — safe to drop).
  const clearStaleResult = useCallback(() => {
    if (result) {
      setResult(null);
      setWarning(null);
    }
  }, [result]);

  useKeyboardShortcut(
    useMemo(
      () => [{ key: "Enter", meta: true, handler: () => handleCompress(), enabled: canCompress }],
      [canCompress, handleCompress],
    ),
  );

  const qualityPct = Math.round(quality * 100);

  const left = (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isCompressing}
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
              Compression happens in your browser — nothing is uploaded.
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
                    You'll be asked for the password when you compress.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const right = (
    <section className="wb-panel flex flex-col lg:self-start" aria-labelledby="pdf-options-label">
      <PaneHeader
        label="Compression options"
        labelId="pdf-options-label"
        icon={<Settings2 className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        {/* Mode */}
        <div className="space-y-2">
          <Label className="text-ink-2" id="mode-label">
            Mode
          </Label>
          <fieldset
            className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0"
            aria-labelledby="mode-label"
            data-testid="mode-selector"
          >
            <button
              type="button"
              onClick={() => {
                setMode("lossless");
                clearStaleResult();
              }}
              aria-pressed={mode === "lossless"}
              disabled={encrypted}
              data-testid="mode-lossless"
              className={cn(
                "wb-lift-hover rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-50",
                mode === "lossless" ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
              )}
            >
              Lossless
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("strong");
                clearStaleResult();
              }}
              aria-pressed={mode === "strong"}
              data-testid="mode-strong"
              className={cn(
                "wb-lift-hover rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200",
                mode === "strong" ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
              )}
            >
              Strong (image)
            </button>
          </fieldset>
          {mode === "lossless" && (
            <p className="text-[12px] leading-relaxed text-ink-3">
              Restructures and recompresses without changing how it looks. Best for text and vector
              PDFs. Often 5–20% on text PDFs; little to none on image-heavy or already-optimized
              files.
            </p>
          )}
          {encrypted && (
            <p className="text-[12px] leading-relaxed text-ink-2" data-testid="encrypted-mode-note">
              This PDF is password-protected — only Strong (image) compression is available. To
              losslessly compress it, unlock it first.
            </p>
          )}
        </div>

        {/* Strong controls */}
        {mode === "strong" && (
          <div className="wb-fade-in flex flex-col gap-6" data-testid="strong-controls">
            {/* DPI */}
            <div className="space-y-2">
              <Label className="text-ink-2" id="dpi-label">
                Resolution (DPI)
              </Label>
              <fieldset
                className="m-0 grid min-w-0 grid-cols-3 gap-2 border-0 p-0"
                aria-labelledby="dpi-label"
                data-testid="dpi-selector"
              >
                {STRONG_DPI_PRESETS.map((preset) => {
                  const active = dpi === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setDpi(preset);
                        clearStaleResult();
                      }}
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
                Lower DPI = smaller files. 72 for screen, 150 for sharper output.
              </p>
            </div>

            {/* JPEG quality */}
            <div className="space-y-2" data-testid="jpeg-quality">
              <div className="flex items-center justify-between">
                <Label className="text-ink-2" id="quality-label">
                  Image quality
                </Label>
                <span className="font-mono text-[12px] text-ink-2 tabular-nums">{qualityPct}%</span>
              </div>
              <Slider
                aria-labelledby="quality-label"
                className="[&_[role=slider]]:size-6"
                min={30}
                max={95}
                step={1}
                value={[qualityPct]}
                onValueChange={(v) => {
                  const pct = v[0];
                  if (pct !== undefined) {
                    setQuality(pct / 100);
                    clearStaleResult();
                  }
                }}
              />
            </div>

            <WarningAlert
              warning="Converts each page to an image. Big savings on scanned/photo PDFs — but text becomes non-selectable and may look softer. Not recommended for text documents."
              className="mt-0"
              testId="raster-warning"
            />
            {encrypted && (
              <p
                className="text-[12px] leading-relaxed text-ink-3"
                data-testid="encrypted-strong-note"
              >
                The compressed copy will not be password-protected.
              </p>
            )}
          </div>
        )}

        {/* Result preview */}
        <output
          className="wb-fade-in block rounded-md border-2 border-ink bg-paper-2 px-4 py-3"
          data-testid="result-preview"
          aria-atomic="true"
        >
          {status !== "ready" ? (
            <p className="text-[12.5px] text-ink-2">Upload a PDF to compress it.</p>
          ) : result === null ? (
            <p className="text-[12.5px] text-ink-2">
              {pdf ? `${formatBytes(pdf.file.size)} — ` : ""}choose a mode and compress to see the
              result.
            </p>
          ) : result.keptOriginal ? (
            <p
              className="wb-fade-in text-[12.5px] font-semibold text-ink"
              data-testid="kept-original-notice"
            >
              This PDF is already well-optimized — no smaller version was produced; your original
              was kept.
            </p>
          ) : (
            <div
              className="wb-success-pop flex flex-wrap items-center gap-2"
              data-testid="result-readout"
            >
              <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
                {formatBytes(result.inputSize)} → {formatBytes(result.outputSize)}
              </span>
              <StatusBadge tone="valid" label={`−${Math.round(result.ratio * 100)}%`} />
            </div>
          )}
        </output>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleCompress}
            disabled={!canCompress}
            className="wb-btn w-full justify-center py-4 text-[15px]"
            data-testid="compress-button"
          >
            <IconSwap swapKey={isCompressing}>
              {isCompressing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>
                    {mode === "strong" && progress.total > 0
                      ? `Compressing ${progress.done}/${progress.total}`
                      : "Compressing…"}
                  </span>
                </>
              ) : (
                <>
                  <Download className="size-4" aria-hidden="true" />
                  <span>Compress &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {isCompressing &&
            (mode === "strong" && progress.total > 0 ? (
              // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, must not be focusable
              <div
                className="wb-progress-track"
                data-testid="progress-bar"
                role="progressbar"
                aria-label="Compressing pages"
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
              <div className="wb-progress-track" data-testid="progress-bar" aria-hidden="true">
                <div className="wb-progress-fill" data-indeterminate="true" />
              </div>
            ))}
          {isCompressing && mode === "strong" && (
            <button
              type="button"
              onClick={handleCancel}
              className="wb-btn wb-btn--ghost w-full justify-center py-3 text-[14px]"
              data-testid="cancel-button"
            >
              Cancel
            </button>
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
                : "This PDF is password-protected. Enter the open password to compress it."}
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
