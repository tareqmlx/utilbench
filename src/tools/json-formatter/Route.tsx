import { parse as jsoncParse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import { Check, ClipboardPaste, Code, Copy, Minimize2, Trash2, Wand2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";

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
  const [error, setError] = useState<string | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { copied, copy, readClipboard } = useClipboard();

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const { error: parseError } = parseJson(val);
    setError(parseError);
    setOutput("");
  }, []);

  const handlePaste = useCallback(async () => {
    const text = await readClipboard();
    if (text === null) return;
    setInput(text);
    const { error: parseError } = parseJson(text);
    setError(parseError);
    setOutput("");
    setPasteFeedback(true);
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => setPasteFeedback(false), 1500);
  }, [readClipboard]);

  const handleClear = useCallback(() => {
    setInput("");
    setOutput("");
    setError(null);
  }, []);

  const handleFormat = useCallback(() => {
    const { data, error: parseError } = parseJson(input);
    if (parseError !== null) {
      setError(parseError);
      return;
    }
    if (data === undefined) return;
    setOutput(JSON.stringify(data, null, 2));
    setError(null);
  }, [input]);

  const handleMinify = useCallback(() => {
    const { data, error: parseError } = parseJson(input);
    if (parseError !== null) {
      setError(parseError);
      return;
    }
    if (data === undefined) return;
    setOutput(JSON.stringify(data));
    setError(null);
  }, [input]);

  const handleCopy = useCallback(() => {
    copy(output);
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

  const inputRingClass =
    input.trim() === ""
      ? ""
      : error !== null
        ? "ring-2 ring-red-500/50 border-transparent"
        : "ring-2 ring-emerald-500/50 border-transparent";

  return (
    <ToolShell className="py-6 sm:py-8">
      <TwoPane
        className="min-h-64 sm:min-h-96 lg:min-h-125 lg:h-[calc(100vh-320px)]"
        left={
          <div className="flex h-full flex-col gap-3">
            <PaneHeader
              icon={<Code className="size-4 text-muted-foreground" />}
              label="Input"
              className="mb-0 px-2"
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={handlePaste}>
                    {pasteFeedback ? (
                      <Check className="size-4" />
                    ) : (
                      <ClipboardPaste className="size-4" />
                    )}
                    {pasteFeedback ? "Pasted!" : "Paste"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    <Trash2 className="size-4" />
                    Clear
                    <KbdHint>⌘⇧X</KbdHint>
                  </Button>
                </>
              }
            />

            <div className="relative flex-1">
              <Textarea
                value={input}
                onChange={handleInputChange}
                className={`h-full min-h-48 resize-none sm:min-h-80 font-mono text-sm shadow-inner transition-all ${inputRingClass}`}
                placeholder={
                  'Paste your raw JSON here... e.g. {"status":"success","data":{"id":1}}'
                }
              />
            </div>
          </div>
        }
        right={
          <div className="flex h-full flex-col gap-3">
            <PaneHeader
              icon={<Code className="size-4 text-muted-foreground" />}
              label="Formatted Output"
              className="mb-0 px-2"
              actions={
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <IconSwap swapKey={copied}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </IconSwap>
                  <KbdHint>⌘⇧C</KbdHint>
                </Button>
              }
            />

            <div className="relative flex-1">
              <Textarea
                readOnly
                value={output}
                className="h-full min-h-48 resize-none sm:min-h-80 bg-muted font-mono text-sm text-primary shadow-inner"
                placeholder="Your beautified JSON will appear here..."
              />
            </div>
          </div>
        }
      />

      <ErrorAlert error={error} />

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Button size="lg" onClick={handleFormat} className="min-w-40">
          <Wand2 className="size-4" />
          Format JSON
          <KbdHint>⌘⏎</KbdHint>
        </Button>
        <Button variant="outline" size="lg" onClick={handleMinify} className="min-w-40">
          <Minimize2 className="size-4" />
          Minify
        </Button>
      </div>
    </ToolShell>
  );
}
