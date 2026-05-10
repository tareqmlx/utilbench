import { Check, ClipboardPaste, Copy, Download, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { SAMPLE_YAML, convertYamlToJson } from "./yaml";

const DEFAULT_PREFS = { prettyPrint: true };

export default function YamlToJsonRoute() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useToolPreferences("yaml-to-json", DEFAULT_PREFS);
  const { copied, copy } = useClipboard();

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
  }, [output]);

  return (
    <ToolShell>
      <TwoPane
        gap="8"
        className="items-start"
        left={
          <div className="flex flex-col gap-4">
            <PaneHeader
              label="YAML Input"
              htmlFor="yaml-input"
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={handlePasteExample}
                  className="text-xs font-semibold"
                >
                  <ClipboardPaste className="size-3" />
                  Paste Example
                </Button>
              }
            />
            <div className="group relative">
              <Textarea
                id="yaml-input"
                className="min-h-[500px] font-mono text-sm leading-relaxed"
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
              <div className="absolute bottom-4 right-4 flex gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleClear}
                  aria-label="Clear input"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        }
        right={
          <div className="flex flex-col gap-4">
            <PaneHeader
              label="JSON Output"
              actions={
                <div className="flex gap-4">
                  <Button
                    variant="link"
                    size="sm"
                    disabled={!output}
                    onClick={handleCopy}
                    className="text-xs font-semibold"
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copied ? "Copied!" : "Copy"}
                    </IconSwap>
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    disabled={!output}
                    onClick={handleDownload}
                    className="text-xs font-semibold"
                  >
                    <Download className="size-3" />
                    Download
                  </Button>
                </div>
              }
            />
            <div className="group relative">
              {output ? (
                <pre className="min-h-[500px] w-full overflow-auto rounded-md border border-border bg-muted p-6 font-mono text-sm leading-relaxed shadow-inner">
                  <code>{output}</code>
                </pre>
              ) : (
                <div className="min-h-[500px] w-full overflow-auto rounded-md border border-border bg-muted p-6 font-mono text-sm leading-relaxed text-muted-foreground shadow-inner italic">
                  {"{"}
                  <br />
                  &nbsp;&nbsp;&quot;status&quot;: &quot;Waiting for input...&quot;,
                  <br />
                  &nbsp;&nbsp;&quot;action&quot;: &quot;Start typing or paste the example&quot;
                  <br />
                  {"}"}
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className="mt-8 flex items-center justify-center gap-2">
        <Switch
          id="yaml-prettyprint"
          checked={prefs.prettyPrint}
          onCheckedChange={handlePrettyPrintToggle}
        />
        <Label htmlFor="yaml-prettyprint">Pretty Print</Label>
      </div>

      <ErrorAlert error={error} />
    </ToolShell>
  );
}
