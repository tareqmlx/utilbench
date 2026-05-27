import { Check, ClipboardPaste, Copy, Download, FileUp, Trash2, Upload } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  CodePreview,
  ErrorAlert,
  PaneHeader,
  StatusBadge,
  ToolShell,
  TwoPane,
} from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { parseCsvToJson } from "./csv";
import type { Delimiter } from "./csv";

const DEFAULT_CSV = `Column1,Column2,Column3
Value1,Value2,Value3
Value4,Value5,Value6`;

const DELIMITER_OPTIONS: { label: string; value: Delimiter }[] = [
  { label: "Comma (,)", value: "," },
  { label: "Semicolon (;)", value: ";" },
  { label: "Tab (\\t)", value: "\t" },
  { label: "Pipe (|)", value: "|" },
];

const DEFAULT_PREFS = { hasHeader: true, delimiter: "," as Delimiter };

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt"];

const ERROR_ID = "csv-error";
const OUTPUT_LABEL_ID = "csv-output-label";

const numberFormatter = new Intl.NumberFormat("en-US");
const textEncoder = new TextEncoder();

function isAcceptableFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: `File too large. Max ${MAX_FILE_BYTES / (1024 * 1024)} MB.` };
  }
  const lowerName = file.name.toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (extOk) return { ok: true };
  if (file.type && (file.type.startsWith("text/") || file.type === "application/csv")) {
    return { ok: true };
  }
  return { ok: false, reason: "Unsupported file type. Drop a .csv, .tsv, or text file." };
}

