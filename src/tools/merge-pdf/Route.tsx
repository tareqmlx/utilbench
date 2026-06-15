import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  FileText,
  GripVertical,
  Layers,
  Loader2,
  Lock,
  Upload,
  X,
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
import { MAX_QUEUE_SIZE } from "../constants";
import {
  MAX_TOTAL_SIZE,
  type PdfMeta,
  buildMergedFilename,
  downloadBlob,
  getPdfMeta,
  mergePdfs,
  readFileBytes,
  validatePdfFile,
} from "./merger";

interface FileEntry {
  id: string;
  file: File;
  bytes?: Uint8Array;
  meta?: PdfMeta;
  status: "loading" | "ready" | "error";
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let nextId = 0;
function uid(): string {
  return `pdf-${Date.now()}-${nextId++}`;
}

interface SortableItemProps {
  entry: FileEntry;
  index: number;
  total: number;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function SortableItem({ entry, index, total, onRemove, onMoveUp, onMoveDown }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });

  const baseTransform = CSS.Transform.toString(transform);
  const style = {
    // Add a small lift while dragging to read as "picked up off the pegboard".
    transform: isDragging && baseTransform ? `${baseTransform} scale(1.02)` : baseTransform,
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "wb-item-enter flex items-center gap-2 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1 transition-[box-shadow]",
        isDragging && "z-10 shadow-pop-2",
      )}
    >
      <button
        type="button"
        className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-3 transition-colors hover:text-ink sm:size-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper active:cursor-grabbing"
        aria-label={`Drag to reorder ${entry.file.name}`}
        data-testid={`drag-${entry.id}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-ink" title={entry.file.name}>
          {entry.file.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {entry.status === "loading" && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Reading…
            </span>
          )}
          {entry.status === "ready" && entry.meta && (
            <StatusBadge
              tone="neutral"
              label={`${entry.meta.pageCount} ${entry.meta.pageCount === 1 ? "page" : "pages"}`}
            />
          )}
          {entry.status === "ready" && entry.meta?.encrypted && (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5 text-tomato" aria-hidden="true" />
              <StatusBadge tone="invalid" label="Locked" />
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
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onMoveUp(entry.id)}
          disabled={index === 0}
          className="wb-lift-hover grid size-11 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-[background,transform] duration-200 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon sm:size-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Move ${entry.file.name} up`}
          data-testid={`move-up-${entry.id}`}
        >
          <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(entry.id)}
          disabled={index === total - 1}
          className="wb-lift-hover grid size-11 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-[background,transform] duration-200 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon sm:size-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Move ${entry.file.name} down`}
          data-testid={`move-down-${entry.id}`}
        >
          <ArrowDown className="size-4" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry.id)}
          className="grid size-11 place-items-center rounded-md text-ink-3 transition-colors hover:text-tomato sm:size-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          title="Remove"
          aria-label={`Remove ${entry.file.name}`}
          data-testid={`remove-${entry.id}`}
        >
          <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function MergePdfRoute() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [filenameTouched, setFilenameTouched] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Seeded once from the first ready file; held stable so reordering the queue
  // does not silently rewrite the suggested output name under the user.
  const autoFilenameRef = useRef("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const readyEntries = useMemo(() => entries.filter((e) => e.status === "ready"), [entries]);
  const totalPages = useMemo(
    () => readyEntries.reduce((sum, e) => sum + (e.meta?.pageCount ?? 0), 0),
    [readyEntries],
  );
  const totalSize = useMemo(
    () => readyEntries.reduce((sum, e) => sum + e.file.size, 0),
    [readyEntries],
  );
  const hasEncrypted = useMemo(() => readyEntries.some((e) => e.meta?.encrypted), [readyEntries]);
  const hasFailed = useMemo(() => entries.some((e) => e.status === "error"), [entries]);

  const resolvedFilename = useMemo(() => {
    if (filenameTouched) return filename;
    if (readyEntries.length === 0) {
      autoFilenameRef.current = "";
      return "";
    }
    if (!autoFilenameRef.current) {
      autoFilenameRef.current = buildMergedFilename(
        readyEntries.map((e) => ({ name: e.file.name })),
      );
    }
    return autoFilenameRef.current;
  }, [filenameTouched, filename, readyEntries]);

  const loadEntry = useCallback(async (id: string, file: File) => {
    try {
      const bytes = await readFileBytes(file);
      const meta = await getPdfMeta(bytes);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, bytes, meta, status: "ready" as const } : e)),
      );
      setStatusMessage(`${file.name} ready, ${meta.pageCount} pages.`);
    } catch {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                status: "error" as const,
                error: "Could not read this PDF. It may be corrupt.",
              }
            : e,
        ),
      );
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const fileArray = Array.from(files);

      const accepted: FileEntry[] = [];
      for (const file of fileArray) {
        const validation = validatePdfFile(file);
        if (!validation.valid) {
          setError(validation.error ?? "Invalid file.");
          continue;
        }
        if (validation.warning) {
          setWarning(validation.warning);
        }
        accepted.push({ id: uid(), file, status: "loading" });
      }

      if (accepted.length === 0) return;

      setEntries((prev) => {
        const available = MAX_QUEUE_SIZE - prev.length;
        if (available <= 0) {
          setWarning(`Limit reached (max ${MAX_QUEUE_SIZE} files). Remove some files first.`);
          return prev;
        }
        const queueLimited = accepted.length > available ? accepted.slice(0, available) : accepted;
        if (queueLimited.length < accepted.length) {
          setWarning(
            `Only ${queueLimited.length} of ${accepted.length} files added. Limit is ${MAX_QUEUE_SIZE}.`,
          );
        }

        // Cap cumulative footprint so a stack of large PDFs can't exhaust memory.
        let runningSize = prev.reduce((sum, e) => sum + e.file.size, 0);
        const toAdd: FileEntry[] = [];
        for (const entry of queueLimited) {
          if (runningSize + entry.file.size > MAX_TOTAL_SIZE) break;
          runningSize += entry.file.size;
          toAdd.push(entry);
        }
        if (toAdd.length < queueLimited.length) {
          const capMb = Math.round(MAX_TOTAL_SIZE / (1024 * 1024));
          setWarning(`Total size limit reached (max ${capMb}MB). Some files were not added.`);
        }
        if (toAdd.length === 0) return prev;

        setStatusMessage(
          toAdd.length === 1 ? `Added ${toAdd[0]?.file.name}.` : `Added ${toAdd.length} files.`,
        );
        for (const entry of toAdd) {
          void loadEntry(entry.id, entry.file);
        }
        return [...prev, ...toAdd];
      });
    },
    [loadEntry],
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
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemove = useCallback((id: string) => {
    setEntries((prev) => {
      const item = prev.find((e) => e.id === id);
      if (item) setStatusMessage(`Removed ${item.file.name}.`);
      // Drop the bytes ref so the buffer can be garbage-collected.
      return prev.filter((e) => e.id !== id);
    });
  }, []);

  const handleClearFailed = useCallback(() => {
    setEntries((prev) => prev.filter((e) => e.status !== "error"));
    setStatusMessage("Removed failed files.");
  }, []);

  const handleMoveUp = useCallback((id: string) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx <= 0) return prev;
      return arrayMove(prev, idx, idx - 1);
    });
  }, []);

  const handleMoveDown = useCallback((id: string) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      return arrayMove(prev, idx, idx + 1);
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setEntries((prev) => {
      const oldIndex = prev.findIndex((e) => e.id === active.id);
      const newIndex = prev.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const canMerge = readyEntries.length >= 2 && !isMerging;

  const handleMerge = useCallback(async () => {
    if (isMerging) return;
    // Read list order from current state; only "ready" entries are included.
    const inputs = entries
      .filter((e): e is FileEntry & { bytes: Uint8Array } => e.status === "ready" && !!e.bytes)
      .map((e) => ({ name: e.file.name, bytes: e.bytes }));

    if (inputs.length < 2) return;

    const outName = resolvedFilename.trim()
      ? resolvedFilename.trim().toLowerCase().endsWith(".pdf")
        ? resolvedFilename.trim()
        : `${resolvedFilename.trim()}.pdf`
      : "merged.pdf";

    setIsMerging(true);
    setError(null);
    setMergeProgress({ done: 0, total: inputs.length });
    setStatusMessage(`Merging ${inputs.length} files.`);

    try {
      const bytes = await mergePdfs(inputs, {
        onProgress: (done, total) => setMergeProgress({ done, total }),
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, outName);
      setStatusMessage(`Merged ${inputs.length} files into ${outName}.`);
      toast.success(`Merged ${inputs.length} files → ${outName}`);
    } catch {
      setError("Merge failed. One of the PDFs may be corrupt or unreadable.");
    } finally {
      setIsMerging(false);
    }
  }, [entries, isMerging, resolvedFilename]);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => handleMerge(),
          enabled: canMerge,
        },
      ],
      [canMerge, handleMerge],
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
        aria-label="Add PDFs: drop here, or click to browse"
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
              Drop PDFs here or click to browse
            </p>
            <p className="wb-fade-in text-sm text-ink-2">
              Merging happens in your browser. Nothing is uploaded.
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
        multiple
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

      <section className="wb-panel wb-panel--out" aria-labelledby="merge-files-label">
        <PaneHeader
          label="Files"
          labelId="merge-files-label"
          icon={<Layers className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
          actions={
            <div className="flex items-center gap-3">
              {hasFailed && (
                <button
                  type="button"
                  onClick={handleClearFailed}
                  className="rounded font-mono text-[11px] font-medium uppercase tracking-wider text-tomato transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato"
                  data-testid="clear-failed"
                >
                  Clear failed
                </button>
              )}
              <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
                {readyEntries.length === entries.length
                  ? `${entries.length} ${entries.length === 1 ? "File" : "Files"}`
                  : `${readyEntries.length}/${entries.length} Ready`}
              </span>
            </div>
          }
        />
        <div className="space-y-2 p-3 sm:p-4">
          {entries.length === 0 ? (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
              No PDFs yet. Upload files to get started.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {entries.map((entry, index) => (
                    <SortableItem
                      key={entry.id}
                      entry={entry}
                      index={index}
                      total={entries.length}
                      onRemove={handleRemove}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-ink-3">
            Bookmarks, outlines, internal links, and digital signatures are not carried into the
            merged file.
          </p>
        </div>
      </section>
    </div>
  );

  const right = (
    <section className="wb-panel flex flex-col lg:self-start" aria-labelledby="merge-summary-label">
      <PaneHeader
        label="Summary"
        labelId="merge-summary-label"
        icon={<FileText className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <dl className="grid grid-cols-[1fr_1fr_1.4fr] gap-3 border-b-2 border-ink pb-5 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
              Files
            </dt>
            <dd
              key={readyEntries.length}
              className="wb-stat-tick font-mono text-[17px] font-bold leading-none text-ink tabular-nums sm:text-[20px]"
            >
              {readyEntries.length}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
              Pages
            </dt>
            <dd
              key={totalPages}
              className="wb-stat-tick font-mono text-[17px] font-bold leading-none text-ink tabular-nums sm:text-[20px]"
            >
              {totalPages}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
              Size
            </dt>
            <dd
              key={totalSize}
              className="wb-stat-tick font-mono text-[17px] font-bold leading-none text-ink tabular-nums sm:text-[20px]"
            >
              {formatBytes(totalSize)}
            </dd>
          </div>
        </dl>

        <div className="space-y-2">
          <Label htmlFor="merge-filename" className="text-ink-2">
            Output filename
          </Label>
          <Input
            id="merge-filename"
            value={resolvedFilename}
            onChange={(e) => {
              setFilenameTouched(true);
              setFilename(e.target.value);
            }}
            placeholder="merged.pdf"
            className="h-11 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
            data-testid="filename-input"
          />
        </div>

        {hasEncrypted && (
          <WarningAlert
            warning="Password-protected PDFs may merge as blank pages. Unlock them first."
            className="mt-0"
          />
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleMerge}
            disabled={!canMerge}
            className="wb-btn w-full justify-center py-4 text-[15px]"
            data-testid="merge-button"
          >
            <IconSwap swapKey={isMerging}>
              {isMerging ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>
                    {mergeProgress.done > 0
                      ? `Merging ${mergeProgress.done}/${mergeProgress.total}`
                      : "Merging…"}
                  </span>
                </>
              ) : (
                <>
                  <Layers className="size-4" aria-hidden="true" />
                  <span>Merge &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {readyEntries.length < 2 && !isMerging && (
            <p className="text-center text-[12.5px] text-ink-3">
              {readyEntries.length === 1
                ? "Add at least one more PDF to merge."
                : "Add at least two PDFs to merge."}
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
