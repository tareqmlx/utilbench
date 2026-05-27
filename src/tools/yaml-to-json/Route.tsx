import { Check, ClipboardPaste, Copy, Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  CodePreview,
  ErrorAlert,
  PaneHeader,
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

export default function YamlToJsonRoute() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences("yaml-to-json", DEFAULT_PREFS);
  const { copied, copy } = useClipboard();
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!downloaded) return;
    const t = setTimeout(() => setDownloaded(false), 1500);
    return () => clearTimeout(t);
  }, [downloaded]);

  const runConversion = useCallback((value: string, pretty: boolean) => {
    if (!value) {
      setOutput("");
      setError(null);
      return;
    }
    const { result, error: convError } = convertYamlToJson(value, pretty);
    setOutput(result);
    setError(convError);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      runConversion(value, prefs.prettyPrint);
    },
    [prefs.prettyPrint, runConversion],
  );

  const handlePasteExample = useCallback(() => {
    setInput(SAMPLE_YAML);
    runConversion(SAMPLE_YAML, prefs.prettyPrint);
  }, [prefs.prettyPrint, runConversion]);

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
  }, []);

  const handlePrettyPrintToggle = useCallback(() => {
    const next = !prefs.prettyPrint;
    setPrefs({ prettyPrint: next });
    runConversion(input, next);
  }, [prefs.prettyPrint, input, setPrefs, runConversion]);

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

  const inputRingClass =
    input.trim() === ""
      ? ""
      : error !== null
        ? "ring-2 ring-tomato/60 border-transparent"
        : "ring-2 ring-grass/60 border-transparent";

  return (
    <ToolShell>
      <TwoPane
        className="items-start"
        left={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="YAML Input"
              htmlFor="yaml-input"
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={handlePasteExample}>
                    <ClipboardPaste className="size-4" />
                    Paste example
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
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
                  <Button variant="outline" size="sm" disabled={!output} onClick={handleCopy}>
                    <IconSwap swapKey={copied}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied!" : "Copy"}
                    </IconSwap>
                    <KbdHint>⌘⇧C</KbdHint>
                  </Button>
                  <Button variant="outline" size="sm" disabled={!output} onClick={handleDownload}>
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
              emptyHint="Waiting for input — paste YAML or hit Paste example."
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

      <ErrorAlert error={error} />
    </ToolShell>
  );
}