export default function CsvToJsonRoute() {
  const [input, setInput] = useState(DEFAULT_CSV);
  const [fileError, setFileError] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences("csv-to-json", DEFAULT_PREFS);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useClipboard();
  const [downloaded, setDownloaded] = useState(false);
  const [status, setStatus] = useState("");
  const prevOutputRef = useRef("");

  const deferredInput = useDeferredValue(input);

  const { output, parseError } = useMemo(() => {
    const r = parseCsvToJson(deferredInput, {
      hasHeader: prefs.hasHeader,
      delimiter: prefs.delimiter,
    });
    return { output: r.result, parseError: r.error };
  }, [deferredInput, prefs.hasHeader, prefs.delimiter]);

  const error = fileError ?? parseError;

  useEffect(() => {
    if (!downloaded) return;
    const t = setTimeout(() => setDownloaded(false), 1500);
    return () => clearTimeout(t);
  }, [downloaded]);

  useEffect(() => {
    if (parseError) return;
    const wasEmpty = prevOutputRef.current === "";
    const isEmpty = output === "";
    if (wasEmpty && !isEmpty) setStatus("CSV converted to JSON.");
    else if (!wasEmpty && isEmpty) setStatus("Output cleared.");
    prevOutputRef.current = output;
  }, [output, parseError]);

  useEffect(() => {
    if (copied) setStatus("JSON copied to clipboard.");
  }, [copied]);

  useEffect(() => {
    if (downloaded) setStatus("JSON downloaded as output.json.");
  }, [downloaded]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setFileError(null);
  }, []);

  const handleHeaderToggle = useCallback(() => {
    setPrefs({ hasHeader: !prefs.hasHeader });
  }, [prefs.hasHeader, setPrefs]);

  const handleDelimiterChange = useCallback(
    (value: string) => {
      setPrefs({ delimiter: value as Delimiter });
    },
    [setPrefs],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setFileError(null);
  }, []);

  const handlePasteExample = useCallback(() => {
    setInput(DEFAULT_CSV);
    setFileError(null);
  }, []);

  const ingestFile = useCallback((file: File) => {
    const check = isAcceptableFile(file);
    if (!check.ok) {
      setFileError(check.reason);
      return;
    }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setInput(text);
      setStatus(`Loaded ${file.name}.`);
    };
    reader.onerror = () => {
      setFileError("Could not read the file. Try again or paste the contents instead.");
    };
    reader.readAsText(file);
  }, []);

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) ingestFile(file);
      e.target.value = "";
    },
    [ingestFile],
  );

  const handleCopy = useCallback(() => {
    if (!output) return;
    copy(output);
  }, [copy, output]);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.json";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }, [output]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      ingestFile(file);
    },
    [ingestFile],
  );

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "c", meta: true, shift: true, handler: handleCopy, enabled: output.length > 0 },
        { key: "x", meta: true, shift: true, handler: handleClear },
      ],
      [handleCopy, handleClear, output.length],
    ),
  );

  const outputMeta = useMemo(() => {
    if (!output) return null;
    const bytes = textEncoder.encode(output).length;
    let rows = 0;
    for (let i = 0; i < output.length; i++) {
      if (output[i] === "{") rows++;
    }
    return {
      rows,
      bytes,
      label: `${numberFormatter.format(rows)} ${rows === 1 ? "row" : "rows"} · ${numberFormatter.format(bytes)} B`,
    };
  }, [output]);

  const hasInput = input.trim() !== "";
  const statusTone: "valid" | "invalid" | "neutral" = !hasInput
    ? "neutral"
    : error !== null
      ? "invalid"
      : "valid";
  const statusLabel = !hasInput ? "Empty" : error !== null ? "Error" : "Valid";
  const inputRingClass = !hasInput
    ? ""
    : error !== null
      ? "ring-2 ring-tomato/60 border-transparent"
      : "ring-2 ring-grass/60 border-transparent";

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>
      <TwoPane
        gap="8"
        className="items-start"
        left={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="CSV Input"
              htmlFor="csv-input"
              trailing={
                <span key={statusTone} className="wb-fade-in inline-flex">
                  <StatusBadge tone={statusTone} label={statusLabel} />
                </span>
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    onClick={handlePasteExample}
                    aria-label="Paste example CSV"
                  >
                    <ClipboardPaste className="size-4" />
                    Paste example
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    onClick={handleFileButtonClick}
                    aria-label="Choose a CSV file"
                  >
                    <FileUp className="size-4" />
                    Upload file
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    onClick={handleClear}
                    disabled={!hasInput}
                    aria-label="Clear input"
                  >
                    <Trash2 className="size-4" />
                    Clear
                    <KbdHint>⌘⇧X</KbdHint>
                  </Button>
                </>
              }
            />

            <div className="flex items-center gap-4 px-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="csv-hasheader"
                  checked={prefs.hasHeader}
                  onCheckedChange={handleHeaderToggle}
                />
                <Label htmlFor="csv-hasheader" className="text-xs">
                  Header row
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="csv-delimiter" className="text-xs text-ink-3">
                  Delimiter
                </Label>
                <Select value={prefs.delimiter} onValueChange={handleDelimiterChange}>
                  <SelectTrigger
                    id="csv-delimiter"
                    className="h-11 w-[140px] text-xs font-medium sm:h-9"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIMITER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div
              className="relative flex min-h-[400px] sm:min-h-[500px] flex-grow flex-col"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Textarea
                id="csv-input"
                placeholder={"Column1,Column2,Column3\nValue1,Value2,Value3\nValue4,Value5,Value6"}
                className={`h-full min-h-[400px] sm:min-h-[500px] resize-none font-mono text-sm leading-relaxed transition-[box-shadow,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${inputRingClass}`}
                value={input}
                onChange={handleInputChange}
                aria-invalid={error !== null}
                aria-describedby={error !== null ? ERROR_ID : undefined}
              />
              {isDragging && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-10 flex animate-in flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-ink bg-paper-2/95 fade-in-0 text-ink duration-150"
                >
                  <Upload
                    className="size-8 animate-in zoom-in-50 duration-200"
                    strokeWidth={2.25}
                  />
                  <p className="font-mono text-[12px] uppercase tracking-wider">Drop to load</p>
                </div>
              )}
            </div>

            <p className="flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-wider text-ink-3">
              <Upload className="size-3.5" aria-hidden="true" />
              Drag a CSV file onto the textarea, or use Upload file.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={handleFileInputChange}
            />
          </div>
        }
        right={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="JSON Output"
              labelId={OUTPUT_LABEL_ID}
              trailing={
                outputMeta ? (
                  <span
                    key={outputMeta.label}
                    className="wb-fade-in font-mono text-[11px] tabular-nums text-ink-3"
                    aria-hidden="true"
                  >
                    {outputMeta.label}
                  </span>
                ) : null
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    disabled={!output}
                    onClick={handleCopy}
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied!" : "Copy"}
                    </IconSwap>
                    <KbdHint>⌘⇧C</KbdHint>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    disabled={!output}
                    onClick={handleDownload}
                  >
                    <IconSwap swapKey={downloaded}>
                      {downloaded ? <Check className="size-4" /> : <Download className="size-4" />}
                      {downloaded ? "Saved!" : "Download"}
                    </IconSwap>
                  </Button>
                </>
              }
            />

            <CodePreview
              isEmpty={!output}
              emptyHint="Waiting for input. Paste CSV on the left, or drop a file."
              aria-labelledby={OUTPUT_LABEL_ID}
              className="min-h-[400px] sm:min-h-[500px]"
            >
              <code
                key={`${prefs.delimiter}-${prefs.hasHeader ? "h" : "n"}`}
                className="block animate-in fade-in-0 duration-200"
              >
                {output}
              </code>
            </CodePreview>
          </div>
        }
      />

      <ErrorAlert error={error} id={ERROR_ID} />
    </ToolShell>
  );
}
