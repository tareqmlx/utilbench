import {
  ChevronDown,
  Download,
  FileImage,
  ImageIcon,
  Loader2,
  Palette,
  Scissors,
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
  MAX_CANVAS_AREA,
  MAX_QUEUE_SIZE,
  MAX_TOTAL_SIZE,
  type NormFormat,
  type RemovePrefs,
  type RemoveResult,
  buildCutoutFilename,
  createBatchZip,
  downloadBlob,
  formatBytes,
  prefetchModel,
  readFileBytes,
  readImageDims,
  recompositeViaWorker,
  removeViaWorker,
  sniffImageMeta,
  terminateRemoveWorker,
  validateImageFile,
} from "./remover";
import type { OutputFormat, OutputMode } from "./remover-types";

// `RemovePrefs` is an interface, which has no implicit index signature and so doesn't satisfy
// `useToolPreferences`' `Record<string, unknown>` constraint. A homomorphic mapped alias does.
type Prefs = { [K in keyof RemovePrefs]: RemovePrefs[K] };

const OUTPUT_MODES: Array<{ value: OutputMode; label: string }> = [
  { value: "transparent", label: "Transparent" },
  { value: "color", label: "Color" },
  { value: "mask", label: "Mask" },
];

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

type ItemStatus = "ready" | "processing" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  format: NormFormat;
  width: number;
  height: number;
  animated: boolean;
  status: ItemStatus;
  result?: RemoveResult;
  // What `result` reflects, so previews/downloads can detect when it drifts from the current
  // controls (the source of the old "only the selected item updates" bug). `resultSig` captures the
  // PIXEL-affecting prefs (encode intent doesn't change the visible image), `resultIntent` the
  // encoder used (preview = fast convertToBlob, download = small oxipng) for the zip/download path.
  resultSig?: string;
  resultIntent?: "preview" | "download";
  error?: string;
  previewUrl: string; // object URL from the File — queue thumbnail only (revoke on remove)
}

// The prefs that change the composited PIXELS — two results with the same signature look identical
// on screen (regardless of encode intent), so a preview can reuse a download-encoded result and vice
// versa. Used to decide when a stored result is stale vs the current controls.
function compositeSig(p: Prefs): string {
  return `${p.outputMode}|${p.backgroundColor}|${p.format}|${p.alphaThreshold}`;
}

