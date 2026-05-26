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
import { Button } from "../../components/ui/button";
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
      ? "bg-[#ffffff]"
      : prefs.background === "black"
        ? "bg-[#0a0905]"
        : "bg-[length:20px_20px] [background-image:linear-gradient(45deg,#e5dcc7_25%,transparent_25%,transparent_75%,#e5dcc7_75%),linear-gradient(45deg,#e5dcc7_25%,transparent_25%,transparent_75%,#e5dcc7_75%)] [background-position:0_0,10px_10px]";

  const progressRatio = totalFrames > 0 ? Math.min(1, currentFrame / totalFrames) : 0;
  const currentTime = metadata ? formatDuration(currentFrame / metadata.frameRate) : "0:00";
  const totalTime = metadata ? formatDuration(metadata.duration) : "0:00";
  const timelineMax = totalFrames > 0 ? totalFrames - 1 : 0;

  return (
    <ToolShell className="flex-1">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Upload / File info */}
          {hasFile ? (
            <div className="flex items-center gap-4 rounded-lg border-2 border-ink bg-paper-2 px-5 py-4 shadow-pop-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border-2 border-ink bg-mint">
                <Play className="size-5 text-ink" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{sourceFile?.name}</p>
                <p className="wb-mono-sm">{sourceFile ? formatFileSize(sourceFile.size) : ""}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSourceFile(null);
                  setAnimationData(null);
                  setError(null);
                  setCurrentFrame(0);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="wb-chip"
                aria-label="Remove file"
              >
                <X className="size-3.5" />
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`group flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${
                isDragging ? "border-tomato bg-lemon/40" : "border-ink bg-paper-2 hover:bg-lemon/30"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="mb-5 grid size-16 place-items-center rounded-md border-2 border-ink bg-pink shadow-pop-2 transition-transform group-hover:-translate-y-0.5">
                <Upload className="size-7 text-ink" />
              </div>
              <span className="wb-h3 mb-2 block">Drag your animation here</span>
              <p className="mx-auto mb-6 max-w-xs text-sm text-ink-2">
                Upload .json or .lottie files to start previewing.
              </p>
              <span className="wb-btn wb-btn--sm wb-btn--ghost pointer-events-none">
                Browse Files
              </span>
            </button>
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
            <output className="wb-fade-in flex items-start gap-3 rounded-md border-2 border-ink bg-lemon px-4 py-3 shadow-pop-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-ink" />
              <p className="text-sm text-ink">{warning}</p>
            </output>
          )}

          {/* Preview panel */}
          <div className="wb-panel">
            <div className="flex items-center justify-between border-b-2 border-ink bg-paper-2 px-5 py-3">
              <span className="wb-meta">Preview</span>
              <span className="wb-mono-sm uppercase tracking-[0.18em]">SVG renderer</span>
            </div>

            <div
              className={`relative flex aspect-video items-center justify-center overflow-hidden ${bgClass}`}
            >
              {!hasFile && (
                <div className="flex items-center justify-center text-ink/15 select-none">
                  <PlayCircle className="size-24" />
                </div>
              )}
              <div
                ref={containerRef}
                className="absolute inset-0 flex items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full"
              />
            </div>

            <div className="space-y-6 border-t-2 border-ink p-6">
              {/* Timeline */}
              <div className="space-y-2">
                <div className="flex justify-between font-mono text-[11px] font-medium text-ink-3 tracking-[0.08em]">
                  <span>{currentTime}</span>
                  <span>{totalTime}</span>
                </div>
                <div
                  className="relative h-2 w-full cursor-pointer overflow-hidden rounded-full border-2 border-ink bg-paper"
                  onClick={handleTimelineClick}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const delta = e.key === "ArrowRight" ? 1 : -1;
                      const newFrame = Math.max(0, Math.min(timelineMax, currentFrame + delta));
                      lottieRef.current?.goToAndStop(newFrame, true);
                      setCurrentFrame(newFrame);
                    }
                  }}
                  role="slider"
                  tabIndex={0}
                  aria-valuenow={currentFrame}
                  aria-valuemin={0}
                  aria-valuemax={timelineMax}
                  aria-label="Animation timeline"
                >
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left bg-tomato"
                    style={{ transform: `scaleX(${progressRatio})` }}
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
                    {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                    onClick={handleReplay}
                    disabled={!hasFile}
                    aria-label="Replay"
                  >
                    <RotateCcw className="size-5" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* Speed */}
                  <div className="flex items-center gap-3">
                    <span className="wb-meta">Speed</span>
                    <div className="flex items-center gap-1">
                      {([1, 1.5, 2] as Speed[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`wb-chip px-3 py-1 text-[12px] font-semibold ${prefs.speed === s ? "on" : ""}`}
                          onClick={() => handleSpeedChange(s)}
                          aria-pressed={prefs.speed === s}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Background */}
                  <div className="flex items-center gap-3">
                    <span className="wb-meta">Background</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={`size-6 rounded-full border-2 border-ink bg-[#ffffff] transition-shadow ${prefs.background === "white" ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper" : ""}`}
                        onClick={() => setPrefs({ background: "white" })}
                        aria-label="White background"
                        aria-pressed={prefs.background === "white"}
                      />
                      <button
                        type="button"
                        className={`size-6 rounded-full border-2 border-ink bg-[#0a0905] transition-shadow ${prefs.background === "black" ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper" : ""}`}
                        onClick={() => setPrefs({ background: "black" })}
                        aria-label="Black background"
                        aria-pressed={prefs.background === "black"}
                      />
                      <button
                        type="button"
                        className={`relative size-6 overflow-hidden rounded-full border-2 border-ink bg-paper transition-shadow ${prefs.background === "transparent" ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper" : ""}`}
                        onClick={() => setPrefs({ background: "transparent" })}
                        aria-label="Transparent background"
                        aria-pressed={prefs.background === "transparent"}
                      >
                        <div className="absolute inset-0 bg-ink/20 [mask-image:linear-gradient(45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                        <div className="absolute inset-0 bg-ink/20 [mask-image:linear-gradient(-45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                    title="Export Frame"
                    aria-label="Export frame"
                    onClick={handleExportFrame}
                    disabled={!hasFile}
                  >
                    <ImageIcon className="size-5" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                        title="Settings"
                        aria-label="Settings"
                      >
                        <Settings className="size-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-56 border-2 border-ink bg-paper shadow-pop-3"
                    >
                      <h5 className="wb-meta mb-3">Settings</h5>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink">Loop</span>
                          <Switch
                            checked={prefs.isLooping}
                            onCheckedChange={(v) => setPrefs({ isLooping: v })}
                            aria-label="Toggle loop"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink">Renderer</span>
                          <span className="wb-mono-sm">SVG</span>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6 lg:col-span-4">
          {/* Metadata */}
          <section className="wb-panel p-6">
            <h4 className="wb-meta mb-5">Metadata</h4>
            <dl className="space-y-3">
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
                  className="flex items-baseline justify-between gap-4 border-b border-ink/15 pb-2 last:border-b-0 last:pb-0"
                >
                  <dt className="text-xs font-medium text-ink-3">{label}</dt>
                  <dd className="truncate text-right text-sm font-semibold text-ink">
                    {value ?? "--"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Features */}
          <section className="wb-panel p-6">
            <h4 className="wb-meta mb-5">Features found</h4>
            {features.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {features.map((f) => (
                  <span
                    key={f.tag}
                    className={`inline-flex items-center rounded-md border-2 border-ink px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ${
                      f.level === "warning" ? "bg-lemon" : "bg-mint"
                    } text-ink`}
                  >
                    {f.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-2">
                {hasFile ? "No special features detected." : "Upload a file to detect features."}
              </p>
            )}
          </section>

          {/* Actions */}
          <section className="wb-panel p-6">
            <h4 className="wb-meta mb-4">Actions</h4>
            <div className="space-y-3">
              <button
                type="button"
                className="wb-btn w-full justify-center"
                onClick={handleDownloadDotLottie}
                disabled={!hasFile}
              >
                <Download className="size-4" />
                Download .dotLottie
                <KbdHint>⌘S</KbdHint>
              </button>
              <button
                type="button"
                className="wb-btn wb-btn--ghost w-full justify-center"
                onClick={handleExportGif}
                disabled={!hasFile || isExporting}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Exporting GIF...
                  </>
                ) : (
                  <>
                    <ImageIcon className="size-4" />
                    Export as GIF
                  </>
                )}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn--lemon w-full justify-center"
                onClick={handleCopyEmbed}
                disabled={!hasFile}
              >
                <Code className="size-4" />
                <IconSwap swapKey={copied}>{copied ? "Copied!" : "Get Embed Code"}</IconSwap>
                <KbdHint>⌘⇧C</KbdHint>
              </button>
            </div>
          </section>
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
