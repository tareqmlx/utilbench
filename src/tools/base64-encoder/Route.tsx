import { Check, Copy, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { useUrlState } from "../../hooks/useUrlState";
import { convert } from "./base64";
import type { Mode } from "./base64";

const DEFAULT_PREFS = { mode: "encode" as Mode };

const URL_SCHEMA = {
  mode: { type: "string" as const, defaultValue: "encode" },
};

export default function Base64EncoderRoute() {
  const [prefs, setPrefs] = useToolPreferences("base64-encoder", DEFAULT_PREFS);
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeMode = (urlState.mode || prefs.mode) as Mode;
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      const { result, error: convError } = convert(val, activeMode);
      setOutput(result);
      setError(convError);
    },
    [activeMode],
  );

  const handleModeSwitch = useCallback(
    (newMode: Mode) => {
      setPrefs({ mode: newMode });
      setUrlState({ mode: newMode });
      const { result, error: convError } = convert(input, newMode);
      setOutput(result);
      setError(convError);
    },
    [input, setPrefs, setUrlState],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
  }, []);

  const handleCopy = useCallback(() => {
    copy(output);
  }, [copy, output]);

  const inputLabel = activeMode === "encode" ? "Input String" : "Base64 Input";
  const outputLabel = activeMode === "encode" ? "Base64 Result" : "Decoded Text";

  return (
    <ToolShell>
      <TwoPane
        left={
          <Card className="flex h-full flex-col border-primary/10 p-6">
            <PaneHeader
              label={inputLabel}
              htmlFor="base64-input"
              actions={
                <Tabs value={activeMode} onValueChange={(v) => handleModeSwitch(v as Mode)}>
                  <TabsList>
                    <TabsTrigger value="encode" className="text-xs font-bold">
                      ENCODE
                    </TabsTrigger>
                    <TabsTrigger value="decode" className="text-xs font-bold">
                      DECODE
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            />
            <Textarea
              id="base64-input"
              className="h-48 resize-none sm:h-80 font-mono text-sm"
              placeholder="Enter or paste your content here..."
              value={input}
              onChange={handleInputChange}
            />
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={handleClear}>
                <Trash2 className="size-4" />
                Clear
              </Button>
            </div>
          </Card>
        }
        right={
          <Card className="flex h-full flex-col border-primary/10 p-6">
            <PaneHeader label={outputLabel} htmlFor="base64-output" className="h-[38px]" />
            <Textarea
              id="base64-output"
              className="h-48 resize-none sm:h-80 bg-muted font-mono text-sm text-muted-foreground"
              placeholder="Result will appear here..."
              readOnly
              value={output}
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleCopy}>
                <IconSwap swapKey={copied}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied!" : "Copy Result"}
                </IconSwap>
              </Button>
            </div>
          </Card>
        }
      />

      <ErrorAlert error={error} />
    </ToolShell>
  );
}
