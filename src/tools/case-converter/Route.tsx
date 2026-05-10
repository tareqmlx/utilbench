import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
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

export default function CaseConverterRoute() {
  const [input, setInput] = useState("");
  const [prefs, setPrefs] = useToolPreferences("case-converter", DEFAULT_PREFS);
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeCase = (urlState.case || prefs.selectedCase || null) as CaseType | null;
  const [output, setOutput] = useState("");
  const { copied, copy } = useClipboard();

  const shortcuts = useMemo(
    () => [{ key: "c", meta: true, shift: true, handler: () => copy(output), enabled: !!output }],
    [copy, output],
  );

  useKeyboardShortcut(shortcuts);

  function handleInputChange(text: string) {
    setInput(text);
    if (activeCase) {
      setOutput(text ? convert(text, activeCase) : "");
    }
  }

  function handleCaseClick(caseType: CaseType) {
    setPrefs({ selectedCase: caseType });
    setUrlState({ case: caseType });
    setOutput(input ? convert(input, caseType) : "");
  }

  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-3">
          <PaneHeader label="Input Text" htmlFor="case-input" />
          <Textarea
            id="case-input"
            className="min-h-[200px] w-full p-5"
            placeholder="Paste or type your text here..."
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          <PaneHeader label="Conversion Options" />
          <div className="flex flex-wrap gap-2">
            {CASE_OPTIONS.map(({ type, label }) => (
              <Button
                key={type}
                variant={activeCase === type ? "default" : "outline"}
                onClick={() => handleCaseClick(type)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <PaneHeader
            label="Output Result"
            htmlFor="case-output"
            actions={
              <Button
                variant="ghost"
                className="text-sm font-bold text-primary"
                disabled={!output}
                onClick={() => copy(output)}
              >
                <IconSwap swapKey={copied}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy Text"}
                </IconSwap>
                <KbdHint>⌘⇧C</KbdHint>
              </Button>
            }
          />
          <Textarea
            id="case-output"
            className="min-h-[200px] w-full cursor-default bg-muted p-5"
            placeholder="Converted text will appear here..."
            readOnly
            value={output}
          />
        </div>
      </div>
    </ToolShell>
  );
}
