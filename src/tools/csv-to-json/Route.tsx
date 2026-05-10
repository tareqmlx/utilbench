import { Check, Copy, Download, FileUp, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
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
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { parseCsvToJson } from "./csv";
import type { Delimiter } from "./csv";

const DEFAULT_CSV = `Column1,Column2,Column3
Value1,Value2,Value3
Value4,Value5,Value6`;

const INITIAL_OUTPUT = parseCsvToJson(DEFAULT_CSV, { hasHeader: true, delimiter: "," });

const DELIMITER_OPTIONS: { label: string; value: Delimiter }[] = [
  { label: "Comma (,)", value: "," },
  { label: "Semicolon (;)", value: ";" },
  { label: "Tab (\\t)", value: "\t" },
  { label: "Pipe (|)", value: "|" },
];

const DEFAULT_PREFS = { hasHeader: true, delimiter: "," as Delimiter };

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt"];

function isAcceptableFile(file: File): boolean {
  if (file.size > MAX_FILE_BYTES) return false;
  const lowerName = file.name.toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (extOk) return true;
  if (!file.type) return false;
  return file.type.startsWith("text/") || file.type === "application/csv";
}

export default function CsvToJsonRoute() {
  const [input, setInput] = useState(DEFAULT_CSV);
  const [output, setOutput] = useState(INITIAL_OUTPUT.result);
  const [error, setError] = useState<string | null>(INITIAL_OUTPUT.error);
  const [prefs, setPrefs] = useToolPreferences("csv-to-json", DEFAULT_PREFS);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useClipboard();

  const runConversion = useCallback((csv: string, hdr: boolean, delim: Delimiter) => {
    const { result, error: convError } = parseCsvToJson(csv, { hasHeader: hdr, delimiter: delim });
    setOutput(result);
    setError(convError);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      runConversion(val, prefs.hasHeader, prefs.delimiter);
    },
    [prefs.hasHeader, prefs.delimiter, runConversion],
  );

  const handleHeaderToggle = useCallback(() => {
    const next = !prefs.hasHeader;
    setPrefs({ hasHeader: next });
    runConversion(input, next, prefs.delimiter);
  }, [prefs.hasHeader, prefs.delimiter, input, setPrefs, runConversion]);

  const handleDelimiterChange = useCallback(
    (value: string) => {
      const next = value as Delimiter;
      setPrefs({ delimiter: next });
      runConversion(input, prefs.hasHeader, next);
    },
    [input, prefs.hasHeader, setPrefs, runConversion],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
  }, []);

  const ingestFile = useCallback(
    (file: File) => {
      if (!isAcceptableFile(file)) {
        if (file.size > MAX_FILE_BYTES) {
          setError(`File too large. Max ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
        } else {
          setError("Unsupported file type. Drop a .csv, .tsv, or text file.");
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setInput(text);
        runConversion(text, prefs.hasHeader, prefs.delimiter);
      };
      reader.onerror = () => {
        setError("Could not read the file. Try again or paste the contents instead.");
      };
      reader.readAsText(file);
    },
    [prefs.hasHeader, prefs.delimiter, runConversion],
  );

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
    copy(output);
  }, [copy, output]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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
      if (!file) return;
      ingestFile(file);
    },
    [ingestFile],
  );

  return (
    <ToolShell className="sm:py-8">
      <TwoPane
        gap="8"
        left={
          <div className="flex flex-col gap-4">
            <PaneHeader
              label="CSV Input"
              htmlFor="csv-input"
              actions={
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="csv-hasheader"
                      checked={prefs.hasHeader}
                      onCheckedChange={handleHeaderToggle}
                    />
                    <Label htmlFor="csv-hasheader">Header row</Label>
                  </div>
                  <Select value={prefs.delimiter} onValueChange={handleDelimiterChange}>
                    <SelectTrigger className="h-8 w-[140px] text-xs font-medium">
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
              }
            />

            <div
              className="relative flex min-h-[250px] sm:min-h-[400px] flex-grow flex-col"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div
                className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 ${isDragging ? "opacity-100" : input ? "opacity-0" : "opacity-50"}`}
              >
                <Upload className="mb-2 size-10 text-muted-foreground" />
                <p className="text-sm">Drag &amp; drop a .csv file or paste below</p>
              </div>
              <Textarea
                id="csv-input"
                placeholder={"Column1,Column2,Column3\nValue1,Value2,Value3\nValue4,Value5,Value6"}
                className="z-10 h-full min-h-[250px] sm:min-h-[400px] resize-none bg-transparent font-mono text-sm leading-relaxed"
                value={input}
                onChange={handleInputChange}
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleFileButtonClick}>
                <FileUp className="size-4" /> Choose .csv file
              </Button>
              <Button variant="secondary" onClick={handleClear}>
                Clear
              </Button>
            </div>
          </div>
        }
        right={
          <div className="flex flex-col gap-4">
            <PaneHeader
              label="JSON Output"
              className="h-[24px]"
              actions={
                <div className="flex items-center gap-3">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleCopy}
                    className="text-xs font-bold"
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "Copied!" : "Copy"}
                    </IconSwap>
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleDownload}
                    className="text-xs font-bold"
                  >
                    <Download className="size-3.5" /> Download
                  </Button>
                </div>
              }
            />

            <div className="relative h-full min-h-[250px] sm:min-h-[400px] rounded-lg border border-border bg-card p-6 dark:bg-black">
              <pre className="max-h-[500px] overflow-auto font-mono text-sm text-emerald-400">
                <code>{output}</code>
              </pre>
              <div className="absolute bottom-4 right-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                UTF-8 JSON
              </div>
            </div>
          </div>
        }
      />

      <ErrorAlert error={error} />
    </ToolShell>
  );
}
