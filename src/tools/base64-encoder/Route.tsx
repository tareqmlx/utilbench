import { Check, Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import {
  ErrorAlert,
  PaneHeader,
  StatusBadge,
  type StatusTone,
  ToolShell,
} from "../../components/tool-layout";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { useUrlState } from "../../hooks/useUrlState";
import { convert } from "./base64";
import type { Mode } from "./base64";

const DEFAULT_PREFS = { mode: "encode" as Mode };

const URL_SCHEMA = {
  mode: { type: "string" as const, defaultValue: "encode" },
};

const MODES: { value: Mode; label: string }[] = [
  { value: "encode", label: "Encode" },
  { value: "decode", label: "Decode" },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const textEncoder = new TextEncoder();

function formatBytes(text: string): string {
  if (!text) return "";
  const bytes = textEncoder.encode(text).length;
  return `${numberFormatter.format(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
}

const ERROR_ID = "base64-input-error";

export default function Base64EncoderRoute() {
  const [prefs, setPrefs] = useToolPreferences("base64-encoder", DEFAULT_PREFS);
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeMode = (urlState.mode || prefs.mode) as Mode;
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
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
      if (newMode === activeMode) return;
      setPrefs({ mode: newMode });
      setUrlState({ mode: newMode });
      const { result, error: convError } = convert(input, newMode);
      setOutput(result);
      setError(convError);
      setStatus(newMode === "encode" ? "Switched to encode mode." : "Switched to decode mode.");
    },
    [activeMode, input, setPrefs, setUrlState],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
    setStatus("Input cleared.");
  }, []);

  const handleCopy = useCallback(() => {
    if (!output) return;
    copy(output);
  }, [copy, output]);

  useEffect(() => {
    if (copied) setStatus("Result copied to clipboard.");
  }, [copied]);

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "c", meta: true, shift: true, handler: handleCopy, enabled: output.length > 0 },
        { key: "x", meta: true, shift: true, handler: handleClear, enabled: input.length > 0 },
      ],
      [handleCopy, handleClear, input.length, output.length],
    ),
  );

  const inputLabel = activeMode === "encode" ? "Input String" : "Base64 Input";
  const outputLabel = activeMode === "encode" ? "Base64 Result" : "Decoded Text";
  const inputPlaceholder =
    activeMode === "encode"
      ? "Enter or paste your content here..."
      : "Paste Base64 here to decode...";
  const outputPlaceholder =
    activeMode === "encode" ? "Result will appear here..." : "Decoded text will appear here...";

  const isEmpty = input.length === 0;
  const inputMeta = !isEmpty ? formatBytes(input) : null;
  const outputMeta = output ? formatBytes(output) : null;
  const statusTone: StatusTone = isEmpty ? "neutral" : error !== null ? "invalid" : "valid";
  const statusLabel = isEmpty ? "Empty" : error !== null ? "Invalid" : "Valid";

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>

      <fieldset className="wb-fade-in mb-6 m-0 flex flex-wrap items-center gap-x-4 gap-y-3 border-0 p-0">
        <legend className="sr-only">Conversion mode</legend>
        <span
          aria-hidden="true"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
        >
          Mode
        </span>
        {MODES.map(({ value, label }) => {
          const isActive = activeMode === value;
          return (
            <button
              type="button"
              key={value}
              onClick={() => handleModeSwitch(value)}
              aria-pressed={isActive}
              className={`wb-chip ${isActive ? "on" : ""}`}
            >
              {label}
            </button>
          );
        })}
      </fieldset>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="wb-panel">
          <PaneHeader
            label={inputLabel}
            htmlFor="base64-input"
            trailing={
              <span key={statusTone} className="wb-fade-in inline-flex">
                <StatusBadge tone={statusTone} label={statusLabel} />
              </span>
            }
            actions={
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear input"
                disabled={isEmpty}
                className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                <span>Clear</span>
                <KbdHint>⌘⇧X</KbdHint>
              </button>
            }
          />
          <div className="p-3 sm:p-4">
            <textarea
              id="base64-input"
              value={input}
              onChange={handleInputChange}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder={inputPlaceholder}
              aria-invalid={error !== null || undefined}
              aria-describedby={error ? ERROR_ID : undefined}
              className={`h-72 w-full resize-none rounded-md bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 sm:h-96 lg:h-[460px] border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
                error !== null ? "border-tomato" : !isEmpty ? "border-ink" : "border-ink/40"
              }`}
            />
            <p
              key={isEmpty ? "empty" : "filled"}
              aria-hidden="true"
              className="wb-fade-in mt-2 min-h-[16px] text-right font-mono text-[11px] tabular-nums text-ink-3"
            >
              {inputMeta ?? ""}
            </p>
          </div>
        </section>

        <section className="wb-panel wb-panel--out">
          <PaneHeader
            label={outputLabel}
            htmlFor="base64-output"
            className="bg-paper-2"
            trailing={
              outputMeta ? (
                <span
                  key={`${activeMode}-${output.length === 0 ? "empty" : "filled"}`}
                  aria-hidden="true"
                  className="wb-fade-in font-mono text-[11px] tabular-nums text-ink-2"
                >
                  {outputMeta}
                </span>
              ) : null
            }
            actions={
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy result to clipboard"
                disabled={!output}
                className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
              >
                <IconSwap swapKey={copied}>
                  {copied ? (
                    <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </IconSwap>
                <span>{copied ? "Copied!" : "Copy"}</span>
                <KbdHint>⌘⇧C</KbdHint>
              </button>
            }
          />
          <div className="p-3 sm:p-4">
            <textarea
              key={activeMode}
              id="base64-output"
              readOnly
              value={output}
              placeholder={outputPlaceholder}
              spellCheck={false}
              className="wb-fade-in h-72 w-full resize-none rounded-md border-2 border-ink/40 bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-96 lg:h-[460px]"
            />
          </div>
        </section>
      </div>

      <ErrorAlert error={error} id={ERROR_ID} />

      <p className="mt-6 hidden items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 lg:flex">
        <span className="inline-flex items-center gap-1.5">
          <KbdHint>⌘⇧C</KbdHint> copy result
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          <KbdHint>⌘⇧X</KbdHint> clear input
        </span>
      </p>
    </ToolShell>
  );
}
