import { Check, Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, ToolShell } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { useUrlState } from "../../hooks/useUrlState";
import { type CaseType, convert } from "./conversions";

const CASE_OPTIONS: { type: CaseType; label: string }[] = [
  { type: "upper", label: "UPPERCASE" },
  { type: "lower", label: "lowercase" },
  { type: "title", label: "Title Case" },
  { type: "sentence", label: "Sentence case" },
  { type: "camel", label: "camelCase" },
  { type: "pascal", label: "PascalCase" },
  { type: "snake", label: "snake_case" },
  { type: "kebab", label: "kebab-case" },
  { type: "constant", label: "CONSTANT_CASE" },
];

const DEFAULT_PREFS = { selectedCase: null as CaseType | null };

const URL_SCHEMA = {
  case: { type: "string" as const, defaultValue: "" },
};

const numberFormatter = new Intl.NumberFormat("en-US");

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function formatMeta(text: string): string {
  const chars = text.length;
  const words = countWords(text);
  return `${numberFormatter.format(chars)} ${chars === 1 ? "char" : "chars"} · ${numberFormatter.format(words)} ${words === 1 ? "word" : "words"}`;
}

export default function CaseConverterRoute() {
  const [input, setInput] = useState("");
  const [prefs, setPrefs] = useToolPreferences("case-converter", DEFAULT_PREFS);
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeCase = (urlState.case || prefs.selectedCase || null) as CaseType | null;
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");
  const { copied, copy } = useClipboard();

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setInput(text);
      if (activeCase) {
        setOutput(text ? convert(text, activeCase) : "");
      }
    },
    [activeCase],
  );

  const handleCaseClick = useCallback(
    (caseType: CaseType, label: string) => {
      setPrefs({ selectedCase: caseType });
      setUrlState({ case: caseType });
      setOutput(input ? convert(input, caseType) : "");
      setStatus(`Converted to ${label}.`);
    },
    [input, setPrefs, setUrlState],
  );

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
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
      ],
      [handleCopy, output.length],
    ),
  );

  const inputMeta = input ? formatMeta(input) : null;
  const outputMeta = output ? formatMeta(output) : null;
  const hasInput = input.length > 0;

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>

      <div className="grid grid-cols-1 gap-6">
        <section className="flex flex-col gap-3">
          <PaneHeader
            label="Input Text"
            htmlFor="case-input"
            trailing={
              inputMeta ? (
                <span
                  key={inputMeta}
                  className="font-mono text-[11px] tabular-nums text-ink-3"
                  aria-hidden="true"
                >
                  {inputMeta}
                </span>
              ) : null
            }
            actions={
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
              </Button>
            }
          />
          <Textarea
            id="case-input"
            className="min-h-[200px] w-full resize-y p-5 text-[15px] leading-relaxed"
            placeholder="Paste or type text here, then pick a case below."
            value={input}
            onChange={handleInputChange}
          />
        </section>

        <section className="flex flex-col gap-3">
          <PaneHeader label="Convert To" />
          <div className="flex flex-wrap gap-2" aria-label="Case conversion type">
            {CASE_OPTIONS.map(({ type, label }) => {
              const isActive = activeCase === type;
              return (
                <button
                  type="button"
                  key={type}
                  onClick={() => handleCaseClick(type, label)}
                  aria-pressed={isActive}
                  className={`wb-chip ${isActive ? "on" : ""}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <PaneHeader
            label="Result"
            htmlFor="case-output"
            trailing={
              outputMeta ? (
                <span
                  key={activeCase ?? "none"}
                  className="wb-fade-in font-mono text-[11px] tabular-nums text-ink-3"
                  aria-hidden="true"
                >
                  {outputMeta}
                </span>
              ) : null
            }
            actions={
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
            }
          />
          <Textarea
            key={activeCase ?? "none"}
            id="case-output"
            className="wb-fade-in min-h-[200px] w-full cursor-default resize-y bg-paper-2 p-5 text-[15px] leading-relaxed"
            placeholder={
              activeCase
                ? "Result will appear here as you type."
                : "Pick a case above to see the result."
            }
            readOnly
            value={output}
          />
        </section>
      </div>

      <p className="mt-6 hidden items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 lg:flex">
        <span className="inline-flex items-center gap-1.5">
          <KbdHint>⌘⇧C</KbdHint> copy result
        </span>
      </p>
    </ToolShell>
  );
}
