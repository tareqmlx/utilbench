import { Check, Copy, Download, Info } from "lucide-react";
import { useCallback, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { type SchemaOptions, generateRootSchema } from "./schema";

const DEFAULT_PREFS = { required: true, includeTitle: false, inferFormats: true };

const EXAMPLE_INPUT = `{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "active": true
}`;

function tryGenerate(
  jsonStr: string,
  options: SchemaOptions,
): { output: string; error: string | null } {
  if (jsonStr.trim() === "") return { output: "", error: null };
  try {
    const parsed = JSON.parse(jsonStr);
    const schema = generateRootSchema(parsed, options);
    return { output: JSON.stringify(schema, null, 2), error: null };
  } catch (e) {
    return { output: "", error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

export default function JsonSchemaGeneratorRoute() {
  const [prefs, setPrefs] = useToolPreferences("json-schema-generator", DEFAULT_PREFS);
  const initial = tryGenerate(EXAMPLE_INPUT, {
    required: prefs.required,
    includeTitle: prefs.includeTitle,
    inferFormats: prefs.inferFormats,
  });
  const [input, setInput] = useState(EXAMPLE_INPUT);
  const [output, setOutput] = useState(initial.output);
  const [error, setError] = useState<string | null>(initial.error);
  const { copied, copy } = useClipboard();

  const generate = useCallback((jsonStr: string, opts: SchemaOptions) => {
    const result = tryGenerate(jsonStr, opts);
    setOutput(result.output);
    setError(result.error);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      generate(val, {
        required: prefs.required,
        includeTitle: prefs.includeTitle,
        inferFormats: prefs.inferFormats,
      });
    },
    [generate, prefs],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
  }, []);

  const handleCopy = useCallback(() => {
    copy(output);
  }, [copy, output]);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  const toggleRequired = useCallback(() => {
    const next = !prefs.required;
    setPrefs({ required: next });
    generate(input, {
      required: next,
      includeTitle: prefs.includeTitle,
      inferFormats: prefs.inferFormats,
    });
  }, [generate, input, prefs, setPrefs]);

  const toggleIncludeTitle = useCallback(() => {
    const next = !prefs.includeTitle;
    setPrefs({ includeTitle: next });
    generate(input, {
      required: prefs.required,
      includeTitle: next,
      inferFormats: prefs.inferFormats,
    });
  }, [generate, input, prefs, setPrefs]);

  const toggleInferFormats = useCallback(() => {
    const next = !prefs.inferFormats;
    setPrefs({ inferFormats: next });
    generate(input, {
      required: prefs.required,
      includeTitle: prefs.includeTitle,
      inferFormats: next,
    });
  }, [generate, input, prefs, setPrefs]);

  const inputRingClass =
    input.trim() === ""
      ? ""
      : error !== null
        ? "ring-2 ring-tomato/60 border-transparent"
        : "ring-2 ring-grass/60 border-transparent";

  return (
    <ToolShell className="sm:py-10">
      <TwoPane
        gap="8"
        left={
          <div className="space-y-4">
            <PaneHeader
              label="Input Raw JSON"
              htmlFor="schema-input"
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={handleClear}
                  className="text-xs font-bold"
                >
                  Clear
                </Button>
              }
            />

            <div className="relative">
              <Textarea
                id="schema-input"
                value={input}
                onChange={handleInputChange}
                className={`h-[500px] resize-none font-mono text-sm shadow-sm transition-all ${inputRingClass}`}
                placeholder='{ "id": 1, "name": "John Doe", "active": true }'
              />
            </div>

            <Card>
              <CardContent className="pt-6 sm:pt-6">
                <h4 className="mb-4 text-sm font-bold text-foreground">Generation Settings</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="jsonschema-required"
                      checked={prefs.required}
                      onCheckedChange={toggleRequired}
                    />
                    <Label htmlFor="jsonschema-required">Make all fields required</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="jsonschema-includetitle"
                      checked={prefs.includeTitle}
                      onCheckedChange={toggleIncludeTitle}
                    />
                    <Label htmlFor="jsonschema-includetitle">
                      Include generic Title/Description
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="jsonschema-inferformats"
                      checked={prefs.inferFormats}
                      onCheckedChange={toggleInferFormats}
                    />
                    <Label htmlFor="jsonschema-inferformats">
                      Infer string formats (email, date, uri)
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        }
        right={
          <div className="space-y-4">
            <PaneHeader
              label="Generated Schema"
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={handleCopy} disabled={!output}>
                    <IconSwap swapKey={copied}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "Copied!" : "Copy"}
                    </IconSwap>
                  </Button>
                  <Button size="sm" onClick={handleDownload} disabled={!output}>
                    <Download className="size-3.5" />
                    Download
                  </Button>
                </>
              }
            />

            <div className="relative">
              <div className="h-[500px] w-full overflow-auto rounded-lg border-2 border-ink bg-ink p-5 shadow-pop-3">
                <pre className="font-mono text-sm text-paper">
                  <code>
                    {output || "Your generated JSON Schema will appear here as you type..."}
                  </code>
                </pre>
              </div>
            </div>

            <Card className="bg-muted">
              <CardContent className="pt-6 sm:pt-6">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 size-4 text-muted-foreground" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Our generator uses a recursive inference engine to detect object shapes, array
                    item types, and common string formats. You can customize the schema further by
                    using the Utilbench Schema Editor.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        }
      />

      <ErrorAlert error={error} />
    </ToolShell>
  );
}
