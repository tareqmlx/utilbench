import { parse as jsoncParse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import { Check, ClipboardPaste, Copy, Minimize2, Trash2, Wand2 } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, StatusBadge, ToolShell } from "../../components/tool-layout";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { cn } from "../../lib/utils";

const numberFormatter = new Intl.NumberFormat("en-US");
const textEncoder = new TextEncoder();

function parseJson(value: string): { data: unknown; error: string | null } {
  if (value.trim() === "") return { data: undefined, error: null };
  const errors: ParseError[] = [];
  const data = jsoncParse(value, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const e = errors[0];
    if (!e) return { data: undefined, error: "Unknown parse error" };
    const lines = value.slice(0, e.offset).split("\n");
    const line = lines.length;
    const col = (lines[lines.length - 1]?.length ?? 0) + 1;
    return {
      data: undefined,
      error: `${printParseErrorCode(e.error)} at line ${line}, column ${col}`,
    };
  }
  return { data, error: null };
}

export default function JsonFormatterRoute() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { copied, copy, readClipboard } = useClipboard();

  useEffect(
    () => () => {
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    },
    [],
  );

  const deferredInput = useDeferredValue(input);
  const { error } = useMemo(() => parseJson(deferredInput), [deferredInput]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setOutput("");
  }, []);

  const handlePaste = useCallback(async () => {
    const text = await readClipboard();
    if (text === null) return;
    setInput(text);
    setOutput("");
    setPasteFeedback(true);
    setStatusMessage("JSON pasted from clipboard.");
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => setPasteFeedback(false), 1500);
  }, [readClipboard]);

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setStatusMessage("Input cleared.");
  }, []);

  const handleFormat = useCallback(() => {
    const { data, error: parseError } = parseJson(input);
    if (parseError !== null) {
      setStatusMessage(`Parse error: ${parseError}`);
      return;
    }
    if (data === undefined) return;
    setOutput(JSON.stringify(data, null, 2));
    setStatusMessage("JSON formatted.");
  }, [input]);

  const handleMinify = useCallback(() => {
    const { data, error: parseError } = parseJson(input);
    if (parseError !== null) {
      setStatusMessage(`Parse error: ${parseError}`);
      return;
    }
    if (data === undefined) return;
    setOutput(JSON.stringify(data));
    setStatusMessage("JSON minified.");
  }, [input]);

  const handleCopy = useCallback(() => {
    if (!output) return;
    copy(output);
    setStatusMessage("Output copied to clipboard.");
  }, [copy, output]);

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "Enter", meta: true, handler: handleFormat },
        { key: "c", meta: true, shift: true, handler: handleCopy, enabled: output.length > 0 },
        { key: "x", meta: true, shift: true, handler: handleClear },
      ],
      [handleFormat, handleCopy, handleClear, output.length],
    ),
  );

  const isEmpty = input.trim() === "";
  const statusState: "idle" | "invalid" | "valid" = isEmpty
    ? "idle"
    : error !== null
      ? "invalid"
      : "valid";

  const outputSizeLabel = useMemo(() => {
    if (!output) return "";
    const bytes = textEncoder.encode(output).length;
    const lines = output.split("\n").length;
    return `${numberFormatter.format(lines)} ${lines === 1 ? "line" : "lines"} · ${numberFormatter.format(bytes)} B`;
  }, [output]);

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input panel */}
        <section className="wb-panel">
          <PaneHeader
            label="Input JSON"
            htmlFor="json-formatter-input"
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
                  <IconSwap swapKey={pasteFeedback}>
                    {pasteFeedback ? (
                      <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                    ) : (
                      <ClipboardPaste className="size-3.5" aria-hidden="true" />
                    )}
                  </IconSwap>
                  <span>{pasteFeedback ? "Pasted" : "Paste"}</span>
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
                  <KbdHint>⌘⇧X</KbdHint>
                </button>
              </>
            }
          />
          <div className="p-3 sm:p-4">
            <textarea
              id="json-formatter-input"
              value={input}
              onChange={handleInputChange}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder={'Paste your raw JSON here... e.g. {"status":"success","data":{"id":1}}'}
              aria-invalid={error !== null || undefined}
              aria-describedby={error ? "json-formatter-input-error" : undefined}
              className={cn(
                "h-72 w-full resize-none rounded-md bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 sm:h-96 lg:h-[460px]",
                "border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                statusState === "invalid"
                  ? "border-tomato"
                  : statusState === "valid"
                    ? "border-ink"
                    : "border-ink/40",
              )}
            />
          </div>
        </section>

        {/* Output panel */}
        <section className="wb-panel wb-panel--out">
          <PaneHeader
            label="Formatted Output"
            htmlFor="json-formatter-output"
            className="bg-paper-2"
            trailing={
              output ? (
                <span
                  key={outputSizeLabel}
                  className="wb-fade-in wb-mono-sm tabular-nums text-ink-2"
                  aria-hidden="true"
                >
                  {outputSizeLabel}
                </span>
              ) : null
            }
            actions={
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy output to clipboard"
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
                <span>{copied ? "Copied" : "Copy"}</span>
                <KbdHint>⌘⇧C</KbdHint>
              </button>
            }
          />
          <div className="p-3 sm:p-4">
            <div key={output ? "filled" : "empty"} className="wb-fade-in">
              <textarea
                id="json-formatter-output"
                readOnly
                value={output}
                placeholder="Your formatted JSON will appear here..."
                spellCheck={false}
                className="h-72 w-full resize-none rounded-md border-2 border-ink/40 bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-96 lg:h-[460px]"
              />
            </div>
          </div>
        </section>
      </div>

      <ErrorAlert error={error} id="json-formatter-input-error" />

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleFormat}
          disabled={isEmpty}
          className="wb-btn min-w-40 justify-center"
        >
          <Wand2 className="size-4" aria-hidden="true" />
          <span>Format JSON</span>
          <KbdHint>⌘⏎</KbdHint>
        </button>
        <button
          type="button"
          onClick={handleMinify}
          disabled={isEmpty}
          className="wb-btn wb-btn--ghost min-w-40 justify-center"
        >
          <Minimize2 className="size-4" aria-hidden="true" />
          <span>Minify</span>
        </button>
      </div>
    </ToolShell>
  );
}
