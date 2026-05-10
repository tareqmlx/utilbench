import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import {
  Code,
  Download,
  ImageIcon,
  Loader2,
  Pause,
  Play,
  PlayCircle,
  RotateCcw,
  Settings,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Switch } from "../../components/ui/switch";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import {
  buildDotLottie,
  detectFeatures,
  exportAsGif,
  exportFrameAsPng,
  extractMetadata,
  formatDuration,
  formatFileSize,
  generateEmbedCode,
  parseFile,
  validateFile,
} from "./lottie";
import type { LottieJSON } from "./lottie";

type Speed = 1 | 1.5 | 2;
type Background = "white" | "black" | "transparent";

const DEFAULT_PREFS = { speed: 1 as Speed, background: "white" as Background, isLooping: true };

export default function LottiePreviewerRoute() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [animationData, setAnimationData] = useState<LottieJSON | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [prefs, setPrefs] = useToolPreferences("lottie-previewer", DEFAULT_PREFS);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<AnimationItem | null>(null);

  const { copied, copy } = useClipboard();

  const metadata = useMemo(
    () => (animationData && sourceFile ? extractMetadata(animationData, sourceFile) : null),
    [animationData, sourceFile],
  );

  const features = useMemo(
    () => (animationData ? detectFeatures(animationData) : []),
    [animationData],
  );

  const totalFrames = metadata?.totalFrames ?? 0;

  // --- Lottie rendering ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-init when animationData changes; isLooping/speed are synced via separate effects
  useEffect(() => {
    if (!animationData || !containerRef.current) return;

    if (lottieRef.current) {
      lottieRef.current.destroy();
    }

    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: prefs.isLooping,
      autoplay: true,
      animationData: { ...animationData },
    });

    anim.setSpeed(prefs.speed);

    const onEnterFrame = () => {
      setCurrentFrame(Math.floor(anim.currentFrame));
    };
    anim.addEventListener("enterFrame", onEnterFrame);

    lottieRef.current = anim;
    setIsPlaying(true);
    setCurrentFrame(0);

    return () => {
      anim.removeEventListener("enterFrame", onEnterFrame);
      anim.destroy();
      lottieRef.current = null;
    };
  }, [animationData]);

  // Sync loop setting
  useEffect(() => {
    if (lottieRef.current) {
      lottieRef.current.loop = prefs.isLooping;
    }
  }, [prefs.isLooping]);

  // Auto-dismiss warning after 8s
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [warning]);

  // --- File handling ---
  const handleFile = useCallback(async (file: File) => {
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

    try {
      const data = await parseFile(file);
      setSourceFile(file);
      setAnimationData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse animation file.");
    }
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

  // --- Playback controls ---
  const handlePlayPause = useCallback(() => {
    if (!lottieRef.current) return;
    if (isPlaying) {
      lottieRef.current.pause();
    } else {
      lottieRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleReplay = useCallback(() => {
    if (!lottieRef.current) return;
    lottieRef.current.goToAndPlay(0, true);
    setIsPlaying(true);
  }, []);

  const handleSpeedChange = useCallback(
    (newSpeed: Speed) => {
      setPrefs({ speed: newSpeed });
      if (lottieRef.current) {
        lottieRef.current.setSpeed(newSpeed);
      }
    },
    [setPrefs],
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!lottieRef.current || totalFrames === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const frame = Math.floor(ratio * totalFrames);

      if (isPlaying) {
        lottieRef.current.goToAndPlay(frame, true);
      } else {
        lottieRef.current.goToAndStop(frame, true);
      }
      setCurrentFrame(frame);
    },
    [totalFrames, isPlaying],
  );

  // --- Exports ---
  const handleExportFrame = useCallback(async () => {
    if (!containerRef.current || !metadata) return;
    const svg = containerRef.current.querySelector("svg");
    if (!svg) return;

    try {
      const blob = await exportFrameAsPng(svg as SVGSVGElement, metadata.width, metadata.height);
      downloadBlob(blob, "lottie-frame.png");
    } catch {
      setError("Failed to export frame as PNG.");
    }
  }, [metadata]);

  const handleDownloadDotLottie = useCallback(() => {
    if (!animationData) return;
    const blob = buildDotLottie(animationData);
    downloadBlob(blob, "animation.lottie");
  }, [animationData]);

  const handleExportGif = useCallback(async () => {
    if (!containerRef.current || !metadata || !lottieRef.current) return;

    setIsExporting(true);
    const wasPlaying = isPlaying;
    if (wasPlaying) lottieRef.current.pause();

    try {
      const blob = await exportAsGif(
        containerRef.current,
        metadata.width,
        metadata.height,
        metadata.totalFrames,
        lottieRef.current,
      );
      downloadBlob(blob, "animation.gif");
    } catch {
      setError("Failed to export GIF.");
    } finally {
      setIsExporting(false);
      if (wasPlaying && lottieRef.current) {
        lottieRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [metadata, isPlaying]);

  const handleCopyEmbed = useCallback(() => {
    copy(generateEmbedCode());
  }, [copy]);

  const hasFile = animationData !== null;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "c",
          meta: true,
          shift: true,
          handler: () => handleCopyEmbed(),
          enabled: hasFile,
        },
        {
          key: "s",
          meta: true,
          handler: () => handleDownloadDotLottie(),
          enabled: hasFile,
        },
      ],
      [hasFile, handleCopyEmbed, handleDownloadDotLottie],
    ),
  );

  const bgClass =
    prefs.background === "white"
      ? "bg-white"
      : prefs.background === "black"
        ? "bg-slate-900"
        : "bg-[length:20px_20px] [background-image:linear-gradient(45deg,#e2e8f0_25%,transparent_25%,transparent_75%,#e2e8f0_75%),linear-gradient(45deg,#e2e8f0_25%,transparent_25%,transparent_75%,#e2e8f0_75%)] [background-position:0_0,10px_10px]";

  const progressPercent = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;
  const currentTime = metadata ? formatDuration(currentFrame / metadata.frameRate) : "0:00";
  const totalTime = metadata ? formatDuration(metadata.duration) : "0:00";

  return (
    <ToolShell className="flex-1">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Upload / File info */}
          {hasFile ? (
            <div className="flex items-center gap-4 rounded-xl border border-border bg-muted px-6 py-4">
              <Play className="h-8 w-8 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{sourceFile?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {sourceFile ? formatFileSize(sourceFile.size) : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSourceFile(null);
                  setAnimationData(null);
                  setError(null);
                  setCurrentFrame(0);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-4 w-4" />
                Remove
              </Button>
            </div>
          ) : (
            <div
              className={`group flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded bg-muted text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
                <Upload className="h-8 w-8" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-foreground">Drag your animation here</h2>
              <p className="mx-auto mb-6 max-w-xs text-muted-foreground">
                Upload .json or .lottie files to start previewing
              </p>
              <Button
                variant="outline"
                className="border-2 px-8 py-3 text-xs font-black uppercase tracking-widest"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept=".json,.lottie"
            onChange={handleFileInput}
            data-testid="file-input"
          />

          <ErrorAlert error={error} className="mt-0" />

          {warning !== null && (
            <Alert className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}

          {/* Preview panel */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted p-4">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Preview Engine -- SVG Renderer
              </span>
            </div>

            <div
              className={`relative flex aspect-video items-center justify-center overflow-hidden ${bgClass}`}
            >
              {!hasFile && (
                <div className="flex items-center justify-center opacity-20 select-none">
                  <PlayCircle className="h-24 w-24" />
                </div>
              )}
              <div
                ref={containerRef}
                className="absolute inset-0 flex items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full"
              />
            </div>

            <CardContent className="space-y-6 p-6">
              {/* Timeline */}
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                  <span>{currentTime}</span>
                  <span>{totalTime}</span>
                </div>
                <div
                  className="relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-muted"
                  onClick={handleTimelineClick}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const delta = e.key === "ArrowRight" ? 1 : -1;
                      const newFrame = Math.max(0, Math.min(totalFrames, currentFrame + delta));
                      lottieRef.current?.goToAndStop(newFrame, true);
                      setCurrentFrame(newFrame);
                    }
                  }}
                  role="slider"
                  tabIndex={0}
                  aria-valuenow={currentFrame}
                  aria-valuemin={0}
                  aria-valuemax={totalFrames}
                  aria-label="Animation timeline"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-75"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    onClick={handlePlayPause}
                    disabled={!hasFile}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-primary"
                    onClick={handleReplay}
                    disabled={!hasFile}
                    aria-label="Replay"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </Button>
                </div>

                <div className="flex items-center gap-6">
                  {/* Speed */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Speed
                    </span>
                    <div className="flex rounded-md bg-muted p-1">
                      {([1, 1.5, 2] as Speed[]).map((s) => (
                        <Button
                          key={s}
                          variant={prefs.speed === s ? "secondary" : "ghost"}
                          size="sm"
                          className={`h-auto px-2 py-0.5 text-xs font-bold ${prefs.speed === s ? "shadow-sm" : ""}`}
                          onClick={() => handleSpeedChange(s)}
                        >
                          {s}x
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Background */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      Background
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={`h-6 w-6 rounded-full border border-input bg-white ${prefs.background === "white" ? "ring-2 ring-primary ring-offset-2" : ""}`}
                        onClick={() => setPrefs({ background: "white" })}
                        aria-label="White background"
                      />
                      <button
                        type="button"
                        className={`h-6 w-6 rounded-full border border-input bg-slate-900 ${prefs.background === "black" ? "ring-2 ring-primary ring-offset-2" : ""}`}
                        onClick={() => setPrefs({ background: "black" })}
                        aria-label="Black background"
                      />
                      <button
                        type="button"
                        className={`relative h-6 w-6 overflow-hidden rounded-full border border-input bg-transparent ${prefs.background === "transparent" ? "ring-2 ring-primary ring-offset-2" : ""}`}
                        onClick={() => setPrefs({ background: "transparent" })}
                        aria-label="Transparent background"
                      >
                        <div className="absolute inset-0 bg-muted-foreground/30 [mask-image:linear-gradient(45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                        <div className="absolute inset-0 bg-muted-foreground/30 [mask-image:linear-gradient(-45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-primary"
                    title="Export Frame"
                    aria-label="Export frame"
                    onClick={handleExportFrame}
                    disabled={!hasFile}
                  >
                    <ImageIcon className="h-5 w-5" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-primary"
                        title="Settings"
                        aria-label="Settings"
                      >
                        <Settings className="h-5 w-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56">
                      <h5 className="mb-3 text-xs font-black uppercase tracking-widest text-muted-foreground">
                        Settings
                      </h5>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">Loop</span>
                          <Switch
                            checked={prefs.isLooping}
                            onCheckedChange={(v) => setPrefs({ isLooping: v })}
                            aria-label="Toggle loop"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">Renderer</span>
                          <span className="text-sm text-muted-foreground">SVG</span>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6 lg:col-span-4">
          {/* Metadata */}
          <Card className="p-6">
            <h4 className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
              Metadata
            </h4>
            <div className="space-y-4">
              {(
                [
                  ["Filename", metadata?.filename],
                  ["Size", metadata ? formatFileSize(metadata.fileSize) : undefined],
                  [
                    "Dimensions",
                    metadata ? `${metadata.width} × ${metadata.height} px` : undefined,
                  ],
                  ["Frame Rate", metadata ? `${metadata.frameRate} FPS` : undefined],
                  ["Duration", metadata ? `${metadata.duration.toFixed(2)}s` : undefined],
                  ["Version", metadata?.version],
                  ["Name", metadata?.animationName],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-end justify-between border-b border-border pb-2"
                >
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <span className="text-sm font-bold text-foreground">{value ?? "--"}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Features */}
          <Card className="p-6">
            <h4 className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
              Features Found
            </h4>
            {features.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {features.map((f) => (
                  <span
                    key={f.tag}
                    className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${
                      f.level === "warning"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        : "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                    }`}
                  >
                    {f.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {hasFile ? "No special features detected." : "Upload a file to detect features."}
              </p>
            )}
          </Card>

          {/* Actions */}
          <Card className="p-6">
            <h4 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
              Actions
            </h4>
            <div className="space-y-3">
              <Button
                className="w-full text-xs font-bold uppercase tracking-widest"
                onClick={handleDownloadDotLottie}
                disabled={!hasFile}
              >
                <Download className="h-4 w-4" />
                Download .dotLottie
                <KbdHint>⌘S</KbdHint>
              </Button>
              <Button
                variant="secondary"
                className="w-full text-xs font-bold uppercase tracking-widest"
                onClick={handleExportGif}
                disabled={!hasFile || isExporting}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Exporting GIF...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" />
                    Export as GIF
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                className="w-full text-xs font-bold uppercase tracking-widest"
                onClick={handleCopyEmbed}
                disabled={!hasFile}
              >
                <Code className="h-4 w-4" />
                <IconSwap swapKey={copied}>{copied ? "Copied!" : "Get Embed Code"}</IconSwap>
                <KbdHint>⌘⇧C</KbdHint>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </ToolShell>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
