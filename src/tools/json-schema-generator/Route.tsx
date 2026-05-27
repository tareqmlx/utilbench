import { Check, ClipboardPaste, Copy, Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, StatusBadge, ToolShell } from "../../components/tool-layout";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import { type JsonSchema, type SchemaOptions, generateRootSchema } from "./schema";

const DEFAULT_PREFS = { required: true, includeTitle: false, inferFormats: true };

const EXAMPLE_INPUT = `{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "active": true
}`;

const PLACEHOLDER = '{ "id": 1, "name": "John Doe", "active": true }';

const EMPTY_HINT = "Your generated JSON Schema will appear here as you type...";

const numberFormatter = new Intl.NumberFormat("en-US");
const textEncoder = new TextEncoder();

interface SchemaStats {
  properties: number;
  depth: number;
  bytes: number;
}

function walkSchema(schema: JsonSchema, depth: number, acc: { props: number; max: number }) {
  acc.max = Math.max(acc.max, depth);
  if (schema.properties) {
    const keys = Object.keys(schema.properties);
    acc.props += keys.length;
    for (const k of keys) {
      const child = schema.properties[k];
      if (child) walkSchema(child, depth + 1, acc);
    }
  }
  if (schema.items) walkSchema(schema.items, depth + 1, acc);
  if (schema.anyOf) {
    for (const branch of schema.anyOf) walkSchema(branch, depth, acc);
  }
}

function computeStats(output: string, schema: JsonSchema | null): SchemaStats {
  const acc = { props: 0, max: 0 };
  if (schema) walkSchema(schema, 1, acc);
  return {
    properties: acc.props,
    depth: acc.max,
    bytes: textEncoder.encode(output).length,
  };
}

interface GenerateResult {
  output: string;
  schema: JsonSchema | null;
  error: string | null;
}

function tryGenerate(jsonStr: string, options: SchemaOptions): GenerateResult {
  if (jsonStr.trim() === "") return { output: "", schema: null, error: null };
  try {
    const parsed = JSON.parse(jsonStr);
    const schema = generateRootSchema(parsed, options);
    return { output: JSON.stringify(schema, null, 2), schema, error: null };
  } catch (e) {
    return {
      output: "",
      schema: null,
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
}

interface SettingRowProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}

function SettingRow({ id, label, hint, checked, onChange }: SettingRowProps) {
  const descId = `${id}-desc`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer text-sm font-semibold text-ink">
          {label}
        </Label>
        <span id={descId} className="text-[12.5px] leading-snug text-ink-3">
          {hint}
        </span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={descId} />
    </div>
  );
}

