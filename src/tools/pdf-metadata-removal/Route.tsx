import {
  Check,
  CloudUpload,
  Download,
  FileText,
  ListOrdered,
  Loader2,
  Lock,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, WarningAlert } from "../../components/tool-layout";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";
import { MAX_QUEUE_SIZE } from "../constants";
import {
  buildCleanedFilename,
  buildZip,
  downloadBlob,
  readFileBytes,
  readPdfMetadata,
  stripPdfMetadata,
  validatePdfFile,
} from "./metadata";
import type { FileItem } from "./metadata";

// Encrypted PDFs can't be processed by pdf-lib — block per file and continue the batch.
const ENCRYPTED_MESSAGE = "This PDF is password-protected and can't be processed. Unlock it first.";

// Soft warning threshold: a large batch can OOM the tab (esp. mobile Safari). ~200 MB total.
const BATCH_WARN_BYTES = 200 * 1024 * 1024;

const LIMITATION_NOTE =
  "Removes document metadata (properties, XMP, document ID). Doesn't touch metadata inside embedded " +
  "images or attachments, or form-field values — use Redact for that. Re-saving also invalidates any " +
  "existing digital signature.";

// Whitespace-only values are absent for fieldCount (presentString in metadata.ts); the chips must
// agree, else a whitespace-only Title/Author renders an empty chip alongside "No metadata found".
function present(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

function formatDate(date: Date): string {
  // YYYY-MM-DD in UTC. The PDF stores an absolute instant; using local getters would shift the
  // displayed calendar day for viewers west of UTC (e.g. a UTC-midnight date showing the prior day).
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function PdfMetadataRemovalRoute() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filesRef = useRef(files);
  filesRef.current = files;

  const handleFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    setWarning(null);

    const newItems: FileItem[] = [];
    for (const file of Array.from(fileList)) {
      const validation = validatePdfFile(file);
      if (!validation.valid) {
        setError(validation.error ?? "Invalid file.");
        continue;
      }
      if (validation.warning) {
        setWarning(validation.warning);
      }
      newItems.push({
        id: crypto.randomUUID(),
        file,
        status: "analyzing",
        metadata: null,
        encrypted: false,
        cleanedBytes: null,
        error: null,
        // Batch-local index (capped) so a multi-file drop staggers its enter,
        // while later appends restart the rhythm instead of waiting on the queue.
        enterIndex: Math.min(newItems.length, 6),
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

    // Soft batch-size warning: sum of ALL queued file sizes after this add.
    const totalBytes = [...filesRef.current, ...newItems].reduce((sum, f) => sum + f.file.size, 0);
    if (totalBytes > BATCH_WARN_BYTES) {
      setWarning(
        "Large batch — processing this many bytes may be slow or run out of memory in the browser.",
      );
    }

    for (const item of newItems) {
      try {
        const bytes = await readFileBytes(item.file);
        const result = await readPdfMetadata(bytes);
        // Encrypted gate BEFORE display — never flash metadata we can't strip.
        if (result.encrypted) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "error",
                    encrypted: true,
                    metadata: null,
                    error: ENCRYPTED_MESSAGE,
                  }
                : f,
            ),
          );
          // Announce the per-file block to SR users — the queue <li> is not a live region (WCAG 4.1.3).
          setStatusMessage(`${item.file.name} is password-protected and can't be processed.`);
          continue;
        }
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "ready", metadata: result } : f)),
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: "error", error: "Could not read this PDF. It may be corrupt." }
              : f,
          ),
        );
        setStatusMessage(`Could not read ${item.file.name}. It may be corrupt.`);
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
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleProcess = useCallback(async () => {
    if (isProcessing) return;

    // READY-ONLY: encrypted files are status "error" and must NEVER be fed to stripPdfMetadata.
    const processable = files.filter((f) => f.status === "ready");
    if (processable.length === 0) {
      setStatusMessage("No files ready to process.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress({ current: 0, total: processable.length });
    setStatusMessage(
      `Stripping metadata from ${processable.length} PDF${processable.length === 1 ? "" : "s"}.`,
    );

    const results: Array<{ name: string; data: Uint8Array }> = [];
    let failed = 0;

    for (const item of processable) {
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "processing", error: null } : f)),
      );

      try {
        const bytes = await readFileBytes(item.file);
        const cleaned = await stripPdfMetadata(bytes);
        results.push({ name: buildCleanedFilename(item.file.name), data: cleaned });

        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "done", cleanedBytes: cleaned } : f)),
        );
      } catch {
        failed++;
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: "error", error: "Failed to strip metadata from this PDF." }
              : f,
          ),
        );
      }

      setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
    }

    // Per-file errors live in the queue <li> (not a live region), so surface the failure
    // count in the polite announcement — otherwise SR users hear only the successes (WCAG 4.1.3).
    const failedNote =
      failed > 0 ? ` ${failed} file${failed === 1 ? "" : "s"} could not be processed.` : "";

    if (results.length === 1) {
      const only = results[0];
      if (only) {
        downloadBlob(new Blob([only.data as BlobPart], { type: "application/pdf" }), only.name);
        setStatusMessage(`Done. ${only.name} downloaded.${failedNote}`);
      }
    } else if (results.length > 1) {
      // The archive is built on demand in handleDownload (the single download path), so multi-file
      // runs aren't auto-downloaded — the user clicks "Download ZIP" to fetch the combined archive.
      setStatusMessage(`Done. ${results.length} clean PDFs ready to download.${failedNote}`);
    } else {
      setStatusMessage(
        failed > 0
          ? `Processing failed. ${failed} file${failed === 1 ? "" : "s"} could not be processed.`
          : "Processing finished with no successful files.",
      );
    }

    setIsProcessing(false);
  }, [files, isProcessing]);

  const readyCount = files.filter((f) => f.status === "ready").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // Download every cleaned file: single → its cleanedBytes as .pdf; multi → a zip of all.
  // Built fresh from the current done items each click so it always reflects the live queue
  // (e.g. after a done row is removed), rather than a cached archive that could go stale.
  const handleDownload = useCallback(() => {
    const done = filesRef.current.filter((f) => f.status === "done");
    if (done.length === 1) {
      const only = done[0];
      if (only?.cleanedBytes) {
        downloadBlob(
          new Blob([only.cleanedBytes as BlobPart], { type: "application/pdf" }),
          buildCleanedFilename(only.file.name),
        );
      }
    } else if (done.length > 1) {
      const items = done
        .filter((f) => f.cleanedBytes)
        .map((f) => ({
          name: buildCleanedFilename(f.file.name),
          data: f.cleanedBytes as Uint8Array,
        }));
      if (items.length > 0) {
        try {
          downloadBlob(buildZip(items), "cleaned-pdfs.zip");
        } catch {
          setError("Failed to generate ZIP archive.");
        }
      }
    }
  }, []);

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
          handler: () => handleDownload(),
          enabled: !isProcessing && doneCount > 0,
        },
      ],
      [isProcessing, readyCount, doneCount, handleProcess, handleDownload],
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
                Drop your PDFs here
              </h2>
              <p className="text-sm text-ink-2">
                Stripping happens in your browser — nothing is uploaded.
              </p>
            </div>
            <button
              type="button"
              className="wb-btn wb-btn--lemon wb-btn--sm mt-1 min-h-11 sm:min-h-0"
              onClick={() => fileInputRef.current?.click()}
            >
              Select Files
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            aria-label="Upload PDF files"
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
              label={`Queue (${files.length})`}
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
                  style={{ "--enter-i": item.enterIndex ?? 0 } as React.CSSProperties}
                  className={cn(
                    "wb-item-enter wb-stagger flex items-center gap-3 rounded-md border-2 border-ink p-2.5 shadow-pop-1 transition-[background,box-shadow,transform] duration-200",
                    item.status === "done" ? "bg-mint" : "bg-paper",
                  )}
                >
                  {/* Status icon */}
                  <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-sm border-2 border-ink bg-paper text-ink">
                    {item.status === "analyzing" || item.status === "processing" ? (
                      <Loader2
                        className="size-5 animate-spin"
                        strokeWidth={2.25}
                        aria-hidden="true"
                      />
                    ) : item.status === "done" ? (
                      <span className="wb-svg-check-pop">
                        <Check className="size-5 text-grass" strokeWidth={3} aria-hidden="true" />
                      </span>
                    ) : item.encrypted ? (
                      <Lock className="size-5 text-tomato" strokeWidth={2.5} aria-hidden="true" />
                    ) : item.status === "error" ? (
                      <X className="size-5 text-tomato" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      <FileText
                        className="size-5 text-ink-2"
                        strokeWidth={2.25}
                        aria-hidden="true"
                      />
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
                        {present(item.metadata.author) && (
                          <MetaChip>Author: {item.metadata.author}</MetaChip>
                        )}
                        {present(item.metadata.creator) && (
                          <MetaChip>Creator: {item.metadata.creator}</MetaChip>
                        )}
                        {present(item.metadata.producer) && (
                          <MetaChip>Producer: {item.metadata.producer}</MetaChip>
                        )}
                        {present(item.metadata.title) && (
                          <MetaChip>Title: {item.metadata.title}</MetaChip>
                        )}
                        {present(item.metadata.subject) && (
                          <MetaChip>Subject: {item.metadata.subject}</MetaChip>
                        )}
                        {present(item.metadata.keywords) && (
                          <MetaChip>Keywords: {item.metadata.keywords}</MetaChip>
                        )}
                        {item.metadata.creationDate && (
                          <MetaChip>Created {formatDate(item.metadata.creationDate)}</MetaChip>
                        )}
                        {item.metadata.modificationDate && (
                          <MetaChip>Modified {formatDate(item.metadata.modificationDate)}</MetaChip>
                        )}
                        {item.metadata.customKeys.map((key) => (
                          <MetaChip key={key}>{key}</MetaChip>
                        ))}
                        {item.metadata.hasXmp && <AlertChip>XMP metadata</AlertChip>}
                        {item.metadata.hasDocumentId && <AlertChip>Document ID</AlertChip>}
                        {item.metadata.fieldCount === 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-mint px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-grass" />
                            No metadata found
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
                        Cleaned
                      </p>
                    )}

                    {item.status === "error" && (
                      <p className="wb-fade-in mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-tomato" />
                        {item.error ?? "Error"}
                      </p>
                    )}
                  </div>

                  {/* Actions — every row (including cleaned ones) stays removable so the user can
                      clear it and release its retained cleanedBytes. The "Cleaned" state is shown
                      in the info column above, so no separate done-row badge is needed. */}
                  <button
                    type="button"
                    className="grid size-11 shrink-0 place-items-center rounded-md text-ink-3 transition-[color,transform] duration-200 hover:-translate-y-px hover:text-tomato focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2 disabled:cursor-not-allowed disabled:opacity-40 sm:size-9"
                    onClick={() => handleRemoveFile(item.id)}
                    disabled={isProcessing}
                    aria-label={`Remove ${item.file.name}`}
                    data-testid={`remove-${item.id}`}
                  >
                    <Trash2 className="size-4" strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <p className="border-t-2 border-ink px-4 py-3 text-[12px] leading-relaxed text-ink-3">
              {LIMITATION_NOTE}
            </p>
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
              <span>Remove Metadata</span>
              <KbdHint>⌘⏎</KbdHint>
            </button>

            {isProcessing && (
              <div className="wb-fade-in w-full max-w-md space-y-2">
                <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-ink-3 tabular-nums">
                  <span>
                    Stripping {progress.current}/{progress.total}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <progress
                  className="sr-only"
                  value={progress.current}
                  max={progress.total}
                  aria-label="Stripping metadata progress"
                />
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

            {!isProcessing && doneCount > 0 && (
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
                  <p className="text-sm font-bold text-ink">
                    {doneCount === 1 ? "1 PDF cleaned" : `${doneCount} PDFs cleaned`}
                  </p>
                  <p className="text-xs text-ink-2">
                    {doneCount === 1
                      ? "Your download started automatically."
                      : "Archive ready to download."}
                  </p>
                </div>
                <button
                  type="button"
                  className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  onClick={handleDownload}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  <span>{doneCount > 1 ? "Download ZIP" : "Download Again"}</span>
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

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-md border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-2">
      {children}
    </span>
  );
}

function AlertChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border-2 border-ink bg-tomato px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" />
      {children}
    </span>
  );
}
