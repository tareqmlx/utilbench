import { Check, Copy } from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, ToolShell } from "../../components/tool-layout";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import type { GenerateOptions } from "./generator";
import { generateLoremIpsum } from "./generator";

type Mode = GenerateOptions["mode"];

const AMOUNT_LIMITS: Record<Mode, { min: number; max: number; default: number }> = {
  paragraphs: { min: 1, max: 100, default: 3 },
  words: { min: 1, max: 10000, default: 50 },
  bytes: { min: 1, max: 100000, default: 500 },
};

const MODE_TABS: { value: Mode; label: string }[] = [
  { value: "paragraphs", label: "Paragraphs" },
  { value: "words", label: "Words" },
  { value: "bytes", label: "Bytes" },
];

const DEFAULT_PREFS = {
  mode: "paragraphs" as Mode,
  amount: 3,
  startWithLorem: true,
  htmlTags: false,
};

const tabTriggerCls = cn(
  "wb-chip justify-center whitespace-nowrap px-3 py-1.5 text-[12.5px] font-semibold sm:min-h-0",
  "data-[state=active]:bg-ink data-[state=active]:text-paper",
  "data-[state=active]:hover:bg-ink data-[state=active]:hover:text-paper",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
);

const metaLabelCls = "wb-meta block";

const numberFormatter = new Intl.NumberFormat("en-US");
const textEncoder = new TextEncoder();

function countBytes(text: string): number {
  return textEncoder.encode(text).length;
}