export default function JsonSchemaGeneratorRoute() {
  const [prefs, setPrefs] = useToolPreferences("json-schema-generator", DEFAULT_PREFS);
  const options = useMemo<SchemaOptions>(
    () => ({
      required: prefs.required,
      includeTitle: prefs.includeTitle,
      inferFormats: prefs.inferFormats,
    }),
    [prefs.required, prefs.includeTitle, prefs.inferFormats],
  );

  const [input, setInput] = useState(EXAMPLE_INPUT);
  const [justPasted, setJustPasted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { copied, copy, readClipboard } = useClipboard();

  useEffect(
    () => () => {
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    },
    [],
  );

  const result = useMemo(() => tryGenerate(input, options), [input, options]);
  const { output, schema, error } = result;
  const isEmpty = input.trim() === "";

  const stats = useMemo(() => computeStats(output, schema), [output, schema]);

  const statusState: "idle" | "invalid" | "valid" = isEmpty
    ? "idle"
    : error !== null
      ? "invalid"
      : "valid";

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handlePaste = useCallback(async () => {
    const text = await readClipboard();
    if (text === null) return;
    setInput(text);
    setJustPasted(true);
    setStatusMessage("JSON pasted from clipboard.");
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => setJustPasted(false), 1500);
  }, [readClipboard]);

  const handleClear = useCallback(() => {
    setInput("");
    setStatusMessage("Input cleared.");
  }, []);

  const handleCopy = useCallback(() => {
    if (!output) return;
    copy(output);
    setStatusMessage("Schema copied to clipboard.");
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
    setStatusMessage("Schema downloaded as schema.json.");
  }, [output]);

  const toggleRequired = useCallback(() => {
    setPrefs({ required: !prefs.required });
  }, [prefs.required, setPrefs]);

  const toggleIncludeTitle = useCallback(() => {
    setPrefs({ includeTitle: !prefs.includeTitle });
  }, [prefs.includeTitle, setPrefs]);

  const toggleInferFormats = useCallback(() => {
    setPrefs({ inferFormats: !prefs.inferFormats });
  }, [prefs.inferFormats, setPrefs]);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "c",
          meta: true,
          shift: true,
          handler: handleCopy,
          enabled: !!output,
        },
        {
          key: "s",
          meta: true,
          handler: handleDownload,
          enabled: !!output,
        },
      ],
      [handleCopy, handleDownload, output],
    ),
  );

  const statsLabel = useMemo(() => {
    if (!schema) return "";
    const parts: string[] = [];
    parts.push(
      `${numberFormatter.format(stats.properties)} ${stats.properties === 1 ? "prop" : "props"}`,
    );
    parts.push(`${numberFormatter.format(stats.depth)} ${stats.depth === 1 ? "level" : "levels"}`);
    parts.push(`${numberFormatter.format(stats.bytes)} B`);
    return parts.join(" · ");
  }, [schema, stats.properties, stats.depth, stats.bytes]);

  const outputStateKey = output ? "f" : "e";

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Input */}
          <section className="wb-panel">
            <PaneHeader
              label="Input JSON"
              htmlFor="schema-input"
              trailing={
                <span key={statusState} className="wb-fade-in inline-flex">
                  <StatusBadge
                    tone={statusState === "idle" ? "neutral" : statusState}
                    label={
                      statusState === "idle"
                        ? "Empty"
                        : statusState === "invalid"
                          ? "Invalid"
                          : "Valid"
                    }
                  />
                </span>
              }
              actions={
                <>
                  <button
                    type="button"
                    onClick={handlePaste}
                    aria-label="Paste from clipboard"
                    className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  >
                    <IconSwap swapKey={justPasted}>
                      {justPasted ? (
                        <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                      ) : (
                        <ClipboardPaste className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{justPasted ? "Pasted" : "Paste"}</span>
                    </IconSwap>
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    aria-label="Clear input"
                    disabled={isEmpty}
                    className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                </>
              }
            />
            <div className="p-3 sm:p-4">
              <textarea
                id="schema-input"
                value={input}
                onChange={handleInputChange}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder={PLACEHOLDER}
                aria-describedby={error ? "schema-input-error" : undefined}
                aria-invalid={error !== null || undefined}
                className={cn(
                  "h-[460px] w-full resize-none rounded-md bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3",
                  "border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                  statusState === "invalid"
                    ? "border-tomato"
                    : statusState === "valid"
                      ? "border-ink"
                      : "border-ink/40",
                )}
              />
              {error && (
                <p
                  id="schema-input-error"
                  role="alert"
                  className="wb-fade-in mt-3 rounded-md border-2 border-tomato bg-paper px-3 py-2 font-mono text-[12.5px] text-ink"
                >
                  <span className="font-semibold text-tomato">Parse error: </span>
                  {error}
                </p>
              )}
            </div>
          </section>

          {/* Output */}
          <section className="wb-panel wb-panel--out">
            <PaneHeader
              label="Generated Schema"
              className="bg-paper-2"
              trailing={
                schema ? (
                  <span
                    className="wb-mono-sm tabular-nums text-ink-2 transition-opacity duration-200"
                    aria-hidden="true"
                  >
                    {statsLabel}
                  </span>
                ) : null
              }
              actions={
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy schema"
                    disabled={!output}
                    className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? (
                        <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{copied ? "Copied!" : "Copy"}</span>
                    </IconSwap>
                    <KbdHint>⌘⇧C</KbdHint>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    aria-label="Download schema.json"
                    disabled={!output}
                    className="wb-btn wb-btn--sm min-h-11 sm:min-h-0"
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    <span>Download</span>
                    <KbdHint>⌘S</KbdHint>
                  </button>
                </>
              }
            />
            <div className="p-3 sm:p-4">
              <div
                key={outputStateKey}
                className="wb-fade-in h-[460px] overflow-auto rounded-md bg-ink p-4 sm:p-5"
              >
                {output ? (
                  <pre className="font-mono text-[13px] leading-relaxed text-paper">
                    <code>{output}</code>
                  </pre>
                ) : (
                  <p className="font-mono text-[12.5px] italic text-ink-muted">{EMPTY_HINT}</p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Settings */}
        <section className="wb-panel" aria-labelledby="schema-settings-label">
          <PaneHeader label="Generation settings" labelId="schema-settings-label" />
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:p-6 md:grid-cols-3">
            <SettingRow
              id="jsonschema-required"
              label="Mark all fields as required"
              hint="Adds every detected key to the schema's required array."
              checked={prefs.required}
              onChange={toggleRequired}
            />
            <SettingRow
              id="jsonschema-includetitle"
              label="Include Title & Description"
              hint="Annotates the root and each property with a humanized title."
              checked={prefs.includeTitle}
              onChange={toggleIncludeTitle}
            />
            <SettingRow
              id="jsonschema-inferformats"
              label="Infer string formats"
              hint="Detects email, uri, date, date-time, uuid, ipv4."
              checked={prefs.inferFormats}
              onChange={toggleInferFormats}
            />
          </div>
        </section>
      </div>
    </ToolShell>
  );
}