let nextId = 0;
function uid(): string {
  return `bgr-${Date.now()}-${nextId++}`;
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

export default function BackgroundRemoverRoute() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences<Prefs>("background-remover", DEFAULT_PREFS);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // First-load model download UX (plan §6.1).
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState<{ current: number; total: number } | null>(null);

  // Cutout preview for the SELECTED item — separate top-level state (the item's own `previewUrl`
  // is the queue thumbnail; this is the rendered cutout, plan §6.5 / advisor).
  const [previewResult, setPreviewResult] = useState<RemoveResult | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  // What the preview pane is computing, for an honest badge: a fresh inference ("removing") vs a
  // cheap recomposite of an existing mask ("updating"). null = idle (plan §6.5 / cursor #4).
  const [previewBusy, setPreviewBusy] = useState<"infer" | "recomposite" | null>(null);
  // True while a Download-ZIP re-encode is in flight — keeps the preview effect from fighting it and
  // disables the button (the zip path may re-derive stale items through the same single worker).
  const [isZipping, setIsZipping] = useState(false);
  // The id of the item whose per-item Download is preparing (recomposite/oxipng, or a cold-slot
  // re-infer). A per-item download IS a multi-second worker run, so — like isZipping for the batch —
  // it feeds `workerLocked` and drives a row spinner, instead of running invisibly with controls live.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqIdRef = useRef(0);
  const batchCancelledRef = useRef(false);
  // Synchronous guard against re-entering downloadItem before its state flip lands (a fast double-click).
  const downloadingIdRef = useRef<string | null>(null);
  // Mirror state into refs so worker handlers / effects read the latest without re-subscribing.
  const itemsRef = useRef<QueueItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const modelStateRef = useRef(modelState);
  const cutoutUrlRef = useRef<string | null>(null);
  // The result object currently painted in the preview pane, so the preview effect can skip
  // redundant object-URL churn when the on-screen cutout is already the correct one.
  const displayedResultRef = useRef<RemoveResult | null>(null);

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
    cutoutUrlRef.current = cutoutUrl;
  }, [cutoutUrl]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  // Cleanup on unmount: revoke every live object URL + tear down the worker.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (cutoutUrlRef.current) URL.revokeObjectURL(cutoutUrlRef.current);
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
      terminateRemoveWorker();
    };
  }, []);

  // Replace the on-screen cutout (revoking the previous object URL).
  const replaceCutout = useCallback((result: RemoveResult | null) => {
    displayedResultRef.current = result;
    setPreviewResult(result);
    setCutoutUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return result
        ? URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: result.mime }))
        : null;
    });
  }, []);

  // Store a freshly produced result on its item, tagged with the controls it was composited under
  // (`sig`) and the encoder used (`intent`) so previews/downloads can tell when it goes stale.
  const applyResult = useCallback(
    (id: string, result: RemoveResult, sig: string, intent: "preview" | "download") => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "done" as const,
                result,
                resultSig: sig,
                resultIntent: intent,
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

  // ── Preview effect: keep the on-screen cutout in sync with the SELECTED item under the CURRENT
  // controls. An up-to-date result paints instantly (no worker). A stale one — different mode/format,
  // or a different item selected after the controls changed — re-derives: a cheap recomposite of the
  // warm mask, or a re-infer if the slot is cold. This is what makes a pref change apply to whichever
  // item you view next, not only the one selected when you turned the knob (cursor #2 drift bug).
  // Fires on both selection and pref changes (reading `prefs` directly), so the two are unified.
  useEffect(() => {
    if (isBusy || isZipping) return; // batch / zip owns the worker — don't fight it
    const item = itemsRef.current.find((i) => i.id === selectedId);
    if (!item || item.status !== "done" || !item.result) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      replaceCutout(null);
      setPreviewBusy(null);
      return;
    }

    const sig = compositeSig(prefs);
    if (item.resultSig === sig) {
      // Already correct for these controls — paint instantly, no worker round-trip.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (displayedResultRef.current !== item.result) replaceCutout(item.result);
      setPreviewBusy(null);
      return;
    }

    // Stale. If we just switched to a DIFFERENT item, paint its stored cutout immediately as a
    // placeholder (right subject, maybe old mode) so the pane never blanks; the debounced re-derive
    // then corrects it under the current controls. A same-item knob tweak leaves the cutout in place.
    const id = item.id;
    const file = item.file;
    const format = item.format;
    if (displayedResultRef.current !== item.result) replaceCutout(item.result);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++reqIdRef.current;
      setPreviewBusy("recomposite");
      try {
        let result: RemoveResult;
        try {
          result = await recompositeViaWorker({
            options: prefs,
            requestId,
            itemKey: id,
            encodeIntent: "preview",
          });
        } catch {
          // Cold/stale cache slot (item switch or timeout-respawn) → re-infer from source bytes.
          setPreviewBusy("infer");
          const bytes = await readFileBytes(file);
          result = await removeViaWorker({
            input: bytes,
            inputFormat: format,
            options: prefs,
            requestId,
            itemKey: id,
            encodeIntent: "preview",
          });
        }
        if (requestId !== reqIdRef.current) return; // superseded — discard
        applyResult(id, result, sig, "preview");
        replaceCutout(result);
      } catch {
        // Preview failure is non-fatal — leave the last good cutout in place.
      } finally {
        if (requestId === reqIdRef.current) setPreviewBusy(null);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedId, prefs, isBusy, isZipping, applyResult, replaceCutout]);

  // Warm the model (downloads weights once, with byte progress). Returns success.
  const ensureModelLoaded = useCallback(async (): Promise<boolean> => {
    if (modelStateRef.current === "ready") return true;
    setModelState("loading");
    setModelError(null);
    setDlProgress({ current: 0, total: 0 });
    try {
      await prefetchModel((p) => setDlProgress({ current: p.current, total: p.total }));
      setModelState("ready");
      setDlProgress(null);
      return true;
    } catch {
      setModelState("error");
      setModelError("Couldn't load the AI model — check your connection and retry.");
      setDlProgress(null);
      return false;
    }
  }, []);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      setWarning(null);
      const incoming = Array.from(fileList);

      const accepted: QueueItem[] = [];
      const rejected: string[] = [];
      let runningTotal = items.reduce((s, i) => s + i.file.size, 0);

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
          // Hard reject over the canvas-area ceiling — full-res handling is v1.1 (plan §7.2/§10.2).
          if (dims.width * dims.height > MAX_CANVAS_AREA) {
            rejected.push(
              `"${file.name}" — Image too large to process in your browser (over ~16 MP).`,
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
            animated: Boolean(meta.animated),
            status: "ready",
            previewUrl: URL.createObjectURL(file),
          });
        } catch {
          rejected.push(`Couldn't read this image — it may be corrupt.`);
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
        setWarning("Animated image — only the first frame is processed.");
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
        replaceCutout(null);
      }
    },
    [selectedId, replaceCutout],
  );

  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // Run the selected item (interactive single infer — fast preview encode, plan §6.6).
  const removeSelected = useCallback(async () => {
    const item = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    if (!item || isBusy || isZipping) return;
    setIsBusy(true);
    setError(null);
    setProgress({ done: 0, total: 1 });
    // Claim the requestId BEFORE the (possibly slow) model load. Cancel is already on screen during
    // "Downloading the AI model…", and cancelBatch bumps reqIdRef — so claiming it up front means a
    // cancel during the load supersedes this run, instead of being absorbed by a later ++ (cursor r4 #1;
    // removeAll bails on batchCancelledRef right after the load for the same reason).
    const requestId = ++reqIdRef.current;
    const ok = await ensureModelLoaded();
    if (!ok) {
      setIsBusy(false);
      setProgress({ done: 0, total: 0 });
      return;
    }
    if (requestId !== reqIdRef.current) {
      // Cancelled while the model was still loading — before this item ever moved to "processing".
      // Stand down; the item keeps the status it had (ready, or done from a prior cutout).
      setIsBusy(false);
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
      const result = await removeViaWorker({
        input: bytes,
        inputFormat: item.format,
        options: prefs,
        requestId,
        itemKey: item.id,
        encodeIntent: "preview",
      });
      if (requestId !== reqIdRef.current) {
        // Cancelled mid-run (Cancel bumps reqIdRef) or otherwise superseded — don't apply the result
        // or toast. Revert the item OFF "processing": restore "done" if it still carries a prior cutout
        // (a re-run), else "ready" for a first run. A bare return would strand it on "processing" and
        // the preview effect would blank the cutout. Mirrors removeAll's post-cancel cleanup (r3 #2).
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id && i.status === "processing"
              ? { ...i, status: i.result ? ("done" as const) : ("ready" as const) }
              : i,
          ),
        );
        return;
      }
      applyResult(item.id, result, compositeSig(prefs), "preview");
      replaceCutout(result);
      toast.success("Removed the background");
    } catch {
      markItemError(
        item.id,
        "Couldn't remove the background — the image may be corrupt or unsupported.",
      );
    } finally {
      setIsBusy(false);
      setPreviewBusy(null);
      setProgress({ done: 0, total: 0 });
    }
  }, [isBusy, isZipping, prefs, ensureModelLoaded, applyResult, markItemError, replaceCutout]);

  // Batch: sequential, each item encodes for download (small oxipng bytes for the zip — plan §6.6).
  const removeAll = useCallback(async () => {
    if (isBusy || isZipping) return;
    // Skip items already done AND current under these controls AND download-encoded — re-running them
    // wastes minutes for no change (cursor #5). A pref change re-stales them, so they re-run then.
    const sig = compositeSig(prefs);
    const toRun = itemsRef.current.filter(
      (i) =>
        i.status !== "processing" &&
        !(i.status === "done" && i.resultSig === sig && i.resultIntent === "download"),
    );
    if (toRun.length === 0) {
      if (itemsRef.current.length > 0) toast.success("All cutouts are already up to date");
      return;
    }
    setIsBusy(true);
    setError(null);
    batchCancelledRef.current = false;
    setProgress({ done: 0, total: toRun.length });
    const ok = await ensureModelLoaded();
    if (!ok) {
      setIsBusy(false);
      setProgress({ done: 0, total: 0 });
      return;
    }

    let done = 0;
    for (const item of toRun) {
      if (batchCancelledRef.current) break;
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "processing" as const, error: undefined } : i,
        ),
      );
      const requestId = ++reqIdRef.current;
      try {
        const bytes = await readFileBytes(item.file);
        const result = await removeViaWorker({
          input: bytes,
          inputFormat: item.format,
          options: prefs,
          requestId,
          itemKey: item.id,
          encodeIntent: "download",
        });
        if (batchCancelledRef.current) break;
        applyResult(item.id, result, sig, "download");
        if (item.id === selectedIdRef.current) replaceCutout(result);
      } catch {
        markItemError(
          item.id,
          "Couldn't remove the background — the image may be corrupt or unsupported.",
        );
      }
      done += 1;
      setProgress({ done, total: toRun.length });
    }

    // A cancelled in-flight item drops back — but if it was a RE-RUN of an already-done item it still
    // carries its prior result, so restore "done" (the signature machinery re-derives it on demand)
    // rather than wiping its cutout. Only never-run items go to "ready" (cursor round-2 #2).
    setItems((prev) =>
      prev.map((i) =>
        i.status === "processing"
          ? { ...i, status: i.result ? ("done" as const) : ("ready" as const) }
          : i,
      ),
    );
    setIsBusy(false);
    if (!batchCancelledRef.current && done > 0) {
      toast.success(`Removed the background from ${done} image${done === 1 ? "" : "s"}`);
    }
  }, [isBusy, isZipping, prefs, ensureModelLoaded, applyResult, markItemError, replaceCutout]);

  const cancelBatch = useCallback(() => {
    batchCancelledRef.current = true;
    reqIdRef.current += 1; // discard any in-flight result
  }, []);

  // One-shot download encode (small oxipng) from the warm slot, or a re-infer if it's cold (plan §6.6).
  const downloadItem = useCallback(
    async (item: QueueItem) => {
      if (!item.result || isBusy || isZipping || downloadingIdRef.current) return;
      // Flip the busy state up front (ref synchronously, so a double-click bails) — this run isn't free.
      downloadingIdRef.current = item.id;
      setDownloadingId(item.id);
      try {
        let result: RemoveResult;
        try {
          result = await recompositeViaWorker({
            options: prefs,
            requestId: ++reqIdRef.current,
            itemKey: item.id,
            encodeIntent: "download",
          });
        } catch {
          const bytes = await readFileBytes(item.file);
          result = await removeViaWorker({
            input: bytes,
            inputFormat: item.format,
            options: prefs,
            requestId: ++reqIdRef.current,
            itemKey: item.id,
            encodeIntent: "download",
          });
        }
        // Cache the download-encoded bytes so a later Download ZIP reuses them (no re-encode).
        applyResult(item.id, result, compositeSig(prefs), "download");
        downloadBlob(
          new Blob([result.bytes as BlobPart], { type: result.mime }),
          buildCutoutFilename(item.file.name, result.ext),
        );
      } catch {
        setError("Couldn't prepare the download — try removing the background again.");
      } finally {
        // Always release the lock — a cold-slot re-infer can throw, and a missed clear would wedge
        // `workerLocked` true and freeze every control.
        downloadingIdRef.current = null;
        setDownloadingId(null);
      }
    },
    [isBusy, isZipping, prefs, applyResult],
  );

  // Zip every done cutout under the CURRENT controls. Reuse an item's stored bytes only when they
  // already match the controls AND were download-encoded (small oxipng); otherwise re-derive so the
  // zip is consistent and optimized — fixes the old "ZIP ships stale / preview-fat bytes" bug
  // (cursor #1). The common path (Remove all → Download ZIP, no change) re-derives nothing.
  const downloadAll = useCallback(async () => {
    const doneItems = itemsRef.current.filter((i) => i.status === "done" && i.result);
    if (doneItems.length === 0 || isZipping) return;
    const sig = compositeSig(prefs);
    setIsZipping(true);
    try {
      const zipItems: { blob: Blob; filename: string }[] = [];
      for (const item of doneItems) {
        let result = item.result as RemoveResult;
        if (!(item.resultSig === sig && item.resultIntent === "download")) {
          try {
            result = await recompositeViaWorker({
              options: prefs,
              requestId: ++reqIdRef.current,
              itemKey: item.id,
              encodeIntent: "download",
            });
          } catch {
            const bytes = await readFileBytes(item.file);
            result = await removeViaWorker({
              input: bytes,
              inputFormat: item.format,
              options: prefs,
              requestId: ++reqIdRef.current,
              itemKey: item.id,
              encodeIntent: "download",
            });
          }
          applyResult(item.id, result, sig, "download");
        }
        zipItems.push({
          blob: new Blob([result.bytes as BlobPart], { type: result.mime }),
          filename: buildCutoutFilename(item.file.name, result.ext),
        });
      }
      const zip = await createBatchZip(zipItems);
      downloadBlob(zip, "cutouts.zip");
    } catch {
      setError("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  }, [prefs, isZipping, applyResult]);

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasQueue = items.length > 0;
  const hasSelected = Boolean(selectedItem);
  // The singleton worker (and the prefs that drive it) is busy whenever a batch/single run OR a
  // Download-ZIP re-encode is in flight — gate every worker-touching action and pref control on this
  // so they can't race the same worker or change the signature mid-zip (cursor round-2 #1/#3).
  const workerLocked = isBusy || isZipping || downloadingId !== null;

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "Enter",
          meta: true,
          handler: () => removeAll(),
          enabled: hasQueue && !workerLocked,
        },
      ],
      [hasQueue, workerLocked, removeAll],
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

  const dlPercent =
    dlProgress && dlProgress.total > 0
      ? Math.min(100, Math.round((dlProgress.current / dlProgress.total) * 100))
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
                        aria-label="Download all cutouts as ZIP"
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
                          <span className="block font-mono text-[11px] text-ink-3 tabular-nums">
                            {formatBytes(item.file.size)}
                            {item.status === "done" && item.result && (
                              <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true"> → </span>
                                <span className="font-semibold text-grass">cutout ready</span>
                              </span>
                            )}
                            {item.status === "processing" && " · removing…"}
                            {item.status === "error" && (
                              <span className="font-semibold text-tomato"> · {item.error}</span>
                            )}
                          </span>
                        </span>
                      </button>
                      {item.status === "done" && (
                        <button
                          type="button"
                          onClick={() => downloadItem(item)}
                          disabled={workerLocked}
                          className="wb-fade-in grid size-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-colors hover:bg-mint disabled:opacity-40 pointer-coarse:size-11"
                          aria-label={
                            downloadingId === item.id
                              ? `Preparing download of ${item.file.name}`
                              : `Download ${item.file.name}`
                          }
                        >
                          {downloadingId === item.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="size-4" aria-hidden="true" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={workerLocked}
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
              <div className="space-y-4 p-5 sm:p-6">
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
                      Downloading the AI model…
                    </p>
                    <div className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-paper">
                      <div
                        className={cn(
                          "h-full bg-lemon transition-[width] duration-200",
                          // Unknown total (no Content-Length yet) → an indeterminate pulsing sliver,
                          // not a full bar that falsely reads as "done" (cursor #3).
                          dlPercent === null && "animate-pulse",
                        )}
                        style={{ width: dlPercent === null ? "40%" : `${dlPercent}%` }}
                      />
                    </div>
                    <p className="text-[12.5px] text-ink-2">
                      Downloading the AI model (~5 MB) — one time, then it's cached. Your images
                      never leave your browser.
                    </p>
                  </div>
                ) : modelState === "error" ? (
                  <div className="space-y-3">
                    <ErrorAlert error={modelError} className="mt-0" />
                    <button
                      type="button"
                      onClick={ensureModelLoaded}
                      className="wb-btn wb-btn--ghost justify-center"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12.5px] text-ink-2">
                      The model downloads once (~5 MB) the first time you remove a background, then
                      it's cached. Your images never leave your browser.
                    </p>
                    <button
                      type="button"
                      onClick={ensureModelLoaded}
                      className="wb-btn wb-btn--ghost justify-center"
                    >
                      <Download className="size-4" aria-hidden="true" />
                      <span>Load model</span>
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Output controls */}
            <section className="wb-panel">
              <PaneHeader
                label="Output"
                icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
              />
              <div className="space-y-5 p-5 sm:p-6">
                <div className="space-y-2">
                  <Label className="text-ink-2">Mode</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {OUTPUT_MODES.map((opt) => {
                      const active = prefs.outputMode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={workerLocked}
                          onClick={() => setPrefs({ outputMode: opt.value })}
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
                  </div>
                </div>

                {prefs.outputMode === "color" && (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="bg-color" className="flex items-center gap-2 text-ink-2">
                      <Palette className="size-4" aria-hidden="true" />
                      Background color
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold uppercase tabular-nums text-ink-3">
                        {prefs.backgroundColor}
                      </span>
                      <input
                        id="bg-color"
                        type="color"
                        disabled={workerLocked}
                        value={prefs.backgroundColor}
                        onChange={(e) => setPrefs({ backgroundColor: e.target.value })}
                        className="size-9 shrink-0 cursor-pointer rounded-md border-2 border-ink bg-paper p-0.5 disabled:opacity-50"
                        aria-label="Background color"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-ink-2">Format</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMAT_OPTIONS.map((opt) => {
                      const active = prefs.format === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={workerLocked}
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
                  </div>
                </div>

                {/* Advanced (collapsible) */}
                <div className="border-t-2 border-ink pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                    className="flex w-full items-center justify-between text-[13px] font-bold text-ink"
                  >
                    <span>Advanced</span>
                    <ChevronDown
                      className={cn(
                        "size-4 transition-transform duration-200",
                        showAdvanced && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {showAdvanced && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-ink-2">Alpha threshold</Label>
                        <span className="font-mono text-[12px] font-bold tabular-nums text-tomato">
                          {prefs.alphaThreshold === 0 ? "soft" : prefs.alphaThreshold}
                        </span>
                      </div>
                      <Slider
                        aria-label="Alpha threshold"
                        min={0}
                        max={255}
                        step={1}
                        disabled={workerLocked}
                        value={[prefs.alphaThreshold]}
                        onValueChange={([v]) => setPrefs({ alphaThreshold: v ?? 0 })}
                      />
                      <p className="text-[11.5px] text-ink-3">
                        0 keeps a soft matte; higher values harden the cutout edge.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Preview */}
            <section className="wb-panel wb-panel--out">
              <PaneHeader
                label="Preview"
                icon={<ImageIcon className="size-4" aria-hidden="true" />}
                className="bg-paper-2"
              />
              <div className="p-5 sm:p-6">
                {!selectedItem ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center text-ink-3">
                    <span className="grid size-14 place-items-center rounded-[14px] border-2 border-ink-3 bg-paper">
                      <Scissors className="size-6" aria-hidden="true" />
                    </span>
                    <p className="text-sm">Upload and select an image to remove its background.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <figure className="space-y-2">
                        <figcaption className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          Original
                        </figcaption>
                        <div className="overflow-hidden rounded-md border-2 border-ink bg-paper">
                          <img
                            src={selectedItem.previewUrl}
                            alt="Original"
                            className="block max-h-[360px] w-full object-contain"
                            decoding="async"
                          />
                        </div>
                      </figure>
                      <figure className="space-y-2">
                        <figcaption className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          Cutout
                        </figcaption>
                        <div className="relative overflow-hidden rounded-md border-2 border-ink bg-[repeating-conic-gradient(var(--bg-3)_0_25%,var(--bg)_0_50%)] bg-[length:20px_20px]">
                          {cutoutUrl ? (
                            <img
                              src={cutoutUrl}
                              alt="Cutout"
                              className="block max-h-[360px] w-full object-contain"
                              decoding="async"
                            />
                          ) : (
                            <div className="flex min-h-[200px] items-center justify-center px-4 text-center text-[12.5px] text-ink-3">
                              Click “Remove background” to see the cutout.
                            </div>
                          )}
                          {previewBusy && (
                            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-paper px-2 py-0.5 text-[11px] font-bold shadow-pop-1">
                              <Loader2 className="size-3 animate-spin" aria-hidden="true" />{" "}
                              {previewBusy === "infer" ? "removing" : "updating"}
                            </span>
                          )}
                        </div>
                      </figure>
                    </div>

                    {previewResult && (
                      <div className="border-t-2 border-ink pt-4">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          Cutout size
                        </span>
                        <span className="ml-2 font-mono text-[14px] font-bold text-ink tabular-nums">
                          {formatBytes(previewResult.outputSize)}
                        </span>
                      </div>
                    )}

                    <p className="text-[12.5px] text-ink-2">
                      Works best on photos with a clear subject.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={removeSelected}
                  disabled={!hasSelected || workerLocked}
                  className="wb-btn wb-btn--ghost flex-1 justify-center py-3.5"
                >
                  <Scissors className="size-4" aria-hidden="true" />
                  <span>Remove background</span>
                </button>
                <button
                  type="button"
                  onClick={removeAll}
                  disabled={!hasQueue || workerLocked}
                  className="wb-btn flex-1 justify-center py-3.5 text-[15px]"
                >
                  <IconSwap swapKey={isBusy}>
                    {isBusy ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        <span>
                          Processing {progress.done} of {progress.total}…
                        </span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="size-4" aria-hidden="true" />
                        <span>Remove all</span>
                        <KbdHint>⌘⏎</KbdHint>
                      </>
                    )}
                  </IconSwap>
                </button>
                {isBusy && (
                  <button
                    type="button"
                    onClick={cancelBatch}
                    className="wb-btn wb-btn--ghost justify-center px-5"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {isBusy && progress.total > 1 && (
                <p className="text-center text-[12px] text-ink-3">
                  This can take a while for large batches.
                </p>
              )}
            </div>
          </div>
        }
      />
    </ToolShell>
  );
}
