import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import {
  Check,
  Code,
  Download,
  ImageIcon,
  Loader2,
  Pause,
  Play,
  PlayCircle,
  RotateCcw,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, WarningAlert } from "../../components/tool-layout";
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
  const [frameExported, setFrameExported] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!frameExported) return;
    const t = setTimeout(() => setFrameExported(false), 1500);
    return () => clearTimeout(t);
  }, [frameExported]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<AnimationItem | null>(null);

  const { copied, copy } = useClipboard();

  useEffect(() => {
    if (copied) setStatus("Embed code copied to clipboard.");
  }, [copied]);

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
      const message = validation.error ?? "Unknown error";
      setError(message);
      setStatus(`Error: ${message}`);
      return;
    }
    if (validation.warning) {
      setWarning(validation.warning);
    }

    try {
      const data = await parseFile(file);
      setSourceFile(file);
      setAnimationData(data);
      setStatus(`Animation loaded: ${file.name}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse animation file.";
      setError(message);
      setStatus(`Error: ${message}`);
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
      setFrameExported(true);
      setStatus("Frame exported as lottie-frame.png.");
    } catch {
      const message = "Failed to export frame as PNG.";
      setError(message);
      setStatus(`Error: ${message}`);
    }
  }, [metadata]);

  const handleDownloadDotLottie = useCallback(() => {
    if (!animationData) return;
    const blob = buildDotLottie(animationData);
    downloadBlob(blob, "animation.lottie");
    setStatus("Downloaded as animation.lottie.");
  }, [animationData]);

  const handleExportGif = useCallback(async () => {
    if (!containerRef.current || !metadata || !lottieRef.current) return;

    setIsExporting(true);
    setStatus("Exporting GIF...");
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
      setStatus("Downloaded as animation.gif.");
    } catch {
      const message = "Failed to export GIF.";
      setError(message);
      setStatus(`Error: ${message}`);
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

  const activeBg = hasFile ? prefs.background : "neutral";
  const bgClass =
    activeBg === "white"
      ? "bg-[var(--canvas-light)]"
      : activeBg === "black"
        ? "bg-[var(--canvas-dark)]"
        : activeBg === "transparent"
          ? "bg-[length:20px_20px] [background-image:linear-gradient(45deg,var(--bg-3)_25%,transparent_25%,transparent_75%,var(--bg-3)_75%),linear-gradient(45deg,var(--bg-3)_25%,transparent_25%,transparent_75%,var(--bg-3)_75%)] [background-position:0_0,10px_10px]"
          : "bg-paper-2";

  const progressRatio = totalFrames > 0 ? Math.min(1, currentFrame / totalFrames) : 0;
  const currentTime = metadata ? formatDuration(currentFrame / metadata.frameRate) : "0:00";
  const totalTime = metadata ? formatDuration(metadata.duration) : "0:00";
  const timelineMax = totalFrames > 0 ? totalFrames - 1 : 0;

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Upload / File info */}
          {hasFile ? (
            <div className="wb-fade-in flex items-center gap-4 rounded-lg border-2 border-ink bg-paper-2 px-5 py-4 shadow-pop-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border-2 border-ink bg-mint">
                <Play className="size-5 text-ink" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink" title={sourceFile?.name}>
                  {sourceFile?.name}
                </p>
                <p className="wb-mono-sm">{sourceFile ? formatFileSize(sourceFile.size) : ""}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSourceFile(null);
                  setAnimationData(null);
                  setError(null);
                  setCurrentFrame(0);
                  setStatus("File removed.");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="wb-chip"
                aria-label="Remove file"
              >
                <X className="size-3.5" aria-hidden="true" />
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`group flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-12 ${
                isDragging ? "border-tomato bg-lemon/40" : "border-ink bg-paper-2 hover:bg-lemon/30"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div
                data-dragging={isDragging}
                className="wb-svg-drop-icon mb-5 grid size-16 place-items-center rounded-md border-2 border-ink bg-pink shadow-pop-2"
              >
                <Upload className="size-7 text-ink" aria-hidden="true" />
              </div>
              <span className="wb-h3 mb-2 block">Drag your animation here</span>
              <p className="mx-auto mb-6 max-w-xs text-sm text-ink-2">
                Upload .json or .lottie files to start previewing.
              </p>
              <span className="wb-btn wb-btn--sm wb-btn--ghost pointer-events-none">
                Browse files
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

          <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

          {/* Preview panel */}
          <div className="wb-panel">
            <PaneHeader
              label="Preview"
              className="bg-paper-2"
              trailing={<span className="wb-meta">SVG renderer</span>}
            />

            <div
              className={`relative flex aspect-video items-center justify-center overflow-hidden ${bgClass}`}
            >
              {!hasFile && (
                <div className="flex flex-col items-center justify-center gap-3 select-none">
                  <PlayCircle
                    className="size-20 text-ink-3/45"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="wb-meta text-ink-2">No animation loaded</span>
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
                <div className="flex justify-between font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3 tabular-nums">
                  <span>{currentTime}</span>
                  <span>{totalTime}</span>
                </div>
                <div
                  className="relative h-2 w-full cursor-pointer overflow-hidden rounded-full border-2 border-ink bg-paper-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed"
                  onClick={hasFile ? handleTimelineClick : undefined}
                  onKeyDown={(e) => {
                    if (!hasFile) return;
                    const stepKey =
                      e.key === "ArrowRight" ||
                      e.key === "ArrowLeft" ||
                      e.key === "Home" ||
                      e.key === "End";
                    if (!stepKey) return;
                    e.preventDefault();
                    let newFrame = currentFrame;
                    if (e.key === "Home") newFrame = 0;
                    else if (e.key === "End") newFrame = timelineMax;
                    else {
                      const jump = e.shiftKey ? Math.max(1, Math.round(timelineMax / 20)) : 1;
                      const delta = e.key === "ArrowRight" ? jump : -jump;
                      newFrame = Math.max(0, Math.min(timelineMax, currentFrame + delta));
                    }
                    lottieRef.current?.goToAndStop(newFrame, true);
                    setCurrentFrame(newFrame);
                  }}
                  role="slider"
                  tabIndex={hasFile ? 0 : -1}
                  aria-valuenow={currentFrame}
                  aria-valuemin={0}
                  aria-valuemax={timelineMax}
                  aria-valuetext={
                    hasFile ? `${currentTime} of ${totalTime}` : "No animation loaded"
                  }
                  aria-label="Animation timeline"
                  aria-disabled={!hasFile}
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
                    <IconSwap swapKey={isPlaying}>
                      {isPlaying ? (
                        <Pause className="size-5" aria-hidden="true" />
                      ) : (
                        <Play className="size-5" aria-hidden="true" />
                      )}
                    </IconSwap>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                    onClick={handleReplay}
                    disabled={!hasFile}
                    aria-label="Replay"
                  >
                    <RotateCcw className="size-5" aria-hidden="true" />
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
                          className={`wb-chip min-h-11 px-3 text-[12.5px] font-semibold sm:min-h-0 sm:py-1.5 ${prefs.speed === s ? "on" : ""}`}
                          onClick={() => handleSpeedChange(s)}
                          aria-pressed={prefs.speed === s}
                          aria-label={`${s}x speed`}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Background */}
                  <div className="flex items-center gap-3">
                    <span className="wb-meta">Background</span>
                    <div className="flex gap-0.5">
                      {(
                        [
                          { value: "white", label: "White background" },
                          { value: "black", label: "Black background" },
                          { value: "transparent", label: "Transparent background" },
                        ] as const
                      ).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className="group grid size-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                          onClick={() => setPrefs({ background: value })}
                          aria-label={label}
                          aria-pressed={prefs.background === value}
                        >
                          {value === "transparent" ? (
                            <span
                              className={`relative size-6 overflow-hidden rounded-full border-2 border-ink bg-paper transition-shadow ${prefs.background === "transparent" ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper" : ""}`}
                            >
                              <span className="absolute inset-0 bg-ink/20 [mask-image:linear-gradient(45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                              <span className="absolute inset-0 bg-ink/20 [mask-image:linear-gradient(-45deg,transparent_45%,black_45%,black_55%,transparent_55%)]" />
                            </span>
                          ) : (
                            <span
                              className={`size-6 rounded-full border-2 border-ink transition-shadow ${value === "white" ? "bg-[var(--canvas-light)]" : "bg-[var(--canvas-dark)]"} ${prefs.background === value ? "ring-2 ring-tomato ring-offset-2 ring-offset-paper" : ""}`}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="relative flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                    title="Export frame as PNG"
                    aria-label="Export frame as PNG"
                    onClick={handleExportFrame}
                    disabled={!hasFile}
                  >
                    <IconSwap swapKey={frameExported}>
                      {frameExported ? (
                        <Check className="size-5 text-ink" aria-hidden="true" />
                      ) : (
                        <ImageIcon className="size-5" aria-hidden="true" />
                      )}
                    </IconSwap>
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-ink-3 hover:bg-paper-2 hover:text-ink"
                        title="Playback settings"
                        aria-label="Playback settings"
                      >
                        <Settings className="size-5" aria-hidden="true" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-56 border-2 border-ink bg-paper shadow-pop-3"
                    >
                      <h5 className="wb-meta mb-3">Settings</h5>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="lottie-loop-switch"
                          className="text-sm font-medium text-ink"
                        >
                          Loop playback
                        </label>
                        <Switch
                          id="lottie-loop-switch"
                          checked={prefs.isLooping}
                          onCheckedChange={(v) => setPrefs({ isLooping: v })}
                          aria-label="Toggle loop"
                        />
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
            {metadata ? (
              <dl className="space-y-3">
                {(
                  [
                    ["Filename", metadata.filename],
                    ["Size", formatFileSize(metadata.fileSize)],
                    ["Dimensions", `${metadata.width} × ${metadata.height} px`],
                    ["Frame rate", `${metadata.frameRate} FPS`],
                    ["Duration", `${metadata.duration.toFixed(2)}s`],
                    ["Version", metadata.version],
                    ["Name", metadata.animationName],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 border-b border-ink/15 pb-2 last:border-b-0 last:pb-0"
                  >
                    <dt className="text-xs font-medium text-ink-3">{label}</dt>
                    <dd
                      className="truncate text-right text-sm font-semibold text-ink"
                      title={value}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-2">Upload a file to inspect its metadata.</p>
            )}
          </section>

          {/* Features */}
          <section className="wb-panel wb-panel--out p-6">
            <h4 className="wb-meta mb-5">Features found</h4>
            {features.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {features.map((f, idx) => (
                  <span
                    key={f.tag}
                    style={{ animationDelay: `${idx * 40}ms` }}
                    className={`wb-item-enter inline-flex items-center rounded-md border-2 border-ink px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ${
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
                <Download className="size-4" aria-hidden="true" />
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
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Exporting GIF...
                  </>
                ) : (
                  <>
                    <ImageIcon className="size-4" aria-hidden="true" />
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
                <Code className="size-4" aria-hidden="true" />
                <IconSwap swapKey={copied}>{copied ? "Copied!" : "Get embed code"}</IconSwap>
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
