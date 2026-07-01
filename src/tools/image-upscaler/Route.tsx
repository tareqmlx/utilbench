import {
  Download,
  FileImage,
  ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  ErrorAlert,
  PaneHeader,
  ToolShell,
  TwoPane,
  WarningAlert,
} from "../../components/tool-layout";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import {
  DEFAULT_PREFS,
  MAX_QUEUE_SIZE,
  MAX_TOTAL_SIZE,
  type NormFormat,
  type OutputFormat,
  type ScaleFactor,
  type UpscalePrefs,
  type UpscaleResult,
  buildUpscaledFilename,
  clampToCanvasLimits,
  computeMaxScale,
  createBatchZip,
  downloadBlob,
  formatBytes,
  prefetchModel,
  readFileBytes,
  readImageDims,
  reencodeViaWorker,
  sniffImageMeta,
  terminateUpscaleWorker,
  upscaleViaWorker,
  validateImageFile,
} from "./upscaler";

// `UpscalePrefs` is an interface alias, which has no implicit index signature and so doesn't satisfy
// `useToolPreferences`' `Record<string, unknown>` constraint. A homomorphic mapped alias does.
type Prefs = { [K in keyof UpscalePrefs]: UpscalePrefs[K] };

const SCALE_OPTIONS: ScaleFactor[] = [2, 4];

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
];

type ItemStatus = "ready" | "processing" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  format: NormFormat;
  width: number;
  height: number;
  // Largest scale whose OUTPUT still fits the in-browser canvas ceiling (0 = too large even at 2×).
  // Computed eagerly at upload so the 4× control can be gated per item (plan §6.4/§10.2).
  maxScale: ScaleFactor | 0;
  animated: boolean;
  status: ItemStatus;
  result?: UpscaleResult;
  // What `result` reflects, tracked as PREFS-DERIVED signatures (never read back from the worker
  // result) so a fixed-shape return can't cause an infinite re-dispatch loop (advisor). A scale
  // change re-infers; a format/quality/bg change re-encodes only.
  resultScaleSig?: string; // String(effectiveScale) applied
  resultEncSig?: string; // `${format}|${quality}|${backgroundColor}`
  error?: string;
  previewUrl: string; // object URL from the File — queue thumbnail + preview "original" (revoke on remove)
}

// Pixel-independent encode signature — two results with the same signature encode identically.
function encSigOf(p: Prefs): string {
  return `${p.format}|${p.quality}|${p.backgroundColor}`;
}

// The scale actually applied to an item: the global pref, capped by what the item's output permits.
function effectiveScale(maxScale: ScaleFactor | 0, prefsScale: ScaleFactor): ScaleFactor {
  return Math.min(prefsScale, maxScale) as ScaleFactor;
}

// A tighter output cap for weak devices — TF.js materializes a full float output tensor to stitch,
// which the 16.7 MP canvas cap does NOT bound (plan §7.2). Route reads navigator.* (the DOM-free
// `computeMaxScale` can't) and passes a lower `maxArea`. `hardwareConcurrency` is the primary signal;
// `deviceMemory` is a Chromium-only bonus.
function deviceMaxArea(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const cores =
    typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 8;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (cores <= 4 || (typeof mem === "number" && mem <= 4)) return 8_000_000;
  return undefined;
}

let nextId = 0;
function uid(): string {
  return `upx-${Date.now()}-${nextId++}`;
}

/** Lightweight oriented-dims fallback via <img> when the header parser can't read them. */
function imgDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. It may be corrupt."));
    };
    img.src = url;
  });
}

