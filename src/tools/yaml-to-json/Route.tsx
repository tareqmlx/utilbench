import { Check, ClipboardPaste, Copy, Download, Trash2 } from "lucide-react";
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
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { SAMPLE_YAML, convertYamlToJson } from "./yaml";

const DEFAULT_PREFS = { prettyPrint: true };
const ERROR_ID = "yaml-error";
const OUTPUT_LABEL_ID = "yaml-output-label";

export default function YamlToJsonRoute() {
  const [input, setInput] = useState("");
  const deferredInput = useDeferredValue(input);
  const [prefs, setPrefs] = useToolPreferences("yaml-to-json", DEFAULT_PREFS);
  const { copied, copy } = useClipboard();
  const [downloaded, setDownloaded] = useState(false);
  const [status, setStatus] = useState("");
  const prevOutputRef = useRef("");

  const { output, error } = useMemo(() => {
    const r = convertYamlToJson(deferredInput, prefs.prettyPrint);
    return { output: r.result, error: r.error };
  }, [deferredInput, prefs.prettyPrint]);

  useEffect(() => {
    if (!downloaded) return;
    const t = setTimeout(() => setDownloaded(false), 1500);
    return () => clearTimeout(t);
  }, [downloaded]);

  useEffect(() => {
    if (error) return;
    const wasEmpty = prevOutputRef.current === "";
    const isEmpty = output === "";
    if (wasEmpty && !isEmpty) setStatus("YAML converted to JSON.");
    else if (!wasEmpty && isEmpty) setStatus("Output cleared.");
    prevOutputRef.current = output;
  }, [output, error]);

  useEffect(() => {
    if (copied) setStatus("JSON copied to clipboard.");
  }, [copied]);

  useEffect(() => {
    if (downloaded) setStatus("JSON downloaded as output.json.");
  }, [downloaded]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handlePasteExample = useCallback(() => {
    setInput(SAMPLE_YAML);
  }, []);

  const handleClear = useCallback(() => {
    setInput("");
  }, []);

  const handlePrettyPrintToggle = useCallback(() => {
    setPrefs({ prettyPrint: !prefs.prettyPrint });
  }, [prefs.prettyPrint, setPrefs]);

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
    setDownloaded(true);
  }, [output]);

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "c", meta: true, shift: true, handler: handleCopy, enabled: output.length > 0 },
        { key: "x", meta: true, shift: true, handler: handleClear },
      ],
      [handleCopy, handleClear, output.length],
    ),
  );

  const hasInput = input.trim() !== "";
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
        className="items-start"
        left={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="YAML Input"
              htmlFor="yaml-input"
              trailing={
                hasInput ? (
                  <StatusBadge
                    tone={error !== null ? "invalid" : "valid"}
                    label={error !== null ? "Error" : "Valid"}
                  />
                ) : null
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    onClick={handlePasteExample}
                  >
                    <ClipboardPaste className="size-4" />
                    Paste example
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-4 sm:h-9 sm:px-3"
                    onClick={handleClear}
                    aria-label="Clear input"
                  >
                    <Trash2 className="size-4" />
                    Clear
                    <KbdHint>⌘⇧X</KbdHint>
                  </Button>
                </>
              }
            />
            <Textarea
              id="yaml-input"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? ERROR_ID : undefined}
              className={`min-h-[400px] sm:min-h-[500px] resize-none font-mono text-sm leading-relaxed transition-[box-shadow,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${inputRingClass}`}
              placeholder={`---
# Enter your YAML here
name: Utilbench Tool
version: 1.0.0
features:
  - parsing
  - validation
  - export`}
              value={input}
              onChange={handleInputChange}
            />
          </div>
        }
        right={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="JSON Output"
              labelId={OUTPUT_LABEL_ID}
              actions={
                <>
                  <div className="mr-1 flex items-center gap-2">
                    <Switch
                      id="yaml-prettyprint"
                      checked={prefs.prettyPrint}
                      onCheckedChange={handlePrettyPrintToggle}
                    />
                    <Label htmlFor="yaml-prettyprint" className="text-xs">
                      Pretty print
                    </Label>
                  </div>
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
              emptyHint="Waiting for input. Paste YAML, or hit Paste example."
              aria-labelledby={OUTPUT_LABEL_ID}
              className="min-h-[400px] sm:min-h-[500px]"
            >
              <code
                key={prefs.prettyPrint ? "pretty" : "compact"}
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
