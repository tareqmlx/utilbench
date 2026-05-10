import { Check, Copy, Info } from "lucide-react";
import { useCallback, useMemo } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ToolShell } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import type { GenerateOptions } from "./generator";
import { generateLoremIpsum } from "./generator";

type Mode = GenerateOptions["mode"];

const AMOUNT_LIMITS: Record<Mode, { min: number; max: number; default: number }> = {
  paragraphs: { min: 1, max: 100, default: 3 },
  words: { min: 1, max: 10000, default: 50 },
  bytes: { min: 1, max: 100000, default: 500 },
};

const DEFAULT_PREFS = {
  mode: "paragraphs" as Mode,
  amount: 3,
  startWithLorem: true,
  htmlTags: false,
};

export default function LoremIpsumRoute() {
  const [prefs, setPrefs] = useToolPreferences("lorem-ipsum", DEFAULT_PREFS);
  const { copied, copy } = useClipboard();

  const clampedAmount = useMemo(() => {
    const limits = AMOUNT_LIMITS[prefs.mode];
    return Math.max(limits.min, Math.min(limits.max, prefs.amount));
  }, [prefs.mode, prefs.amount]);

  const output = useMemo(() => {
    return generateLoremIpsum({
      mode: prefs.mode,
      amount: clampedAmount,
      startWithLorem: prefs.startWithLorem,
      htmlTags: prefs.htmlTags,
    });
  }, [prefs.mode, clampedAmount, prefs.startWithLorem, prefs.htmlTags]);

  const paragraphs = useMemo(() => output.split("\n\n"), [output]);

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
    copy(output);
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

  return (
    <ToolShell className="flex-grow">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <aside className="space-y-6 lg:col-span-4">
          <Card className="p-6">
            <h2 className="mb-6 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Generation Settings
            </h2>
            <div className="space-y-4">
              <Tabs value={prefs.mode} onValueChange={handleModeChange}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="paragraphs" className="text-sm whitespace-nowrap">
                    Paragraphs
                  </TabsTrigger>
                  <TabsTrigger value="words" className="text-sm whitespace-nowrap">
                    Words
                  </TabsTrigger>
                  <TabsTrigger value="bytes" className="text-sm whitespace-nowrap">
                    Bytes
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-2">
                <Label htmlFor="lorem-amount">Amount</Label>
                <Input
                  id="lorem-amount"
                  type="number"
                  value={prefs.amount}
                  min={AMOUNT_LIMITS[prefs.mode].min}
                  max={AMOUNT_LIMITS[prefs.mode].max}
                  onChange={handleAmountChange}
                />
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <Switch
                    id="lorem-start"
                    checked={prefs.startWithLorem}
                    onCheckedChange={(v) => setPrefs({ startWithLorem: v })}
                  />
                  <Label htmlFor="lorem-start" className="cursor-pointer">
                    Start with &quot;Lorem ipsum...&quot;
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="lorem-html"
                    checked={prefs.htmlTags}
                    onCheckedChange={(v) => setPrefs({ htmlTags: v })}
                  />
                  <Label htmlFor="lorem-html" className="cursor-pointer">
                    Add HTML tags
                  </Label>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-primary/20 bg-primary/5 p-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">
                  Did you know?
                </p>
                <p className="text-sm text-muted-foreground">
                  Lorem Ipsum is simply dummy text of the printing and typesetting industry.
                </p>
              </div>
            </div>
          </Card>
        </aside>

        <div className="flex h-full flex-col lg:col-span-8">
          <Card className="flex flex-grow flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted px-6 py-4">
              <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Output
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary/80"
                onClick={handleCopy}
                disabled={!output}
              >
                <IconSwap swapKey={copied}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy to Clipboard
                      <KbdHint>⌘⇧C</KbdHint>
                    </>
                  )}
                </IconSwap>
              </Button>
            </div>
            <CardContent
              className="max-h-[600px] overflow-y-auto p-4 sm:p-8"
              data-testid="output-area"
            >
              {prefs.htmlTags ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
                  {output}
                </pre>
              ) : (
                paragraphs.map((paragraph, idx) => (
                  <p
                    key={`${idx}-${paragraph.slice(0, 40)}`}
                    className={`leading-relaxed text-foreground ${
                      idx < paragraphs.length - 1 ? "mb-6" : ""
                    }`}
                  >
                    {paragraph}
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ToolShell>
  );
}
