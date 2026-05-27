import {
  Download,
  Eye,
  ImageIcon,
  Loader2,
  Palette,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, WarningAlert } from "../../components/tool-layout";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import { generateFaviconPack, getSizesForFormat, renderPreview, validateFile } from "./favicon";
import type { CornerRounding, ExportFormat } from "./favicon";

const PRESET_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
  { value: "#e2e8f0", label: "Slate" },
];

const ROUNDING_OPTIONS: ReadonlyArray<{ value: CornerRounding; label: string }> = [
  { value: "none", label: "None" },
  { value: "soft", label: "Soft" },
  { value: "circle", label: "Circle" },
];

const DEFAULT_PREFS = {
  backgroundColor: "#ffffff",
  cornerRounding: "none" as CornerRounding,
  exportFormat: "recommended" as ExportFormat,
};

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function FaviconGeneratorRoute() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | undefined>();
  const [prefs, setPrefs] = useToolPreferences("favicon-generator", DEFAULT_PREFS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    if (!imageDataUrl) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const [p16, p180, p192] = await Promise.all([
          renderPreview(imageDataUrl, 16, prefs.backgroundColor, prefs.cornerRounding),
          renderPreview(imageDataUrl, 180, prefs.backgroundColor, prefs.cornerRounding),
          renderPreview(imageDataUrl, 192, prefs.backgroundColor, prefs.cornerRounding),
        ]);
        setPreviewUrls({ 16: p16, 180: p180, 192: p192 });
      } catch {
        // Preview generation failed silently
      }
    }, 250);
  }, [imageDataUrl, prefs.backgroundColor, prefs.cornerRounding]);

  const handleFile = useCallback((file: File) => {
    setError(null);
    setWarning(null);
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error ?? "Unknown error");
      return;
    }
    if (validation.warning) {
      setWarning(validation.warning);
    }

    setSourceFile(file);
    setStatusMessage(`${file.name} loaded, ${formatKb(file.size)}.`);

    if (file.type === "image/svg+xml") {
      const textReader = new FileReader();
      textReader.onload = (e) => setSvgContent(e.target?.result as string);
      textReader.readAsText(file);
    } else {
      setSvgContent(undefined);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setImageDataUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
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
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleRemoveFile = useCallback(() => {
    const previousName = sourceFile?.name;
    setSourceFile(null);
    setImageDataUrl(null);
    setSvgContent(undefined);
    setPreviewUrls({});
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (previousName) setStatusMessage(`Removed ${previousName}.`);
  }, [sourceFile]);

  const handleColorSelect = useCallback(
    (color: string) => {
      setPrefs({ backgroundColor: color });
      setShowColorPicker(false);
    },
    [setPrefs],
  );

  const handleCustomColor = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPrefs({ backgroundColor: e.target.value });
    },
    [setPrefs],
  );

  const handlePaletteClick = useCallback(() => {
    setShowColorPicker(true);
    setTimeout(() => colorInputRef.current?.click(), 0);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!imageDataUrl) return;

    setIsGenerating(true);
    setError(null);
    setStatusMessage("Generating favicon pack.");
    try {
      const blob = await generateFaviconPack(imageDataUrl, {
        backgroundColor: prefs.backgroundColor,
        cornerRounding: prefs.cornerRounding,
        exportFormat: prefs.exportFormat,
        svgContent,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = prefs.exportFormat === "ico-only" ? "favicon.ico" : "favicons.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMessage(`Downloaded ${a.download}.`);
    } catch {
      setError("Failed to generate favicon pack. Please try again.");
      setStatusMessage("");
    } finally {
      setIsGenerating(false);
    }
  }, [imageDataUrl, prefs.backgroundColor, prefs.cornerRounding, prefs.exportFormat, svgContent]);

  const displayedSizes = getSizesForFormat(prefs.exportFormat);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "s",
          meta: true,
          handler: () => handleDownload(),
          enabled: !!imageDataUrl && !isGenerating,
        },
      ],
      [imageDataUrl, isGenerating, handleDownload],
    ),
  );

  const isCustomColor =
    showColorPicker || !PRESET_COLORS.some((c) => c.value === prefs.backgroundColor);

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column — controls */}
        <div className="space-y-6 lg:col-span-7">
          {sourceFile ? (
            <section className="wb-panel wb-item-enter">
              <PaneHeader
                label="Source image"
                icon={<ImageIcon className="size-4" aria-hidden="true" />}
                actions={
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="wb-btn wb-btn--sm wb-btn--ghost"
                    aria-label={`Remove ${sourceFile.name}`}
                  >
                    <X className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                }
              />
              <div className="flex items-center gap-4 p-5 sm:p-6">
                <span className="grid size-12 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper shadow-pop-1">
                  <ImageIcon className="size-5 text-ink" aria-hidden="true" strokeWidth={2.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{sourceFile.name}</p>
                  <p className="font-mono text-[11px] text-ink-3 tabular-nums">
                    {formatKb(sourceFile.size)}
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              aria-label="Drag & Drop Image: drop here, or click to browse"
              className={cn(
                "group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                isDragging
                  ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
                  : "bg-paper shadow-pop-3 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)]",
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <span
                  className="wb-svg-drop-icon grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper shadow-pop-2 group-hover:rotate-[-4deg]"
                  data-dragging={isDragging}
                  aria-hidden="true"
                >
                  <Upload className="size-6 text-ink" strokeWidth={2.5} />
                </span>
                <div className="space-y-1">
                  <p className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                    Drag &amp; Drop Image
                  </p>
                  <p className="text-sm text-ink-2">PNG, JPG, or SVG up to 5 MB</p>
                </div>
                <span
                  aria-hidden="true"
                  className="pointer-events-none mt-1 inline-flex items-center rounded-full border-2 border-ink bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-ink shadow-pop-1 group-hover:bg-lemon"
                >
                  Select File
                </span>
              </div>
            </button>
          )}
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={handleFileInput}
            data-testid="file-input"
          />

          <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
          <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

          {/* Customization */}
          <section className="wb-panel">
            <PaneHeader
              label="Customization"
              icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
            />
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <span id="bg-color-label" className="wb-meta block">
                    Background
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="bg-color-label"
                    className="flex flex-wrap items-center gap-2.5"
                  >
                    {PRESET_COLORS.map((color) => {
                      const active = prefs.backgroundColor === color.value && !showColorPicker;
                      return (
                        <button
                          key={color.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`Background color ${color.value}`}
                          style={{ backgroundColor: color.value }}
                          onClick={() => handleColorSelect(color.value)}
                          className={cn(
                            "h-11 w-11 rounded-md border-2 border-ink shadow-pop-1 transition-[transform,box-shadow] duration-200 sm:h-10 sm:w-10",
                            "hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                            active && "ring-2 ring-tomato ring-offset-2 ring-offset-paper",
                          )}
                        />
                      );
                    })}
                    <div className="relative">
                      <button
                        type="button"
                        // biome-ignore lint/a11y/useSemanticElements: swatch needs 2px ink border + hard offset shadow; native radio can't replicate
                        role="radio"
                        aria-checked={isCustomColor}
                        aria-label="Custom color picker"
                        onClick={handlePaletteClick}
                        style={
                          isCustomColor ? { backgroundColor: prefs.backgroundColor } : undefined
                        }
                        className={cn(
                          "grid h-11 w-11 place-items-center rounded-md border-2 border-ink shadow-pop-1 transition-[transform,box-shadow,background] duration-200 sm:h-10 sm:w-10",
                          "hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                          isCustomColor
                            ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper"
                            : "bg-paper",
                        )}
                      >
                        {!isCustomColor && (
                          <Palette className="size-5 text-ink-2" aria-hidden="true" />
                        )}
                      </button>
                      <input
                        ref={colorInputRef}
                        type="color"
                        value={prefs.backgroundColor}
                        onChange={handleCustomColor}
                        className="invisible absolute left-0 top-full h-0 w-0"
                        tabIndex={-1}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span id="rounding-label" className="wb-meta block">
                    Corner rounding
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="rounding-label"
                    className="grid grid-cols-3 gap-2"
                  >
                    {ROUNDING_OPTIONS.map((opt) => {
                      const active = prefs.cornerRounding === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          // biome-ignore lint/a11y/useSemanticElements: segmented chip needs 2px ink border + tactile hover; native radio can't replicate
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPrefs({ cornerRounding: opt.value })}
                          className={cn(
                            "inline-flex h-11 items-center justify-center rounded-md border-2 border-ink px-3 text-[13px] font-semibold transition-[background,color,transform,box-shadow] duration-200 sm:h-10",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                            active
                              ? "bg-ink text-paper shadow-pop-1"
                              : "bg-paper text-ink shadow-pop-1 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-pop-2",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label
                  htmlFor="export-format"
                  className="wb-meta block normal-case tracking-wider text-ink-3"
                >
                  Export format
                </Label>
                <Select
                  value={prefs.exportFormat}
                  onValueChange={(v) => setPrefs({ exportFormat: v as ExportFormat })}
                >
                  <SelectTrigger
                    id="export-format"
                    className="h-11 border-2 border-ink bg-paper sm:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recommended">Recommended Pack (ICO, PNG, SVG)</SelectItem>
                    <SelectItem value="ico-only">Legacy ICO only</SelectItem>
                    <SelectItem value="modern-only">Modern PNG/SVG only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <button
                type="button"
                onClick={handleDownload}
                disabled={!imageDataUrl || isGenerating}
                className="wb-btn w-full justify-center py-4 text-[15px]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Download className="size-4" aria-hidden="true" />
                    <span>Download Favicon Pack</span>
                    <KbdHint>⌘S</KbdHint>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* Right column — preview */}
        <div className="lg:col-span-5">
          <section className="wb-panel wb-panel--out sticky top-24 flex h-fit flex-col">
            <PaneHeader
              label="Live preview"
              icon={<Eye className="size-4" aria-hidden="true" />}
              className="bg-paper-2"
            />
            <div className="space-y-8 p-5 sm:p-6">
              <div>
                <p className="wb-meta mb-3">Browser Tab (16x16)</p>
                <div className="rounded-t-md border-2 border-ink bg-paper px-3 py-2">
                  <div className="flex items-center gap-2 rounded-md border-2 border-ink bg-paper-2 px-2.5 py-1.5">
                    <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-sm border border-ink bg-paper">
                      {previewUrls[16] ? (
                        <img
                          key={previewUrls[16]}
                          src={previewUrls[16]}
                          alt=""
                          className="wb-fade-in size-full object-cover"
                        />
                      ) : (
                        <span className="size-1.5 rounded-full bg-ink-3" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate text-[11px] font-medium text-ink">My Website</span>
                    <X className="ml-auto size-3 text-ink-3" aria-hidden="true" strokeWidth={2.5} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="wb-meta mb-3">iOS Icon (180x180)</p>
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-ink bg-paper shadow-pop-3">
                    {previewUrls[180] ? (
                      <img
                        key={previewUrls[180]}
                        src={previewUrls[180]}
                        alt=""
                        className="wb-svg-badge size-full object-cover"
                      />
                    ) : (
                      <ImageIcon
                        className="size-8 text-ink-3"
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <p className="wb-meta mb-3">Android (192x192)</p>
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper shadow-pop-3">
                    {previewUrls[192] ? (
                      <img
                        key={previewUrls[192]}
                        src={previewUrls[192]}
                        alt=""
                        className="wb-svg-badge size-full object-cover"
                      />
                    ) : (
                      <ImageIcon
                        className="size-8 text-ink-3"
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="wb-meta">Available dimensions</p>
                <div key={prefs.exportFormat} className="flex flex-wrap gap-2">
                  {displayedSizes.map((size, i) => (
                    <span
                      key={size}
                      style={{ animationDelay: `${i * 35}ms` }}
                      className="wb-item-enter inline-flex items-center rounded-md border-2 border-ink bg-paper px-2 py-1 font-mono text-[11px] font-medium text-ink shadow-pop-1 tabular-nums"
                    >
                      {size}x{size}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </ToolShell>
  );
}
