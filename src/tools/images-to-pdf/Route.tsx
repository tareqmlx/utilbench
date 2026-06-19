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
  FileDown,
  GripVertical,
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
import { cn } from "../../lib/utils";
import {
  type ConvertOptions,
  type FitMode,
  type ImageMeta,
  MAX_QUEUE_SIZE,
  MAX_TOTAL_SIZE,
  type OrientationKey,
  type PageSizeKey,
  buildPdfFilename,
  computeImageLayout,
  downloadBlob,
  imagesToPdf,
  readImageMeta,
  resolvePageSize,
  validateImageFile,
} from "./converter";

interface ImageEntry {
  id: string;
  file: File;
  previewUrl: string;
  meta?: ImageMeta;
  status: "loading" | "ready" | "error";
  error?: string;
  // Batch-local index for the entrance stagger, capped so a large drop never
  // delays the last row by more than ~315ms.
  enterIndex?: number;
}

const MARGIN_MIN = 0;
const MARGIN_MAX = 144;

const PAGE_SIZE_OPTIONS: { value: PageSizeKey; label: string }[] = [
  { value: "match", label: "Match image" },
  { value: "A4", label: "A4" },
  { value: "Letter", label: "Letter" },
  { value: "Legal", label: "Legal" },
  { value: "A3", label: "A3" },
  { value: "A5", label: "A5" },
];

const ORIENTATION_OPTIONS: { value: OrientationKey; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
  { value: "actual", label: "Actual" },
];