export default function LoremIpsumRoute() {
  const [prefs, setPrefs] = useToolPreferences("lorem-ipsum", DEFAULT_PREFS);
  const { copied, copy } = useClipboard();
  const [status, setStatus] = useState("");

  const clampedAmount = useMemo(() => {
    const limits = AMOUNT_LIMITS[prefs.mode];
    return Math.max(limits.min, Math.min(limits.max, prefs.amount));
  }, [prefs.mode, prefs.amount]);

  const isClamped = Number.isFinite(prefs.amount) && prefs.amount !== clampedAmount;

  const deferredAmount = useDeferredValue(clampedAmount);
  const isPending = deferredAmount !== clampedAmount;

  const output = useMemo(() => {
    return generateLoremIpsum({
      mode: prefs.mode,
      amount: deferredAmount,
      startWithLorem: prefs.startWithLorem,
      htmlTags: prefs.htmlTags,
    });
  }, [prefs.mode, deferredAmount, prefs.startWithLorem, prefs.htmlTags]);

  const paragraphs = useMemo(
    () => (prefs.htmlTags ? [] : output.split("\n\n")),
    [output, prefs.htmlTags],
  );

  const stats = useMemo(() => {
    const trimmed = output.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return {
      paragraphs: paragraphs.length,
      words,
      bytes: countBytes(output),
    };
  }, [output, paragraphs.length]);

  const handleModeChange = useCallback(
    (value: string) => {
      const newMode = value as Mode;
      setPrefs({ mode: newMode, amount: AMOUNT_LIMITS[newMode].default });
    },
    [setPrefs],
  );

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(e.target.value, 10);
      if (!Number.isNaN(parsed)) {
        setPrefs({ amount: parsed });
      }
    },
    [setPrefs],
  );

  const handleCopy = useCallback(() => {
    if (!output) return;
    copy(output);
    setStatus("Lorem ipsum copied to clipboard.");
  }, [copy, output]);

  useKeyboardShortcut(
    useMemo(
      () => [
        {
          key: "c",
          meta: true,
          shift: true,
          handler: () => handleCopy(),
          enabled: !!output,
        },
      ],
      [output, handleCopy],
    ),
  );

  const limits = AMOUNT_LIMITS[prefs.mode];
  const statsLabel = useMemo(() => {
    const parts: string[] = [];
    if (prefs.mode === "paragraphs") {
      parts.push(`${numberFormatter.format(stats.paragraphs)}p`);
    }
    parts.push(`${numberFormatter.format(stats.words)}w`);
    parts.push(`${numberFormatter.format(stats.bytes)}B`);
    return parts.join(" · ");
  }, [prefs.mode, stats.paragraphs, stats.words, stats.bytes]);

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        <aside className="lg:col-span-4">
          <section className="wb-panel h-full">
            <PaneHeader label="Settings" />

            <div className="space-y-5 p-5 sm:p-6">
              <div className="space-y-2">
                <span className={metaLabelCls}>Mode</span>
                <Tabs value={prefs.mode} onValueChange={handleModeChange}>
                  <TabsList className="flex h-auto w-full gap-1 bg-transparent p-0">
                    {MODE_TABS.map((tab) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className={cn(tabTriggerCls, "flex-1")}
                      >
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lorem-amount" className={metaLabelCls}>
                  Amount
                </Label>
                <Input
                  id="lorem-amount"
                  type="number"
                  inputMode="numeric"
                  value={prefs.amount}
                  min={limits.min}
                  max={limits.max}
                  onChange={handleAmountChange}
                  aria-describedby="lorem-amount-hint"
                  aria-invalid={isClamped || undefined}
                  className="h-11 font-mono tabular-nums"
                />
                <p id="lorem-amount-hint" className="wb-mono-sm text-ink-3">
                  {isClamped ? (
                    <span className="text-tomato">
                      Capped at {numberFormatter.format(clampedAmount)}.
                    </span>
                  ) : (
                    <>
                      {numberFormatter.format(limits.min)}–{numberFormatter.format(limits.max)}{" "}
                      {prefs.mode}
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="border-t-2 border-ink p-5 sm:p-6">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor="lorem-start"
                      className="cursor-pointer text-sm font-semibold text-ink"
                    >
                      Start with Lorem ipsum…
                    </Label>
                    <span id="lorem-start-desc" className="text-[12.5px] text-ink-3">
                      Open with the classic first sentence.
                    </span>
                  </div>
                  <Switch
                    id="lorem-start"
                    checked={prefs.startWithLorem}
                    onCheckedChange={(v) => setPrefs({ startWithLorem: v })}
                    aria-describedby="lorem-start-desc"
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor="lorem-html"
                      className="cursor-pointer text-sm font-semibold text-ink"
                    >
                      Add HTML tags
                    </Label>
                    <span id="lorem-html-desc" className="text-[12.5px] text-ink-3">
                      Wrap each paragraph in &lt;p&gt; for direct paste.
                    </span>
                  </div>
                  <Switch
                    id="lorem-html"
                    checked={prefs.htmlTags}
                    onCheckedChange={(v) => setPrefs({ htmlTags: v })}
                    aria-describedby="lorem-html-desc"
                  />
                </div>
              </div>
            </div>
          </section>
        </aside>

        <div className="lg:col-span-8">
          <section className="wb-panel wb-panel--out h-full">
            <PaneHeader
              label="Output"
              className="bg-paper-2"
              trailing={
                <span
                  key={statsLabel}
                  className={cn(
                    "wb-fade-in wb-mono-sm tabular-nums text-ink-2 transition-opacity",
                    isPending && "opacity-50",
                  )}
                  aria-hidden="true"
                >
                  {statsLabel}
                </span>
              }
              actions={
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!output}
                  className="wb-btn wb-btn--sm wb-btn--ghost"
                  aria-label="Copy to Clipboard"
                >
                  <IconSwap swapKey={copied}>
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        Copy to Clipboard
                        <KbdHint>⌘⇧C</KbdHint>
                      </>
                    )}
                  </IconSwap>
                </button>
              }
            />

            <div
              className="max-h-[70vh] overflow-y-auto bg-paper p-6 sm:p-8 lg:max-h-none lg:flex-1"
              data-testid="output-area"
            >
              <div
                key={`${prefs.mode}|${prefs.startWithLorem}|${prefs.htmlTags}|${output ? "f" : "e"}`}
                className="wb-fade-in"
              >
                {output ? (
                  prefs.htmlTags ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink">
                      {output}
                    </pre>
                  ) : (
                    <div className="space-y-5 text-[15px] leading-relaxed text-ink">
                      {paragraphs.map((paragraph, idx) => (
                        <p
                          key={`${idx}-${paragraph.slice(0, 32)}`}
                          className="max-w-[72ch] text-pretty"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="text-sm text-ink-3">Pick an amount to fill the page.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </ToolShell>
  );
}
