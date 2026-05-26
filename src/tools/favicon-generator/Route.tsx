import { Download, ImageIcon, Loader2, Palette, TriangleAlert, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
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
import { generateFaviconPack, getSizesForFormat, renderPreview, validateFile } from "./favicon";
import type { CornerRounding, ExportFormat } from "./favicon";

const PRESET_COLORS = [{ value: "#ffffff" }, { value: "#000000" }, { value: "#e2e8f0" }];

const DEFAULT_PREFS = {
  backgroundColor: "#ffffff",
  cornerRounding: "none" as CornerRounding,
  exportFormat: "recommended" as ExportFormat,
};

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Auto-dismiss warning after 8s
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  // Regenerate previews when options change
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

    // Read SVG content if applicable
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
    setSourceFile(null);
    setImageDataUrl(null);
    setSvgContent(undefined);
    setPreviewUrls({});
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

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
    // Slight delay to ensure the input is rendered
    setTimeout(() => colorInputRef.current?.click(), 0);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!imageDataUrl) return;

    setIsGenerating(true);
    setError(null);
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
    } catch {
      setError("Failed to generate favicon pack. Please try again.");
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

  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Card className="p-4 sm:p-8">
            <h2 className="mb-4 text-lg font-bold">Upload Image</h2>

            {sourceFile ? (
              <div className="flex items-center gap-4 rounded-xl border border-border bg-muted px-6 py-4">
                <ImageIcon className="h-8 w-8 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{sourceFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(sourceFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveFile}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            ) : (
              <div
                className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-all sm:py-16 ${
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-primary hover:bg-primary/5"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Upload className="mb-4 h-12 w-12 text-muted-foreground group-hover:text-primary" />
                <p className="text-lg font-bold">Drag &amp; Drop Image</p>
                <p className="mb-6 text-sm text-muted-foreground">
                  Support for PNG, JPG, or SVG (Max 5MB)
                </p>
                <Button onClick={() => fileInputRef.current?.click()}>Select File</Button>
                <input
                  ref={fileInputRef}
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={handleFileInput}
                  data-testid="file-input"
                />
              </div>
            )}

            <ErrorAlert error={error} />

            {warning !== null && (
              <output className="block mt-4 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-lemon px-4 py-3 shadow-pop-2">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={2.5} />
                <p className="font-mono text-[13px] leading-relaxed text-ink">{warning}</p>
              </output>
            )}
          </Card>

          <Card className="p-4 sm:p-8">
            <h2 className="mb-6 text-lg font-bold">Customization Options</h2>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="space-y-4">
                <span className="block text-sm font-semibold text-foreground">
                  Background Color
                </span>
                <div className="flex items-center gap-3">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`h-10 w-10 cursor-pointer rounded border-2 border-ink ${
                        prefs.backgroundColor === color.value && !showColorPicker
                          ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper"
                          : ""
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => handleColorSelect(color.value)}
                      aria-label={`Background color ${color.value}`}
                    />
                  ))}
                  <div className="relative">
                    <button
                      type="button"
                      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded border border-input ${
                        showColorPicker ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={handlePaletteClick}
                      aria-label="Custom color picker"
                      style={
                        showColorPicker ? { backgroundColor: prefs.backgroundColor } : undefined
                      }
                    >
                      {!showColorPicker && <Palette className="h-5 w-5 text-muted-foreground" />}
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

              <div className="space-y-4">
                <span className="block text-sm font-semibold text-foreground">Corner Rounding</span>
                <div className="flex gap-2">
                  <Button
                    variant={prefs.cornerRounding === "none" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setPrefs({ cornerRounding: "none" })}
                  >
                    None
                  </Button>
                  <Button
                    variant={prefs.cornerRounding === "soft" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setPrefs({ cornerRounding: "soft" })}
                  >
                    Soft
                  </Button>
                  <Button
                    variant={prefs.cornerRounding === "circle" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 !rounded-full"
                    onClick={() => setPrefs({ cornerRounding: "circle" })}
                  >
                    Circle
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Label>Export Format</Label>
                <Select
                  value={prefs.exportFormat}
                  onValueChange={(v) => setPrefs({ exportFormat: v as ExportFormat })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recommended">Recommended Pack (ICO, PNG, SVG)</SelectItem>
                    <SelectItem value="ico-only">Legacy ICO only</SelectItem>
                    <SelectItem value="modern-only">Modern PNG/SVG only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  className="w-full font-bold"
                  size="lg"
                  onClick={handleDownload}
                  disabled={!imageDataUrl || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating favicon pack...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download Favicon Pack
                      <KbdHint>⌘S</KbdHint>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <div className="sticky top-24 rounded-xl border border-border bg-muted p-4 sm:p-8">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-lg font-bold">Real-time Preview</h2>
              <div className="flex gap-2" aria-hidden="true">
                <div className="h-3 w-3 rounded-full border border-ink bg-tomato" />
                <div className="h-3 w-3 rounded-full border border-ink bg-lemon" />
                <div className="h-3 w-3 rounded-full border border-ink bg-mint" />
              </div>
            </div>

            <div className="space-y-10">
              <div>
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Browser Tab (16x16)
                </p>
                <div className="flex items-center gap-3 rounded-t-lg border border-border bg-card p-3">
                  <div className="flex w-48 items-center gap-2 rounded border border-border bg-muted px-3 py-1.5 text-xs">
                    <div className="flex size-4 items-center justify-center overflow-hidden rounded-sm bg-primary/20">
                      {previewUrls[16] ? (
                        <img src={previewUrls[16]} alt="16x16 preview" className="size-4" />
                      ) : (
                        <div className="size-3 rounded-sm bg-primary" />
                      )}
                    </div>
                    <span className="truncate">My Website</span>
                    <X className="ml-auto h-3 w-3" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    iOS Icon (180x180)
                  </p>
                  <div className="flex aspect-square w-24 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
                    {previewUrls[180] ? (
                      <img
                        src={previewUrls[180]}
                        alt="180x180 preview"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-16 items-center justify-center rounded-lg bg-primary text-3xl font-bold text-primary-foreground">
                        U
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Android (192x192)
                  </p>
                  <div className="flex aspect-square w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-card shadow-xl">
                    {previewUrls[192] ? (
                      <img
                        src={previewUrls[192]}
                        alt="192x192 preview"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-16 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
                        U
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Available Dimensions
                </p>
                <div className="flex flex-wrap gap-2">
                  {displayedSizes.map((size) => (
                    <span
                      key={size}
                      className="rounded border border-border bg-card px-2 py-1 text-[10px] font-bold"
                    >
                      {size}x{size}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
