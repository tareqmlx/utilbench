import {
  CircleAlert,
  Download,
  FileText,
  ImageUp,
  Loader2,
  Lock,
  Stamp,
  Type,
  Upload,
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
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";
import {
  type Anchor,
  type PageTarget,
  type PdfMeta,
  type StandardFontName,
  type WatermarkConfig,
  type WatermarkKind,
  applyWatermark,
  buildWatermarkedFilename,
  countTargetPages,
  downloadBlob,
  getPdfMeta,
  parsePageRanges,
  prepareImageBytes,
  readFileBytes,
  rgb,
  validatePdfFile,
  validateWinAnsi,
} from "./watermarker";

interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  meta: PdfMeta;
}

interface LoadedImage {
  file: File;
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  previewUrl: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Hex color (#rrggbb) → pdf-lib rgb() with channels in 0..1. */
function hexToRgb(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const value = m?.[1] ?? "ff0000";
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

const FONTS: Array<{ id: StandardFontName; label: string }> = [
  { id: "Helvetica", label: "Helvetica" },
  { id: "HelveticaBold", label: "Helvetica Bold" },
  { id: "TimesRoman", label: "Times Roman" },
  { id: "Courier", label: "Courier" },
];

const ANCHORS: Anchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const ANCHOR_LABELS: Record<Anchor, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-left": "Middle left",
  center: "Center",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

export default function WatermarkPdfRoute() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [kind, setKind] = useState<WatermarkKind>("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [fontName, setFontName] = useState<StandardFontName>("HelveticaBold");
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState("#ff0000");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [scale, setScale] = useState(0.4);
  const [opacity, setOpacity] = useState(0.2);
  const [rotation, setRotation] = useState(-45);
  const [layout, setLayout] = useState<"single" | "tile">("tile");
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [tileGap, setTileGap] = useState(80);
  const [pageMode, setPageMode] = useState<"all" | "ranges">("all");
  const [rangeSpec, setRangeSpec] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const pageCount = pdf?.meta.pageCount ?? 0;
  const encrypted = pdf?.meta.encrypted ?? false;

  // Revoke the image object URL on unmount (replacements revoke inline).
  const previewUrl = image?.previewUrl;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Live WinAnsi validation for text mode.
  const winAnsi = useMemo(() => validateWinAnsi(text, fontName), [text, fontName]);
  const textEmpty = text.trim() === "";
  const textValid = !textEmpty && winAnsi.ok;

  // Range targeting preview (ranges mode only).
  const rangeResult = useMemo(
    () => (pageCount > 0 ? parsePageRanges(rangeSpec, pageCount) : { ranges: [] }),
    [rangeSpec, pageCount],
  );
  const targetCount = useMemo(() => {
    if (pageCount === 0) return 0;
    if (pageMode === "all") return pageCount;
    return countTargetPages(rangeSpec, pageCount);
  }, [pageMode, rangeSpec, pageCount]);
  const rangeError =
    pageMode === "ranges" && rangeSpec.trim() !== "" ? rangeResult.error : undefined;

  const canApply =
    status === "ready" &&
    !encrypted &&
    !isApplying &&
    opacity > 0 &&
    (pageMode === "all" || (!rangeError && targetCount > 0)) &&
    (kind === "text" ? textValid : image !== null);

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
      if (isApplying) return;
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isApplying],
  );

  // ── Image dropzone ──
  const loadImage = useCallback(async (file: File) => {
    setImageError(null);
    try {
      const { bytes, type } = await prepareImageBytes(file);
      const previewUrl = URL.createObjectURL(file);
      setImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, bytes, type, previewUrl };
      });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Couldn't process this image.");
    }
  }, []);

  const handleImageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void loadImage(file);
      if (imageInputRef.current) imageInputRef.current.value = "";
    },
    [loadImage],
  );

  const handleImageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsImageDragging(false);
      if (isApplying) return;
      const file = e.dataTransfer.files[0];
      if (file) void loadImage(file);
    },
    [loadImage, isApplying],
  );

  const handleApply = useCallback(async () => {
    if (!pdf || !canApply) return;
    setIsApplying(true);
    setError(null);
    setProgress({ done: 0, total: targetCount });
    setStatusMessage("Stamping the PDF.");

    const onProgress = (done: number, total: number) => setProgress({ done, total });

    try {
      let config: WatermarkConfig;
      if (kind === "text") {
        config = {
          kind: "text",
          text,
          fontName,
          fontSize,
          color: hexToRgb(color),
          opacity,
          rotation,
          layout,
          anchor,
          tileGap,
        };
      } else {
        if (!image) return;
        config = {
          kind: "image",
          imageBytes: image.bytes,
          imageType: image.type,
          scale,
          opacity,
          rotation,
          layout,
          anchor,
          tileGap,
        };
      }

      const target: PageTarget =
        pageMode === "all" ? { mode: "all" } : { mode: "ranges", spec: rangeSpec };

      const bytes = await applyWatermark(pdf.bytes, config, target, { onProgress });
      const filename = buildWatermarkedFilename(pdf.file.name);
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
      setStatusMessage(`Saved ${filename}.`);
      toast.success(`Watermarked → ${filename}`);
    } catch (err) {
      // applyWatermark throws actionable messages (too many tiles, encrypted,
      // unrenderable char). Surface them instead of a blanket "corrupt" message,
      // which misleads when the PDF is fine and the fix is a config change.
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Watermarking failed. The PDF may be corrupt or unreadable.",
      );
    } finally {
      setIsApplying(false);
    }
  }, [
    pdf,
    canApply,
    targetCount,
    kind,
    text,
    fontName,
    fontSize,
    color,
    image,
    scale,
    opacity,
    rotation,
    layout,
    anchor,
    tileGap,
    pageMode,
    rangeSpec,
  ]);

  useKeyboardShortcut(
    useMemo(
      () => [{ key: "Enter", meta: true, handler: () => handleApply(), enabled: canApply }],
      [canApply, handleApply],
    ),
  );

  const disabled = status !== "ready" || isApplying;

  const left = (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isApplying}
        aria-label="Add a PDF: drop here, or click to browse"
        className={cn(
          "wb-lift-hover group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-60 sm:p-10",
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
              Watermarking happens in your browser — nothing is uploaded.
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

      <section className="wb-panel wb-panel--out" aria-labelledby="wm-file-label">
        <PaneHeader
          label="File"
          labelId="wm-file-label"
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
            <div className="wb-item-enter flex items-center gap-2 rounded-md border-2 border-ink bg-paper p-2.5 shadow-pop-1">
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
          {encrypted && (
            <WarningAlert
              warning="This PDF is password-protected and can't be watermarked. Unlock it first."
              className="mt-0"
            />
          )}
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-ink-3">
            This adds a visible overlay; it does not burn the mark into the page or remove existing
            content. Watermarking re-saves the file, which invalidates any existing digital
            signature.
          </p>
        </div>
      </section>
    </div>
  );

  const right = (
    <section className="wb-panel flex flex-col lg:self-start" aria-labelledby="wm-options-label">
      <PaneHeader
        label="Watermark"
        labelId="wm-options-label"
        icon={<Stamp className="size-4" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        {/* Mode tabs: Text | Image */}
        <fieldset
          className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0"
          aria-label="Watermark type"
          data-testid="kind-selector"
        >
          {(
            [
              { id: "text", label: "Text", icon: Type },
              { id: "image", label: "Image", icon: ImageUp },
            ] as const
          ).map((m) => {
            const Icon = m.icon;
            const active = kind === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setKind(m.id)}
                aria-pressed={active}
                disabled={disabled}
                data-testid={`kind-${m.id}`}
                className={cn(
                  "wb-lift-hover flex min-h-11 items-center justify-center gap-1.5 rounded-md border-2 border-ink px-2 py-3 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 sm:min-h-10",
                  active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </fieldset>

        {/* Text controls */}
        {kind === "text" && (
          <div className="wb-fade-in space-y-5">
            <div className="space-y-2">
              <Label htmlFor="wm-text" className="text-ink-2">
                Watermark text
              </Label>
              <Input
                id="wm-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="CONFIDENTIAL"
                disabled={disabled}
                aria-invalid={!winAnsi.ok || undefined}
                aria-describedby={
                  !winAnsi.ok && winAnsi.badChar
                    ? "wm-text-error"
                    : textEmpty
                      ? "wm-text-hint"
                      : undefined
                }
                className="h-11 border-2 border-ink bg-paper text-[14px] sm:h-10"
                data-testid="text-input"
              />
              {!winAnsi.ok && winAnsi.badChar ? (
                <p
                  id="wm-text-error"
                  className="flex items-start gap-2 text-[12px] font-semibold text-ink"
                  data-testid="text-error"
                >
                  <CircleAlert className="mt-px size-3.5 shrink-0 text-tomato" aria-hidden="true" />
                  The character &ldquo;{winAnsi.badChar}&rdquo; can&rsquo;t be drawn with a standard
                  PDF font. Remove it or pick different text.
                </p>
              ) : textEmpty ? (
                <p id="wm-text-hint" className="text-[12px] text-ink-3">
                  Enter some text to stamp onto the page.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="wm-font" className="text-ink-2">
                  Font
                </Label>
                <select
                  id="wm-font"
                  value={fontName}
                  onChange={(e) => setFontName(e.target.value as StandardFontName)}
                  disabled={disabled}
                  className="h-11 w-full rounded-md border-2 border-ink bg-paper px-3 text-[14px] text-ink shadow-pop-1 sm:h-10"
                  data-testid="font-select"
                >
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wm-font-size" className="text-ink-2">
                  Font size
                </Label>
                <Input
                  id="wm-font-size"
                  type="number"
                  min={8}
                  max={200}
                  value={fontSize}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) setFontSize(Math.min(200, Math.max(8, v)));
                  }}
                  disabled={disabled}
                  className="h-11 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
                  data-testid="font-size-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wm-color" className="text-ink-2">
                Color
              </Label>
              <div className="flex items-center gap-3">
                <input
                  id="wm-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={disabled}
                  className="h-11 w-16 cursor-pointer rounded-md border-2 border-ink bg-paper shadow-pop-1 sm:h-10"
                  data-testid="color-input"
                />
                <span className="font-mono text-[13px] text-ink-2 tabular-nums">{color}</span>
              </div>
            </div>
          </div>
        )}

        {/* Image controls */}
        {kind === "image" && (
          <div className="wb-fade-in space-y-4">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsImageDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsImageDragging(false);
              }}
              onDrop={handleImageDrop}
              disabled={disabled}
              aria-label="Add a watermark image: drop here, or click to browse"
              className={cn(
                "wb-lift-hover block w-full rounded-[14px] border-2 border-ink p-5 text-center transition-[background,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-50",
                isImageDragging
                  ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
                  : "bg-paper shadow-pop-2 hover:bg-lemon",
              )}
            >
              {image ? (
                <div className="flex items-center gap-3 text-left">
                  <img
                    src={image.previewUrl}
                    alt="Watermark preview"
                    className="size-14 shrink-0 rounded-md border-2 border-ink bg-paper-2 object-contain"
                    data-testid="image-preview"
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-[13px] font-semibold text-ink"
                      title={image.file.name}
                    >
                      {image.file.name}
                    </p>
                    <p className="font-mono text-[11px] text-ink-3">{image.type}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-2">
                  <ImageUp className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
                  <p className="text-[13px] font-semibold text-ink">
                    Drop a PNG/JPG/WebP or browse
                  </p>
                </div>
              )}
            </button>
            <input
              ref={imageInputRef}
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={handleImageInput}
              data-testid="image-input"
            />
            <ErrorAlert error={imageError} className="mt-0" onDismiss={() => setImageError(null)} />

            <div className="space-y-2">
              <Label htmlFor="wm-scale" className="flex justify-between text-ink-2">
                <span>Size</span>
                <span className="font-mono tabular-nums">{Math.round(scale * 100)}% of width</span>
              </Label>
              <input
                id="wm-scale"
                type="range"
                min={5}
                max={100}
                value={Math.round(scale * 100)}
                onChange={(e) => setScale(Number.parseInt(e.target.value, 10) / 100)}
                disabled={disabled}
                className="w-full accent-tomato"
                data-testid="scale-input"
              />
            </div>
            <p className="px-1 text-[12px] leading-relaxed text-ink-3">
              PNG transparency is preserved; a JPG paints its full rectangle. The opacity slider
              applies on top of either.
            </p>
          </div>
        )}

        {/* Shared controls */}
        <div className="space-y-5 border-t-2 border-ink/15 pt-5">
          <div className="space-y-2">
            <Label htmlFor="wm-opacity" className="flex justify-between text-ink-2">
              <span>Opacity</span>
              <span className="font-mono tabular-nums">{Math.round(opacity * 100)}%</span>
            </Label>
            <input
              id="wm-opacity"
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number.parseInt(e.target.value, 10) / 100)}
              disabled={disabled}
              className="w-full accent-tomato"
              data-testid="opacity-input"
            />
            {opacity === 0 && (
              <p className="text-[12px] text-ink-3">Watermark would be invisible at 0% opacity.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wm-rotation" className="flex justify-between text-ink-2">
              <span>Rotation</span>
              <span className="font-mono tabular-nums">{rotation}°</span>
            </Label>
            <input
              id="wm-rotation"
              type="range"
              min={-180}
              max={180}
              value={rotation}
              onChange={(e) => setRotation(Number.parseInt(e.target.value, 10))}
              disabled={disabled}
              className="w-full accent-tomato"
              data-testid="rotation-input"
            />
          </div>

          {/* Layout: Single | Tile */}
          <div className="space-y-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
              Layout
            </span>
            <fieldset
              className="m-0 grid grid-cols-2 gap-2 border-0 p-0"
              aria-label="Layout"
              data-testid="layout-selector"
            >
              {(["single", "tile"] as const).map((l) => {
                const active = layout === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLayout(l)}
                    aria-pressed={active}
                    disabled={disabled}
                    data-testid={`layout-${l}`}
                    className={cn(
                      "wb-lift-hover min-h-11 rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold capitalize shadow-pop-1 transition-[background,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 sm:min-h-10",
                      active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    {l}
                  </button>
                );
              })}
            </fieldset>
          </div>

          {layout === "tile" && (
            <div className="wb-fade-in space-y-2">
              <Label htmlFor="wm-tile-gap" className="flex justify-between text-ink-2">
                <span>Tile gap</span>
                <span className="font-mono tabular-nums">{tileGap}pt</span>
              </Label>
              <input
                id="wm-tile-gap"
                type="range"
                min={0}
                max={300}
                value={tileGap}
                onChange={(e) => setTileGap(Number.parseInt(e.target.value, 10))}
                disabled={disabled}
                className="w-full accent-tomato"
                data-testid="tile-gap-input"
              />
            </div>
          )}

          {layout === "single" && (
            <div className="wb-fade-in space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
                Position
              </span>
              <fieldset
                className="m-0 grid grid-cols-3 gap-1.5 border-0 p-0"
                aria-label="Position"
                data-testid="anchor-grid"
              >
                {ANCHORS.map((a) => {
                  const active = anchor === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAnchor(a)}
                      aria-pressed={active}
                      aria-label={ANCHOR_LABELS[a]}
                      disabled={disabled}
                      data-testid={`anchor-${a}`}
                      className={cn(
                        "aspect-square rounded-md border-2 border-ink transition-[background] duration-150 disabled:pointer-events-none disabled:opacity-50",
                        active ? "bg-lemon shadow-pop-1" : "bg-paper hover:bg-paper-2",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mx-auto block size-2 rounded-full",
                          active ? "bg-ink" : "bg-ink-3",
                        )}
                      />
                    </button>
                  );
                })}
              </fieldset>
            </div>
          )}
        </div>

        {/* Page targeting */}
        <div className="space-y-3 border-t-2 border-ink/15 pt-5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Pages</span>
          <fieldset
            className="m-0 grid grid-cols-2 gap-2 border-0 p-0"
            aria-label="Page targeting"
            data-testid="page-mode-selector"
          >
            {(
              [
                { id: "all", label: "All pages" },
                { id: "ranges", label: "Specific pages" },
              ] as const
            ).map((m) => {
              const active = pageMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPageMode(m.id)}
                  aria-pressed={active}
                  disabled={disabled}
                  data-testid={`page-mode-${m.id}`}
                  className={cn(
                    "wb-lift-hover min-h-11 rounded-md border-2 border-ink px-2 py-2.5 text-[13px] font-semibold shadow-pop-1 transition-[background,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 sm:min-h-10",
                    active ? "bg-lemon text-ink" : "bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </fieldset>

          {pageMode === "ranges" && (
            <div className="wb-fade-in space-y-2">
              <Input
                aria-label="Page ranges"
                value={rangeSpec}
                onChange={(e) => setRangeSpec(e.target.value)}
                placeholder="e.g. 1-3, 5, 8-10"
                disabled={disabled}
                aria-invalid={rangeError ? true : undefined}
                aria-describedby={rangeError ? "wm-range-error" : undefined}
                className="h-11 border-2 border-ink bg-paper font-mono text-[14px] sm:h-10"
                data-testid="range-input"
              />
              {rangeError ? (
                <p
                  id="wm-range-error"
                  className="flex items-start gap-2 text-[12px] font-semibold text-ink"
                  data-testid="range-error"
                >
                  <CircleAlert className="mt-px size-3.5 shrink-0 text-tomato" aria-hidden="true" />
                  {rangeError}
                </p>
              ) : null}
            </div>
          )}

          {status === "ready" && (
            <output
              key={targetCount}
              className="wb-stat-tick block rounded-md border-2 border-ink bg-paper-2 px-4 py-2.5 font-mono text-[13px] font-bold text-ink tabular-nums"
              data-testid="page-preview"
            >
              → stamps {targetCount} {targetCount === 1 ? "page" : "pages"}
            </output>
          )}
        </div>

        {/* Apply */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="wb-btn w-full justify-center py-4 text-[15px]"
            data-testid="apply-button"
          >
            <IconSwap swapKey={isApplying}>
              {isApplying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>
                    {progress.total > 0
                      ? `Stamping ${progress.done}/${progress.total}`
                      : "Stamping…"}
                  </span>
                </>
              ) : (
                <>
                  <Download className="size-4" aria-hidden="true" />
                  <span>Stamp &amp; Download</span>
                  <KbdHint>⌘⏎</KbdHint>
                </>
              )}
            </IconSwap>
          </button>
          {isApplying && progress.total > 0 && (
            // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role for live values, not an operable widget — it is not meant to receive focus
            <div
              className="wb-fade-in h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-paper-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label={`Stamping pages, ${progress.done} of ${progress.total} done`}
            >
              <div
                className="h-full origin-left bg-tomato transition-transform duration-200 ease-out motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress.done / progress.total})` }}
              />
            </div>
          )}
          {status !== "ready" && !isApplying && (
            <p className="text-center text-[12.5px] text-ink-3">Upload a PDF to watermark it.</p>
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