export default function ImageUpscalerRoute() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences<Prefs>("image-upscaler", DEFAULT_PREFS);
  const [isBusy, setIsBusy] = useState(false);
  // Which run owns the busy state, so loading feedback lands on the button the user clicked.
  const [runMode, setRunMode] = useState<"single" | "batch" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // Determinate upscaling progress from the UpscalerJS patch callback (plan §6.1). null = idle.
  const [upProgress, setUpProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [reveal, setReveal] = useState(50);

  // First-load model UX (plan §6.1) — indeterminate spinner for the sharded weight download.
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modelError, setModelError] = useState<string | null>(null);

  // Upscaled preview for the SELECTED item (its own `previewUrl` is the queue thumbnail; this is the
  // rendered output, plan §6.5).
  const [previewResult, setPreviewResult] = useState<UpscaleResult | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  // What the preview is computing, for an honest badge: a fresh inference ("upscaling") vs a cheap
  // re-encode of the cached slot ("updating"). null = idle.
  const [previewBusy, setPreviewBusy] = useState<"infer" | "recomposite" | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqIdRef = useRef(0);
  const batchCancelledRef = useRef(false);
  // Which scale the model is currently warm for (the model is per-scale — a scale change reloads).
  const loadedScaleRef = useRef<ScaleFactor | null>(null);
  // One-time "some images use a lower scale" batch warning (plan §6.6).
  const batchScaleWarnedRef = useRef(false);
  // Mirror state into refs so worker handlers / effects read the latest without re-subscribing.
  const itemsRef = useRef<QueueItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const modelStateRef = useRef(modelState);
  const outputUrlRef = useRef<string | null>(null);
  const displayedResultRef = useRef<UpscaleResult | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    modelStateRef.current = modelState;
  }, [modelState]);
  useEffect(() => {
    outputUrlRef.current = outputUrl;
  }, [outputUrl]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  // Cleanup on unmount: revoke every live object URL + tear down the worker.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
      terminateUpscaleWorker();
    };
  }, []);

  // Replace the on-screen upscaled image (revoking the previous object URL).
  const replaceOutput = useCallback((result: UpscaleResult | null) => {
    displayedResultRef.current = result;
    setPreviewResult(result);
    setOutputUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return result
        ? URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: result.mime }))
        : null;
    });
  }, []);

  // Store a freshly produced result on its item, tagged with the PREFS-DERIVED signatures it was
  // produced under so the preview/batch can tell when it goes stale.
  const applyResult = useCallback(
    (id: string, result: UpscaleResult, scaleSig: string, encSig: string) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "done" as const,
                result,
                resultScaleSig: scaleSig,
                resultEncSig: encSig,
                error: undefined,
              }
            : i,
        ),
      );
    },
    [],
  );

  const markItemError = useCallback((id: string, message: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "error" as const, error: message } : i)),
    );
  }, []);

  // Warm the model for a scale (downloads weights once). Returns success. Idempotent per scale.
  const ensureModelLoaded = useCallback(async (scale: ScaleFactor): Promise<boolean> => {
    if (modelStateRef.current === "ready" && loadedScaleRef.current === scale) return true;
    setModelState("loading");
    setModelError(null);
    try {
      await prefetchModel(scale);
      loadedScaleRef.current = scale;
      setModelState("ready");
      return true;
    } catch {
      setModelState("error");
      setModelError("Couldn't load the AI model — check your connection and retry.");
      return false;
    }
  }, []);

  // ── Preview effect: keep the on-screen output in sync with the SELECTED item under the CURRENT
  // controls. Only runs for an already-upscaled ("done") item — a fresh item is never auto-upscaled
  // (the first upscale is always the explicit button, plan §6.5). Signatures are prefs-derived on
  // BOTH sides, so this never loops regardless of what the worker returns (advisor). A scale change
  // re-infers (`upscaleViaWorker`); a format/quality/bg change re-encodes only (`reencodeViaWorker`,
  // falling back to a fresh upscale if the cache slot is stale).
  useEffect(() => {
    if (isBusy) return; // an explicit/batch run owns the worker — don't fight it
    const item = itemsRef.current.find((i) => i.id === selectedId);
    if (!item || item.status !== "done" || !item.result || item.maxScale === 0) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      replaceOutput(null);
      setPreviewBusy(null);
      return;
    }

    const eff = effectiveScale(item.maxScale, prefs.scale);
    const scaleSig = String(eff);
    const encSig = encSigOf(prefs);
    const scaleMatch = item.resultScaleSig === scaleSig;
    const encMatch = item.resultEncSig === encSig;

    if (scaleMatch && encMatch) {
      // Already correct for these controls — paint instantly, no worker round-trip.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (displayedResultRef.current !== item.result) replaceOutput(item.result);
      setPreviewBusy(null);
      return;
    }

    // Stale. Paint the stored output as a placeholder so the pane never blanks; the debounced
    // re-derive then corrects it under the current controls.
    const id = item.id;
    const file = item.file;
    const format = item.format;
    if (displayedResultRef.current !== item.result) replaceOutput(item.result);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++reqIdRef.current;
      try {
        let result: UpscaleResult;
        if (!scaleMatch) {
          // Pixel change → a full re-inference (different model output).
          setPreviewBusy("infer");
          const ok = await ensureModelLoaded(eff);
          if (!ok || requestId !== reqIdRef.current) return;
          const bytes = await readFileBytes(file);
          result = await upscaleViaWorker({
            itemKey: id,
            input: bytes,
            inputFormat: format,
            options: {
              scale: eff,
              format: prefs.format,
              quality: prefs.quality,
              backgroundColor: prefs.backgroundColor,
            },
            requestId,
            onProgress: (p) => {
              if (requestId === reqIdRef.current)
                setUpProgress({ current: p.current, total: p.total });
            },
          });
        } else {
          // Encode-only change → cheap re-encode of the warm slot; re-infer if the slot is stale.
          setPreviewBusy("recomposite");
          try {
            result = await reencodeViaWorker({
              itemKey: id,
              format: prefs.format,
              quality: prefs.quality,
              backgroundColor: prefs.backgroundColor,
              requestId,
            });
          } catch {
            setPreviewBusy("infer");
            const ok = await ensureModelLoaded(eff);
            if (!ok || requestId !== reqIdRef.current) return;
            const bytes = await readFileBytes(file);
            result = await upscaleViaWorker({
              itemKey: id,
              input: bytes,
              inputFormat: format,
              options: {
                scale: eff,
                format: prefs.format,
                quality: prefs.quality,
                backgroundColor: prefs.backgroundColor,
              },
              requestId,
              onProgress: (p) => {
                if (requestId === reqIdRef.current)
                  setUpProgress({ current: p.current, total: p.total });
              },
            });
          }
        }
        if (requestId !== reqIdRef.current) return; // superseded — discard
        applyResult(id, result, scaleSig, encSig);
        replaceOutput(result);
      } catch {
        // Preview failure is non-fatal — leave the last good output in place.
      } finally {
        if (requestId === reqIdRef.current) {
          setPreviewBusy(null);
          setUpProgress(null);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedId, prefs, isBusy, applyResult, replaceOutput, ensureModelLoaded]);

  // On restore / item switch, clamp a persisted scale down to what the selected item permits so a
  // stored 4× doesn't crash a large image (plan §6.4). Guarded so it can't loop.
  useEffect(() => {
    if (!selectedItem || selectedItem.maxScale === 0) return;
    if (prefs.scale > selectedItem.maxScale) {
      setPrefs({ scale: selectedItem.maxScale as ScaleFactor });
    }
  }, [selectedItem, prefs.scale, setPrefs]);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const incoming = Array.from(fileList);

      const accepted: QueueItem[] = [];
      const rejected: string[] = [];
      let runningTotal = items.reduce((s, i) => s + i.file.size, 0);
      const maxArea = deviceMaxArea();

      for (const file of incoming) {
        if (items.length + accepted.length >= MAX_QUEUE_SIZE) {
          setWarning(`Queue is full (max ${MAX_QUEUE_SIZE} files).`);
          break;
        }
        const validation = validateImageFile(file, ["png", "jpeg", "webp", "avif"]);
        if (!validation.valid) {
          rejected.push(validation.error ?? `Unsupported file: "${file.name}".`);
          continue;
        }
        if (validation.warning) setWarning(validation.warning);
        if (runningTotal + file.size > MAX_TOTAL_SIZE) {
          rejected.push(
            `"${file.name}" skipped — would exceed the ${Math.round(
              MAX_TOTAL_SIZE / (1024 * 1024),
            )} MB total queue limit.`,
          );
          continue;
        }

        try {
          const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
          const meta = sniffImageMeta(head);
          if (!meta.format) {
            rejected.push(`Couldn't read "${file.name}".`);
            continue;
          }
          let dims: { width: number; height: number };
          try {
            dims = readImageDims(head, meta.format);
          } catch {
            dims = await imgDims(file);
          }
          // The INPUT itself busts the canvas ceiling — it can't even be decoded onto a canvas
          // (plan §6.3). Point at image-resizer rather than the upscaler's own output cap.
          if (clampToCanvasLimits(dims.width, dims.height).downscaled) {
            rejected.push(
              `"${file.name}" is already very large — shrink it in image-resizer before upscaling.`,
            );
            continue;
          }
          runningTotal += file.size;
          accepted.push({
            id: uid(),
            file,
            format: meta.format,
            width: dims.width,
            height: dims.height,
            maxScale: computeMaxScale(dims.width, dims.height, maxArea),
            animated: Boolean(meta.animated),
            status: "ready",
            previewUrl: URL.createObjectURL(file),
          });
        } catch {
          rejected.push("Couldn't read this image — it may be corrupt.");
        }
      }

      if (rejected.length > 0) {
        setError(
          rejected.length === 1
            ? (rejected[0] ?? "Some files were skipped.")
            : `${rejected.length} files were skipped — ${rejected.join(" ")}`,
        );
      }

      if (accepted.length === 0) return;
      if (accepted.some((i) => i.animated)) {
        setWarning("Animated image — only the first frame is upscaled.");
      }
      setItems((prev) => [...prev, ...accepted]);
      const first = accepted[0];
      if (first && !selectedId) setSelectedId(first.id);
    },
    [items, selectedId],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) addFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFiles],
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === id);
        if (item) URL.revokeObjectURL(item.previewUrl);
        return prev.filter((i) => i.id !== id);
      });
      if (selectedId === id) {
        setSelectedId(null);
        replaceOutput(null);
      }
    },
    [selectedId, replaceOutput],
  );

  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
    setReveal(50);
  }, []);

  // Run the selected item (interactive single upscale, plan §6.6).
  const upscaleSelected = useCallback(async () => {
    const item = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    if (!item || isBusy || item.maxScale === 0) return;
    const eff = effectiveScale(item.maxScale, prefs.scale);
    setIsBusy(true);
    setError(null);
    setRunMode("single");
    setProgress({ done: 0, total: 1 });
    // Claim the requestId BEFORE the (possibly slow) model load so a cancel during the load supersedes.
    const requestId = ++reqIdRef.current;
    const ok = await ensureModelLoaded(eff);
    if (!ok || requestId !== reqIdRef.current) {
      setIsBusy(false);
      setRunMode(null);
      setProgress({ done: 0, total: 0 });
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, status: "processing" as const, error: undefined } : i,
      ),
    );
    setPreviewBusy("infer");
    try {
      const bytes = await readFileBytes(item.file);
      const result = await upscaleViaWorker({
        itemKey: item.id,
        input: bytes,
        inputFormat: item.format,
        options: {
          scale: eff,
          format: prefs.format,
          quality: prefs.quality,
          backgroundColor: prefs.backgroundColor,
        },
        requestId,
        onProgress: (p) => {
          if (requestId === reqIdRef.current) setUpProgress({ current: p.current, total: p.total });
        },
      });
      if (requestId !== reqIdRef.current) {
        // Cancelled mid-run — revert off "processing" without applying the result.
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id && i.status === "processing"
              ? { ...i, status: i.result ? ("done" as const) : ("ready" as const) }
              : i,
          ),
        );
        return;
      }
      applyResult(item.id, result, String(eff), encSigOf(prefs));
      replaceOutput(result);
      toast.success("Upscaled the image");
    } catch {
      markItemError(item.id, "Couldn't upscale — the image may be corrupt or unsupported.");
    } finally {
      setIsBusy(false);
      setRunMode(null);
      setPreviewBusy(null);
      setProgress({ done: 0, total: 0 });
      setUpProgress(null);
    }
  }, [isBusy, prefs, ensureModelLoaded, applyResult, markItemError, replaceOutput]);

  // Batch: sequential, per-item effective scale; skip (mark error) items too large even at 2×.
  const upscaleAll = useCallback(async () => {
    if (isBusy) return;
    const encSig = encSigOf(prefs);
    const runnable = itemsRef.current.filter((i) => i.status !== "processing");
    // Items that need a run: not already done under these exact controls.
    const toRun = runnable.filter((i) => {
      if (i.maxScale === 0) return false;
      const eff = effectiveScale(i.maxScale, prefs.scale);
      const current =
        i.status === "done" && i.resultScaleSig === String(eff) && i.resultEncSig === encSig;
      return !current;
    });
    // Items too large even at 2× → mark error rather than fail mid-batch.
    const zeros = runnable.filter((i) => i.maxScale === 0 && i.status !== "error");

    if (toRun.length === 0 && zeros.length === 0) {
      if (itemsRef.current.length > 0) toast.success("All images are already upscaled");
      return;
    }

    // One-time warning if some ready items will be scaled down to fit the canvas cap (plan §6.6).
    if (
      !batchScaleWarnedRef.current &&
      itemsRef.current.some(
        (i) => i.status !== "error" && i.maxScale > 0 && i.maxScale < prefs.scale,
      )
    ) {
      batchScaleWarnedRef.current = true;
      setWarning(
        "Some images will use a lower scale (2×) to stay within in-browser canvas limits.",
      );
    }

    if (zeros.length > 0) {
      const zeroIds = new Set(zeros.map((z) => z.id));
      setItems((prev) =>
        prev.map((i) =>
          zeroIds.has(i.id)
            ? {
                ...i,
                status: "error" as const,
                error: "Too large to upscale — shrink it in image-resizer first.",
              }
            : i,
        ),
      );
    }

    if (toRun.length === 0) return;

    setIsBusy(true);
    setError(null);
    batchCancelledRef.current = false;
    setProgress({ done: 0, total: toRun.length });
    setRunMode("batch");
    let done = 0; // attempted (success + fail) — drives the progress bar
    let succeeded = 0; // only items that produced an output — drives the toast

    for (const item of toRun) {
      if (batchCancelledRef.current) break;
      const eff = effectiveScale(item.maxScale, prefs.scale);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "processing" as const, error: undefined } : i,
        ),
      );
      const requestId = ++reqIdRef.current;
      const ok = await ensureModelLoaded(eff);
      if (!ok) {
        markItemError(item.id, "Couldn't load the AI model.");
        done += 1;
        setProgress({ done, total: toRun.length });
        continue;
      }
      if (batchCancelledRef.current) break;
      try {
        const bytes = await readFileBytes(item.file);
        const result = await upscaleViaWorker({
          itemKey: item.id,
          input: bytes,
          inputFormat: item.format,
          options: {
            scale: eff,
            format: prefs.format,
            quality: prefs.quality,
            backgroundColor: prefs.backgroundColor,
          },
          requestId,
          onProgress: (p) => {
            if (requestId === reqIdRef.current)
              setUpProgress({ current: p.current, total: p.total });
          },
        });
        if (batchCancelledRef.current) break;
        applyResult(item.id, result, String(eff), encSig);
        succeeded += 1;
        if (item.id === selectedIdRef.current) replaceOutput(result);
      } catch {
        markItemError(item.id, "Couldn't upscale — the image may be corrupt or unsupported.");
      }
      done += 1;
      setProgress({ done, total: toRun.length });
    }

    setItems((prev) =>
      prev.map((i) =>
        i.status === "processing"
          ? { ...i, status: i.result ? ("done" as const) : ("ready" as const) }
          : i,
      ),
    );
    setIsBusy(false);
    setRunMode(null);
    setPreviewBusy(null);
    setUpProgress(null);
    if (!batchCancelledRef.current && done > 0) {
      const failed = done - succeeded;
      if (succeeded > 0) {
        const noun = `image${succeeded === 1 ? "" : "s"}`;
        toast.success(
          failed > 0
            ? `Upscaled ${succeeded} ${noun} · ${failed} failed`
            : `Upscaled ${succeeded} ${noun}`,
        );
      } else {
        toast.error("Couldn't upscale any image.");
      }
    }
  }, [isBusy, prefs, ensureModelLoaded, applyResult, markItemError, replaceOutput]);

  // Soft cancel ("Skip remaining"): stop dispatching, ignore in-flight results; the current item
  // finishes and the model stays warm (plan §6.7).
  const cancelBatch = useCallback(() => {
    batchCancelledRef.current = true;
    reqIdRef.current += 1;
  }, []);

  // Hard cancel ("Stop now"): terminate the worker to kill the in-flight inference at once, at the
  // cost of reloading the model on the next run (plan §6.7).
  const stopNow = useCallback(() => {
    batchCancelledRef.current = true;
    reqIdRef.current += 1;
    terminateUpscaleWorker();
    loadedScaleRef.current = null;
    setModelState("idle");
    setItems((prev) =>
      prev.map((i) =>
        i.status === "processing"
          ? { ...i, status: i.result ? ("done" as const) : ("ready" as const) }
          : i,
      ),
    );
    setIsBusy(false);
    setRunMode(null);
    setPreviewBusy(null);
    setUpProgress(null);
    setProgress({ done: 0, total: 0 });
  }, []);

  // Per-item download — the result already holds the final encoded bytes, so no worker round-trip.
  const downloadItem = useCallback((item: QueueItem) => {
    if (!item.result) return;
    downloadBlob(
      new Blob([item.result.bytes as BlobPart], { type: item.result.mime }),
      buildUpscaledFilename(item.file.name, item.result.scale, item.result.ext),
    );
  }, []);

  const downloadAll = useCallback(async () => {
    const doneItems = itemsRef.current.filter((i) => i.status === "done" && i.result);
    if (doneItems.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const zipItems = doneItems.map((i) => {
        const result = i.result as UpscaleResult;
        return {
          blob: new Blob([result.bytes as BlobPart], { type: result.mime }),
          filename: buildUpscaledFilename(i.file.name, result.scale, result.ext),
        };
      });
      const zip = await createBatchZip(zipItems);
      downloadBlob(zip, "upscaled-images.zip");
    } catch {
      setError("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  }, [isZipping]);

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasQueue = items.length > 0;
  const hasSelected = Boolean(selectedItem);
  const runDisabled =
    !hasSelected || isBusy || (selectedItem !== null && selectedItem.maxScale === 0);
  const fourxDisabled = selectedItem !== null && selectedItem.maxScale < 4;
  const showQuality = prefs.format !== "png";

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => upscaleAll(),
          enabled: hasQueue && !isBusy,
        },
      ],
      [hasQueue, isBusy, upscaleAll],
    ),
  );

  // Drag handlers.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const upPercent =
    upProgress && upProgress.total > 0
      ? Math.min(100, Math.round((upProgress.current / upProgress.total) * 100))
      : null;

  // Output-dims label: the produced dims once done, else the projected dims at the effective scale.
  const outputDims = selectedItem
    ? previewResult
      ? { w: previewResult.width, h: previewResult.height }
      : selectedItem.maxScale > 0
        ? {
            w: selectedItem.width * effectiveScale(selectedItem.maxScale, prefs.scale),
            h: selectedItem.height * effectiveScale(selectedItem.maxScale, prefs.scale),
          }
        : null
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ToolShell variant="wide">
      <TwoPane
        gap="8"
        left={
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              disabled={isBusy}
              aria-label="Add images: drop here, or click to browse"
              className={cn(
                "group block w-full rounded-[18px] border-2 border-ink p-6 text-center transition-[background,box-shadow,transform] duration-200 sm:p-10",
                isBusy && "cursor-not-allowed opacity-60",
                isDragging
                  ? "-translate-x-px -translate-y-px bg-lemon shadow-[6px_6px_0_var(--ink)]"
                  : "bg-paper shadow-pop-3 hover:-translate-x-px hover:-translate-y-px hover:bg-lemon hover:shadow-[6px_6px_0_var(--ink)]",
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink bg-paper shadow-pop-2 group-hover:rotate-[-4deg]">
                  <Upload className="size-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <p className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                    Drag and drop images here
                  </p>
                  <p className="text-sm text-ink-2">
                    JPEG, PNG, WebP, AVIF — up to {MAX_QUEUE_SIZE} files
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
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              onChange={handleFileInput}
              data-testid="file-input"
            />

            <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
            <WarningAlert warning={warning} className="mt-0" onDismiss={() => setWarning(null)} />

            <p className="flex items-start gap-2 text-[12.5px] text-ink-2">
              <ShieldCheck className="mt-px size-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span>
                Your images never leave your browser; the AI model downloads once from this site.
              </span>
            </p>

            <section className="wb-panel wb-panel--out">
              <PaneHeader
                label="Queue"
                icon={<FileImage className="size-4" aria-hidden="true" />}
                className="bg-paper-2"
                actions={
                  <>
                    <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3 tabular-nums">
                      {isBusy
                        ? `${progress.done} of ${progress.total}`
                        : `${items.length} ${items.length === 1 ? "File" : "Files"}`}
                    </span>
                    {doneCount > 1 && (
                      <button
                        type="button"
                        onClick={downloadAll}
                        disabled={isZipping || isBusy}
                        className="wb-btn wb-btn--sm wb-btn--ghost disabled:opacity-50"
                        aria-label="Download all upscaled images as ZIP"
                      >
                        {isZipping ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="size-3.5" aria-hidden="true" />
                        )}
                        <span>{isZipping ? "Preparing…" : "Download ZIP"}</span>
                      </button>
                    )}
                  </>
                }
              />
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3 sm:p-4">
                {items.length === 0 && (
                  <p className="wb-fade-in py-10 text-center text-sm text-ink-3">
                    No images yet. Upload files to get started.
                  </p>
                )}
                {items.map((item) => {
                  const selected = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "wb-item-enter flex items-center gap-3 rounded-md border-2 border-ink p-2.5 transition-[background,box-shadow,transform] duration-200",
                        selected
                          ? "-translate-x-px -translate-y-px bg-lemon shadow-pop-2"
                          : "bg-paper shadow-pop-1 hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-2",
                      )}
                    >
                      <button
                        type="button"
                        aria-current={selected || undefined}
                        onClick={() => selectItem(item.id)}
                        className="-m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm p-1 text-left"
                      >
                        <span className="size-11 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
                          <img
                            className="h-full w-full object-cover"
                            src={item.previewUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">
                            {item.file.name}
                          </span>
                          <span
                            className={cn(
                              "block font-mono text-[11px] tabular-nums",
                              selected ? "text-ink-2" : "text-ink-3",
                            )}
                          >
                            {item.width}×{item.height}
                            {item.status === "done" && item.result && (
                              <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true"> → </span>
                                <span className="font-semibold text-grass">
                                  {item.result.width}×{item.result.height}
                                </span>
                              </span>
                            )}
                            {item.status === "processing" && " · upscaling…"}
                            {item.status === "error" && (
                              <span className="font-semibold text-tomato"> · {item.error}</span>
                            )}
                          </span>
                        </span>
                      </button>
                      {item.status === "done" && item.result && (
                        <button
                          type="button"
                          onClick={() => downloadItem(item)}
                          disabled={isBusy}
                          className="wb-fade-in grid size-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-colors hover:bg-mint disabled:opacity-40 pointer-coarse:size-11"
                          aria-label={`Download ${item.file.name}`}
                        >
                          <Download className="size-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={isBusy}
                        className="grid size-9 shrink-0 place-items-center rounded-md text-ink-3 hover:text-tomato disabled:opacity-40 pointer-coarse:size-11"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        }
        right={
          <div className="space-y-6">
            {/* Model load status */}
            <section className="wb-panel">
              <PaneHeader label="AI model" icon={<Wand2 className="size-4" aria-hidden="true" />} />
              <div className="space-y-4 p-5 sm:p-6" aria-live="polite">
                {modelState === "ready" ? (
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <span className="grid size-6 place-items-center rounded-full border-2 border-ink bg-mint shadow-pop-1">
                      <Sparkles className="size-3.5" aria-hidden="true" />
                    </span>
                    AI model ready — runs locally.
                  </p>
                ) : modelState === "loading" ? (
                  <div className="space-y-3">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Loading the AI model…
                    </p>
                    <p className="text-[12.5px] text-ink-2">
                      Loading the AI model (~2–3 MB) — one time, then it's cached. Your images never
                      leave your browser.
                    </p>
                  </div>
                ) : modelState === "error" ? (
                  <div className="space-y-3">
                    <ErrorAlert error={modelError} className="mt-0" />
                    <button
                      type="button"
                      onClick={() => ensureModelLoaded(prefs.scale)}
                      className="wb-btn wb-btn--ghost justify-center"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12.5px] text-ink-2">
                      The model downloads once (~2–3 MB) the first time you upscale, then it's
                      cached.
                    </p>
                    <button
                      type="button"
                      onClick={() => ensureModelLoaded(prefs.scale)}
                      className="wb-btn wb-btn--ghost justify-center"
                    >
                      <Download className="size-4" aria-hidden="true" />
                      <span>Load model</span>
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Scale + output controls */}
            <section className="wb-panel">
              <PaneHeader
                label="Output"
                icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
              />
              <div className="space-y-5 p-5 sm:p-6">
                <div className="space-y-2">
                  <Label id="scale-label" className="text-ink-2">
                    Scale
                  </Label>
                  <fieldset
                    className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0"
                    aria-labelledby="scale-label"
                  >
                    {SCALE_OPTIONS.map((s) => {
                      const active = prefs.scale === s;
                      const disabled = isBusy || (s === 4 && fourxDisabled);
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={disabled}
                          onClick={() => setPrefs({ scale: s })}
                          aria-pressed={active}
                          title={
                            s === 4 && fourxDisabled
                              ? "Output would exceed in-browser canvas limits (~16.7 MP / 8192 px) — pick 2×"
                              : undefined
                          }
                          className={cn(
                            "inline-flex items-center justify-center rounded-md border-2 border-ink py-2 text-[13px] font-bold transition-[background,transform] duration-150 disabled:opacity-50 pointer-coarse:min-h-11",
                            active
                              ? "-translate-y-px bg-ink text-paper shadow-pop-1"
                              : "bg-paper text-ink hover:bg-lemon",
                          )}
                        >
                          {s}×
                        </button>
                      );
                    })}
                  </fieldset>
                  {selectedItem !== null && selectedItem.maxScale === 0 && (
                    <p className="text-[11.5px] font-semibold text-tomato">
                      This image is too large to upscale — try image-resizer to shrink it first.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label id="format-label" className="text-ink-2">
                    Format
                  </Label>
                  <fieldset
                    className="m-0 grid min-w-0 grid-cols-3 gap-2 border-0 p-0"
                    aria-labelledby="format-label"
                  >
                    {FORMAT_OPTIONS.map((opt) => {
                      const active = prefs.format === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isBusy}
                          onClick={() => setPrefs({ format: opt.value })}
                          aria-pressed={active}
                          className={cn(
                            "inline-flex items-center justify-center rounded-md border-2 border-ink py-2 text-[13px] font-bold transition-[background,transform] duration-150 disabled:opacity-50 pointer-coarse:min-h-11",
                            active
                              ? "-translate-y-px bg-ink text-paper shadow-pop-1"
                              : "bg-paper text-ink hover:bg-lemon",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </fieldset>
                </div>

                {showQuality && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-ink-2">Quality</Label>
                      <span className="font-mono text-[12px] font-bold tabular-nums text-ink">
                        {prefs.quality}
                      </span>
                    </div>
                    <Slider
                      aria-label="Quality"
                      min={1}
                      max={100}
                      step={1}
                      disabled={isBusy}
                      value={[prefs.quality]}
                      onValueChange={([v]) => setPrefs({ quality: v ?? 90 })}
                    />
                  </div>
                )}

                {prefs.format === "jpeg" && (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="bg-color" className="flex items-center gap-2 text-ink-2">
                      <Palette className="size-4" aria-hidden="true" />
                      Background (JPEG has no transparency)
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold uppercase tabular-nums text-ink-3">
                        {prefs.backgroundColor}
                      </span>
                      <input
                        id="bg-color"
                        type="color"
                        disabled={isBusy}
                        value={prefs.backgroundColor}
                        onChange={(e) => setPrefs({ backgroundColor: e.target.value })}
                        className="size-9 shrink-0 cursor-pointer rounded-md border-2 border-ink bg-paper p-0.5 disabled:opacity-50 pointer-coarse:size-11"
                        aria-label="Background color"
                      />
                    </div>
                  </div>
                )}

                <p className="text-[11.5px] text-ink-3">
                  Changing the format re-renders large images (they can't be cached), so it may take
                  a moment.
                </p>
              </div>
            </section>

            {/* Preview */}
            <section className="wb-panel wb-panel--out">
              <PaneHeader
                label="Preview"
                icon={<ImageIcon className="size-4" aria-hidden="true" />}
                className="bg-paper-2"
                actions={
                  outputDims ? (
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-2">
                      {selectedItem?.width}×{selectedItem?.height} → {outputDims.w}×{outputDims.h}
                    </span>
                  ) : undefined
                }
              />
              <div className="p-5 sm:p-6">
                {!selectedItem ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center text-ink-3">
                    <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink-3 bg-paper">
                      <Maximize2 className="size-6" aria-hidden="true" />
                    </span>
                    <p className="text-sm">Upload and select an image to upscale it.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative mx-auto max-h-[420px] w-full overflow-hidden rounded-md border-2 border-ink bg-[repeating-conic-gradient(var(--bg-3)_0_25%,var(--bg)_0_50%)] bg-[length:20px_20px]">
                      <img
                        src={selectedItem.previewUrl}
                        alt="Original"
                        className="block max-h-[420px] w-full object-contain"
                        decoding="async"
                      />
                      {outputUrl && (
                        <img
                          key={outputUrl}
                          src={outputUrl}
                          alt="Upscaled"
                          className="absolute inset-0 block max-h-[420px] w-full object-contain"
                          style={{ clipPath: `inset(0 0 0 ${reveal}%)` }}
                          decoding="async"
                        />
                      )}
                      {outputUrl && (
                        <>
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 bg-ink outline outline-1 outline-paper"
                            style={{ left: `${reveal}%` }}
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink shadow-pop-1"
                          >
                            Original
                          </span>
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-full border-2 border-ink bg-mint px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink shadow-pop-1"
                          >
                            Upscaled
                          </span>
                        </>
                      )}
                      {previewBusy && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-paper px-2 py-0.5 text-[11px] font-bold shadow-pop-1">
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />{" "}
                          {previewBusy === "infer" ? "upscaling" : "updating"}
                        </span>
                      )}
                    </div>
                    {outputUrl ? (
                      <>
                        <Slider
                          aria-label="Reveal upscaled image"
                          min={0}
                          max={100}
                          step={1}
                          value={[reveal]}
                          onValueChange={([v]) => setReveal(v ?? 50)}
                        />
                        {previewResult && (
                          <div className="border-t-2 border-ink pt-4">
                            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                              Output size
                            </span>
                            <span className="ml-2 font-mono text-[14px] font-bold text-ink tabular-nums">
                              {formatBytes(previewResult.outputSize)}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-center text-[12.5px] text-ink-2">
                        Click “Upscale” to synthesize detail at your chosen scale.
                      </p>
                    )}

                    <p className="text-[12.5px] text-ink-2">
                      ESRGAN synthesizes new detail (not a true photo of more pixels) — best on
                      clean images. For a plain resize, use image-resizer.
                    </p>
                    {prefs.format !== "jpeg" && (
                      <p className="text-[12.5px] text-ink-3">
                        Transparency is preserved, but color and transparency are upscaled
                        separately — feathered edges may show slight fringing.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Upscaling progress */}
            {isBusy && upPercent !== null && (
              <div className="space-y-2">
                {/* biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, must not be focusable */}
                <div
                  className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-paper"
                  role="progressbar"
                  aria-label="Upscaling progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={upPercent}
                >
                  <div
                    className="h-full bg-lemon transition-[width] duration-200"
                    style={{ width: `${upPercent}%` }}
                  />
                </div>
                <p className="text-center text-[12px] text-ink-3">Upscaling… {upPercent}%</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={upscaleSelected}
                  disabled={runDisabled}
                  className="wb-btn wb-btn--ghost flex-1 justify-center py-3.5"
                >
                  <IconSwap swapKey={runMode === "single"}>
                    {runMode === "single" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        <span>Upscaling…</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="size-4" aria-hidden="true" />
                        <span>Upscale</span>
                      </>
                    )}
                  </IconSwap>
                </button>
                <button
                  type="button"
                  onClick={upscaleAll}
                  disabled={!hasQueue || isBusy}
                  className="wb-btn flex-1 justify-center py-3.5 text-[15px]"
                >
                  <IconSwap swapKey={isBusy && runMode === "batch"}>
                    {isBusy && runMode === "batch" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        <span>
                          Upscaling {progress.done} of {progress.total}…
                        </span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="size-4" aria-hidden="true" />
                        <span>Upscale all</span>
                        <KbdHint>⌘⏎</KbdHint>
                      </>
                    )}
                  </IconSwap>
                </button>
                {isBusy && (
                  <>
                    <button
                      type="button"
                      onClick={cancelBatch}
                      className="wb-btn wb-btn--ghost justify-center px-5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={stopNow}
                      className="wb-btn wb-btn--ghost justify-center px-5"
                    >
                      Stop now
                    </button>
                  </>
                )}
              </div>
              {isBusy && progress.total > 1 && (
                <p className="text-center text-[12px] text-ink-3">
                  This can take a while for large batches or 4×.
                </p>
              )}
            </div>
          </div>
        }
      />
    </ToolShell>
  );
}