const FIT_HELP: Record<FitMode, string> = {
  fit: "Fit the whole image inside the page; may letterbox.",
  fill: "Cover the page; the image edges may be cropped.",
  stretch: "Stretch to fill the page exactly; distorts the image.",
  actual: "Original size at 96 DPI; may exceed the page and get cropped.",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: SegmentedProps<T>) {
  return (
    <fieldset
      className={cn(
        "flex flex-wrap gap-1 rounded-md border-2 border-ink bg-paper-2 p-1",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center rounded-[6px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato sm:min-h-0",
            value === opt.value
              ? "border-2 border-ink bg-lemon text-ink shadow-pop-1"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </fieldset>
  );
}

interface SortableItemProps {
  entry: ImageEntry;
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
    transform: isDragging && baseTransform ? `${baseTransform} scale(1.02)` : baseTransform,
    transition,
    "--enter-i": entry.enterIndex ?? 0,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "wb-item-enter wb-stagger flex items-center gap-2 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1 transition-[box-shadow]",
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
            <StatusBadge tone="neutral" label={`${entry.meta.width}×${entry.meta.height}`} />
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

export default function ImagesToPdfRoute() {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pageSize, setPageSize] = useState<PageSizeKey>("A4");
  const [orientation, setOrientation] = useState<OrientationKey>("auto");
  const [margin, setMargin] = useState(0);
  const [fit, setFit] = useState<FitMode>("fit");
  const [jpegQuality, setJpegQuality] = useState(0.95);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(entries);
  filesRef.current = entries;

  // Revoke every thumbnail object URL on unmount.
  useEffect(() => {
    return () => {
      for (const e of filesRef.current) {
        URL.revokeObjectURL(e.previewUrl);
      }
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const readyEntries = useMemo(() => entries.filter((e) => e.status === "ready"), [entries]);
  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.file.size, 0), [entries]);
  const hasJpeg = useMemo(() => entries.some((e) => e.meta?.format === "jpeg"), [entries]);

  const options = useMemo<ConvertOptions>(
    () => ({ pageSize, orientation, margin, fit, jpegQuality }),
    [pageSize, orientation, margin, fit, jpegQuality],
  );

  // Per-image degenerate-margin check: when the margin leaves no content box for
  // any ready image's resolved page, name the offending file and block convert.
  const degenerateName = useMemo(() => {
    for (const e of readyEntries) {
      if (!e.meta) continue;
      const page = resolvePageSize(options, e.meta);
      const rect = computeImageLayout(e.meta, page, options.margin, options.fit);
      if (!rect) return e.file.name;
    }
    return null;
  }, [readyEntries, options]);

  const readMeta = useCallback(async (entriesToRead: ImageEntry[]) => {
    // Strictly sequential — readImageMeta decodes the bitmap; parallel decodes
    // spike memory on a large burst.
    for (const entry of entriesToRead) {
      try {
        const meta = await readImageMeta(entry.file);
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, meta, status: "ready" as const } : e)),
        );
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not read this image. It may be corrupt.";
        setEntries((prev) =>
          prev.map((item) =>
            item.id === entry.id ? { ...item, status: "error" as const, error: message } : item,
          ),
        );
      }
    }
  }, []);

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
        if (validation.warning) {
          setWarning(validation.warning);
        }
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

      // Cap cumulative input footprint so a stack of large images can't exhaust memory.
      let runningSize = prev.reduce((sum, e) => sum + e.file.size, 0);
      const toAdd: ImageEntry[] = [];
      for (const entry of queueLimited) {
        if (runningSize + entry.file.size > MAX_TOTAL_SIZE) break;
        runningSize += entry.file.size;
        toAdd.push({ ...entry, enterIndex: Math.min(toAdd.length, 7) });
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
    setEntries((prev) => {
      const item = prev.find((e) => e.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        setStatusMessage(`Removed ${item.file.name}.`);
      }
      return prev.filter((e) => e.id !== id);
    });
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

  const canConvert = readyEntries.length >= 1 && !isConverting && degenerateName === null;

  const handleConvert = useCallback(async () => {
    if (isConverting) return;
    setError(null);
    setWarning(null);

    const ready = filesRef.current.filter((e) => e.status === "ready");
    if (ready.length === 0) return;

    if (degenerateName) {
      setError(`Margin is too large for "${degenerateName}" — reduce it.`);
      return;
    }

    const files = ready.map((e) => ({ name: e.file.name, file: e.file }));
    const outName = buildPdfFilename(files.map((f) => ({ name: f.name })));

    setIsConverting(true);
    setProgress({ done: 0, total: files.length });
    setStatusMessage(`Converting ${files.length} images.`);

    try {
      const { bytes, downscaledNames } = await imagesToPdf(files, options, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, outName);
      setStatusMessage(`Created ${outName} (${files.length} pages).`);
      toast.success(
        `Created ${outName} (${files.length} ${files.length === 1 ? "page" : "pages"})`,
      );
      if (downscaledNames.length > 0) {
        setWarning(
          `${downscaledNames.length} image${
            downscaledNames.length === 1 ? " was" : "s were"
          } downscaled to fit canvas limits.`,
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Conversion failed. One of the images may be corrupt or unreadable.",
      );
    } finally {
      setIsConverting(false);
    }
  }, [isConverting, degenerateName, options]);

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
              JPG, PNG, and WebP. Conversion happens in your browser — nothing is uploaded.
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
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

      <section className="wb-panel wb-panel--out" aria-labelledby="images-list-label">
        <PaneHeader
          label="Images"
          labelId="images-list-label"
          icon={<Images className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
          actions={
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
              {readyEntries.length === entries.length
                ? `${entries.length} ${entries.length === 1 ? "Image" : "Images"}`
                : `${readyEntries.length}/${entries.length} Ready`}
            </span>
          }
        />
        <div className="space-y-2 p-3 sm:p-4">
          {entries.length === 0 ? (
            <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
              No images yet. Add some above, then drag to reorder before converting.
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
        </div>
      </section>
    </div>
  );

  const right = (
    <section
      className="wb-panel flex flex-col lg:self-start"
      aria-labelledby="images-options-label"
    >
      <PaneHeader
        label="Page Options"
        labelId="images-options-label"
        icon={<Settings2 className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="page-size" className="text-ink-2">
            Page size
          </Label>
          <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSizeKey)}>
            <SelectTrigger
              id="page-size"
              className="h-11 border-2 border-ink bg-paper sm:h-10"
              data-testid="page-size-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-ink-2">Orientation</Label>
          <Segmented
            options={ORIENTATION_OPTIONS}
            value={orientation}
            onChange={setOrientation}
            ariaLabel="Orientation"
            disabled={pageSize === "match"}
          />
          {pageSize === "match" && (
            <p className="text-[12px] text-ink-3">
              Each page matches its image, so orientation does not apply.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="margin" className="text-ink-2">
              Margin
            </Label>
            <span className="font-mono text-[12px] font-bold tabular-nums text-ink">
              {margin} pt
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              id="margin"
              max={MARGIN_MAX}
              min={MARGIN_MIN}
              step={1}
              value={[margin]}
              onValueChange={([v]) => setMargin(v ?? 0)}
              className="flex-1"
            />
            <Input
              type="number"
              min={MARGIN_MIN}
              max={MARGIN_MAX}
              value={margin}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isNaN(n)) return;
                setMargin(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, Math.round(n))));
              }}
              className="h-11 w-20 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
              data-testid="margin-input"
              aria-label="Margin in points"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-ink-2">Fit</Label>
          <Segmented options={FIT_OPTIONS} value={fit} onChange={setFit} ariaLabel="Fit" />
          <p className="text-[12px] text-ink-3">{FIT_HELP[fit]}</p>
        </div>

        {hasJpeg && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="jpeg-quality" className="text-ink-2">
                JPEG quality
              </Label>
              <span className="font-mono text-[12px] font-bold tabular-nums text-ink">
                {Math.round(jpegQuality * 100)}%
              </span>
            </div>
            <Slider
              id="jpeg-quality"
              max={100}
              min={50}
              step={1}
              value={[Math.round(jpegQuality * 100)]}
              onValueChange={([v]) => setJpegQuality((v ?? 95) / 100)}
            />
            <p className="text-[12px] text-ink-3">Applies to JPEG photos; PNGs stay lossless.</p>
          </div>
        )}

        <div className="space-y-3 border-t-2 border-ink pt-5">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-mono uppercase tracking-wider text-ink-3">Output</span>
            <span className="font-mono font-semibold text-ink tabular-nums">
              {readyEntries.length} {readyEntries.length === 1 ? "page" : "pages"} ·{" "}
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
                    {progress.done > 0
                      ? `Converting ${progress.done}/${progress.total}`
                      : "Converting…"}
                  </span>
                </>
              ) : (
                <>
                  <FileDown className="size-4" aria-hidden="true" />
                  <span>Convert &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {isConverting && progress.total > 0 && (
            // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role for live values, not an operable widget — it is not meant to receive focus
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
          {degenerateName && !isConverting && (
            <p className="text-center text-[12.5px] text-tomato">
              Margin is too large for “{degenerateName}” — reduce it.
            </p>
          )}
          {readyEntries.length === 0 && !isConverting && !degenerateName && (
            <p className="text-center text-[12.5px] text-ink-3">
              Add at least one image to convert.
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
