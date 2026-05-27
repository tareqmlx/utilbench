import type { Change } from "diff";
import { ArrowLeftRight, Check, CheckCircle, Copy, GitCompare, Loader2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { cn } from "../../lib/utils";
import { workerPool } from "../../workers";

type ViewMode = "side-by-side" | "inline" | "unified";
type DiffTone = "default" | "added" | "removed";

interface DiffLineData {
  id: string;
  lineNumber: number | null;
  content: string;
  tone: DiffTone;
}

interface SideBySideResult {
  original: DiffLineData[];
  modified: DiffLineData[];
}

interface DiffResult {
  changes: Change[];
  sideBySide: SideBySideResult;
  inlineLines: DiffLineData[];
  unifiedPatch: string;
  stats: { added: number; removed: number; unchanged: number };
}

function buildSideBySide(changes: Change[]): SideBySideResult {
  const original: DiffLineData[] = [];
  const modified: DiffLineData[] = [];
  let origLine = 1;
  let modLine = 1;
  let origId = 0;
  let modId = 0;

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    if (!change) break;
    const lines = splitLines(change.value);

    if (!change.added && !change.removed) {
      for (const line of lines) {
        original.push({
          id: `o${origId++}`,
          lineNumber: origLine++,
          content: line,
          tone: "default",
        });
        modified.push({ id: `m${modId++}`, lineNumber: modLine++, content: line, tone: "default" });
      }
      i++;
    } else if (change.removed) {
      const removedLines = lines;
      const next = changes[i + 1];
      const addedLines = next?.added ? splitLines(next.value) : [];

      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        const removedContent = removedLines[j];
        const addedContent = addedLines[j];
        if (removedContent !== undefined) {
          original.push({
            id: `o${origId++}`,
            lineNumber: origLine++,
            content: removedContent,
            tone: "removed",
          });
        } else {
          original.push({ id: `o${origId++}`, lineNumber: null, content: "", tone: "default" });
        }
        if (addedContent !== undefined) {
          modified.push({
            id: `m${modId++}`,
            lineNumber: modLine++,
            content: addedContent,
            tone: "added",
          });
        } else {
          modified.push({ id: `m${modId++}`, lineNumber: null, content: "", tone: "default" });
        }
      }
      i += next?.added ? 2 : 1;
    } else {
      for (const line of lines) {
        original.push({ id: `o${origId++}`, lineNumber: null, content: "", tone: "default" });
        modified.push({ id: `m${modId++}`, lineNumber: modLine++, content: line, tone: "added" });
      }
      i++;
    }
  }

  return { original, modified };
}

function buildInlineLines(changes: Change[]): DiffLineData[] {
  const result: DiffLineData[] = [];
  let lineNum = 1;
  let id = 0;

  for (const change of changes) {
    const lines = splitLines(change.value);
    const tone: DiffTone = change.added ? "added" : change.removed ? "removed" : "default";
    for (const line of lines) {
      result.push({ id: `il${id++}`, lineNumber: lineNum++, content: line, tone });
    }
  }

  return result;
}

function computeStats(changes: Change[]): { added: number; removed: number; unchanged: number } {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const change of changes) {
    const count = splitLines(change.value).length;
    if (change.added) added += count;
    else if (change.removed) removed += count;
    else unchanged += count;
  }

  return { added, removed, unchanged };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function buildDiffResult(changes: Change[], unifiedPatch: string): DiffResult {
  return {
    changes,
    sideBySide: buildSideBySide(changes),
    inlineLines: buildInlineLines(changes),
    unifiedPatch,
    stats: computeStats(changes),
  };
}

// --- UI Components ---

const ROW_STAGGER_MAX = 24;
const ROW_STAGGER_STEP_MS = 14;

function getRowDelayStyle(index?: number): React.CSSProperties | undefined {
  if (index === undefined || index >= ROW_STAGGER_MAX) return undefined;
  return { ["--wb-row-delay" as string]: `${index * ROW_STAGGER_STEP_MS}ms` };
}

interface DiffLineProps {
  lineNumber: number | null;
  content: string;
  tone?: DiffTone;
  prefix?: string;
  index?: number;
  animate?: boolean;
}

const DiffLine = memo(function DiffLine({
  lineNumber,
  content,
  tone = "default",
  prefix,
  index,
  animate,
}: DiffLineProps) {
  const rowToneClass =
    tone === "added"
      ? "bg-mint/40 hover:bg-mint/60"
      : tone === "removed"
        ? "bg-tomato/15 hover:bg-tomato/25"
        : "hover:bg-paper-2/60";

  const gutterToneClass =
    tone === "added" ? "bg-mint/40" : tone === "removed" ? "bg-tomato/15" : "bg-paper-2";

  return (
    <div
      className={cn("flex", rowToneClass, animate && "wb-diff-row")}
      style={animate ? getRowDelayStyle(index) : undefined}
    >
      <div
        className={`w-10 flex-none border-r border-ink/40 pr-2 text-right font-mono text-sm text-ink-3 select-none ${gutterToneClass}`}
      >
        {lineNumber ?? ""}
      </div>
      {prefix !== undefined && (
        <div
          className={`w-5 flex-none text-center font-mono text-sm font-bold select-none ${
            tone === "default" ? "text-ink-3" : "text-ink"
          }`}
        >
          {prefix}
        </div>
      )}
      <div className="px-2 font-mono text-sm text-ink whitespace-pre">{content}</div>
    </div>
  );
});

function SubPaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b-2 border-ink bg-paper-2 px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
      {children}
    </div>
  );
}

function SideBySideView({ result }: { result: SideBySideResult }) {
  return (
    <div className="flex flex-col lg:flex-row">
      <div className="flex-1 border-b-2 border-ink lg:border-b-0 lg:border-r-2">
        <SubPaneLabel>Original</SubPaneLabel>
        <div className="overflow-x-auto">
          <div className="min-w-max py-0 leading-6">
            {result.original.map((line, i) => (
              <DiffLine
                key={line.id}
                lineNumber={line.lineNumber}
                content={line.content}
                tone={line.tone}
                prefix={line.tone === "removed" ? "-" : line.tone === "added" ? "+" : " "}
                index={i}
                animate
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <SubPaneLabel>Modified</SubPaneLabel>
        <div className="overflow-x-auto">
          <div className="min-w-max py-0 leading-6">
            {result.modified.map((line, i) => (
              <DiffLine
                key={line.id}
                lineNumber={line.lineNumber}
                content={line.content}
                tone={line.tone}
                prefix={line.tone === "added" ? "+" : line.tone === "removed" ? "-" : " "}
                index={i}
                animate
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineView({ lines }: { lines: DiffLineData[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-max py-0 leading-6">
        {lines.map((line, i) => (
          <DiffLine
            key={line.id}
            lineNumber={line.lineNumber}
            content={line.content}
            tone={line.tone}
            prefix={line.tone === "added" ? "+" : line.tone === "removed" ? "-" : " "}
            index={i}
            animate
          />
        ))}
      </div>
    </div>
  );
}

function UnifiedView({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split("\n"), [patch]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max py-0 leading-6">
        {lines.map((line, i) => {
          let tone: DiffTone = "default";
          let className = "text-ink";
          if (line.startsWith("+") && !line.startsWith("+++")) {
            tone = "added";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            tone = "removed";
          } else if (line.startsWith("@@")) {
            className = "text-ink-3 font-bold";
          }

          const rowBg = tone === "added" ? "bg-mint/40" : tone === "removed" ? "bg-tomato/15" : "";

          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: unified patch lines lack stable identity
            <div key={i} className={`px-4 font-mono text-sm whitespace-pre ${rowBg} ${className}`}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DEFAULT_PREFS = {
  viewMode: "side-by-side" as ViewMode,
  ignoreCase: false,
  ignoreWhitespace: false,
};

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "side-by-side", label: "Side-by-Side" },
  { value: "inline", label: "Inline View" },
  { value: "unified", label: "Unified" },
];

const PILL_TRIGGER_CLASS = cn(
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border-2 border-ink bg-paper px-4 py-2.5 text-[13.5px] font-medium text-ink shadow-pop-1 transition-all",
  "sm:min-h-0 sm:px-3.5 sm:py-1.5 sm:text-[13px]",
  "hover:bg-lemon hover:-translate-y-0.5",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
  "data-[state=active]:bg-ink data-[state=active]:text-paper data-[state=active]:shadow-pop-2",
);

const PILL_LIST_CLASS =
  "inline-flex h-auto min-h-0 flex-wrap items-center justify-start gap-2 rounded-none bg-transparent p-0 text-ink";

export default function DiffCheckerRoute() {
  const [originalText, setOriginalText] = useState("");
  const [modifiedText, setModifiedText] = useState("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [prefs, setPrefs] = useToolPreferences("diff-checker", DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const { copied, copy } = useClipboard();

  const findDifferences = useCallback(async () => {
    if (!originalText && !modifiedText) return;
    setLoading(true);
    try {
      const { promise } = workerPool.dispatch<{ changes: Change[]; unifiedPatch: string }>(
        "compute-diff",
        {
          original: originalText,
          modified: modifiedText,
          ignoreCase: prefs.ignoreCase,
          ignoreWhitespace: prefs.ignoreWhitespace,
        },
      );
      const { changes, unifiedPatch } = await promise;
      const result = buildDiffResult(changes, unifiedPatch);
      setDiffResult(result);
      const totalChanges = result.stats.added + result.stats.removed;
      setStatusMessage(
        totalChanges === 0
          ? "No differences found."
          : `${result.stats.added} added, ${result.stats.removed} removed.`,
      );
    } catch {
      setDiffResult(null);
      setStatusMessage("Comparison failed.");
    } finally {
      setLoading(false);
    }
  }, [originalText, modifiedText, prefs.ignoreCase, prefs.ignoreWhitespace]);

  const clearOriginal = useCallback(() => {
    setOriginalText("");
    setDiffResult(null);
    setStatusMessage("Original cleared.");
  }, []);

  const clearModified = useCallback(() => {
    setModifiedText("");
    setDiffResult(null);
    setStatusMessage("Modified cleared.");
  }, []);

  const clearAll = useCallback(() => {
    setOriginalText("");
    setModifiedText("");
    setDiffResult(null);
    setStatusMessage("All cleared.");
  }, []);

  const handleCopyResult = useCallback(() => {
    if (!diffResult) return;
    copy(diffResult.unifiedPatch);
    setStatusMessage("Unified patch copied to clipboard.");
  }, [copy, diffResult]);

  const shortcuts = useMemo(
    () => [
      { key: "Enter", meta: true, handler: findDifferences, enabled: !loading },
      {
        key: "c",
        meta: true,
        shift: true,
        handler: handleCopyResult,
        enabled: !!diffResult,
      },
      { key: "x", meta: true, shift: true, handler: clearAll },
    ],
    [findDifferences, loading, diffResult, handleCopyResult, clearAll],
  );

  useKeyboardShortcut(shortcuts);

  const hasNoDifferences =
    diffResult !== null && diffResult.stats.added === 0 && diffResult.stats.removed === 0;
  const hasResult = diffResult !== null && !hasNoDifferences;
  const isEmpty = !originalText && !modifiedText;

  return (
    <ToolShell variant="wide" className="flex flex-col gap-6 sm:gap-8">
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <TwoPane
        left={
          <section className="wb-panel">
            <PaneHeader
              label="Original Text"
              htmlFor="diff-checker-original"
              actions={
                <button
                  type="button"
                  onClick={clearOriginal}
                  disabled={!originalText}
                  className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                >
                  Clear
                </button>
              }
            />
            <div className="p-3 sm:p-4">
              <textarea
                id="diff-checker-original"
                value={originalText}
                onChange={(e) => setOriginalText(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="Paste original text here..."
                className="h-48 w-full resize-none rounded-md border-2 border-ink/40 bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-80 lg:h-96"
              />
            </div>
          </section>
        }
        right={
          <section className="wb-panel">
            <PaneHeader
              label="Modified Text"
              htmlFor="diff-checker-modified"
              actions={
                <button
                  type="button"
                  onClick={clearModified}
                  disabled={!modifiedText}
                  className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                >
                  Clear
                </button>
              }
            />
            <div className="p-3 sm:p-4">
              <textarea
                id="diff-checker-modified"
                value={modifiedText}
                onChange={(e) => setModifiedText(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="Paste modified text here..."
                className="h-48 w-full resize-none rounded-md border-2 border-ink/40 bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-80 lg:h-96"
              />
            </div>
          </section>
        }
      />

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        <button
          type="button"
          onClick={findDifferences}
          disabled={loading || isEmpty}
          className="wb-btn min-w-44 justify-center"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Comparing</span>
            </>
          ) : (
            <>
              <GitCompare className="size-4" aria-hidden="true" />
              <span>Find Differences</span>
              <KbdHint>⌘⏎</KbdHint>
            </>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="diff-ignorecase"
              checked={prefs.ignoreCase}
              onCheckedChange={(v) => setPrefs({ ignoreCase: v })}
            />
            <Label htmlFor="diff-ignorecase" className="text-sm text-ink-2">
              Ignore case
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="diff-ignorewhitespace"
              checked={prefs.ignoreWhitespace}
              onCheckedChange={(v) => setPrefs({ ignoreWhitespace: v })}
            />
            <Label htmlFor="diff-ignorewhitespace" className="text-sm text-ink-2">
              Ignore whitespace
            </Label>
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={prefs.viewMode} onValueChange={(v) => setPrefs({ viewMode: v as ViewMode })}>
            <TabsList className={PILL_LIST_CLASS}>
              {VIEW_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value} className={PILL_TRIGGER_CLASS}>
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {hasResult && (
            <div className="wb-fade-in flex items-center gap-3 font-mono text-[12.5px] font-medium text-ink tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-grass" />
                <span>+{diffResult.stats.added}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-tomato" />
                <span>−{diffResult.stats.removed}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-ink-3/40" />
                <span>{diffResult.stats.unchanged}</span>
              </span>
            </div>
          )}
        </div>

        <div className="wb-panel wb-panel--out">
          <h2 className="sr-only">Comparison result</h2>
          <PaneHeader
            label="Differences"
            actions={
              <button
                type="button"
                onClick={handleCopyResult}
                disabled={!diffResult}
                className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
              >
                <IconSwap swapKey={copied}>
                  {copied ? (
                    <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </IconSwap>
                <span>{copied ? "Copied" : "Copy Result"}</span>
                <KbdHint>⌘⇧C</KbdHint>
              </button>
            }
          />

          <div key={loading ? "loading" : diffResult ? "result" : "empty"} className="wb-fade-in">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-20 text-ink-3">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <span className="text-sm">Computing differences...</span>
              </div>
            )}

            {!loading && diffResult === null && (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center text-ink-3">
                <ArrowLeftRight className="size-9 text-ink-3" aria-hidden="true" />
                <p className="font-mono text-[13px] italic">
                  Enter text in both panels and click Find Differences
                </p>
              </div>
            )}

            {!loading && hasNoDifferences && (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center text-ink">
                <CheckCircle className="wb-success-pop size-9 text-grass" aria-hidden="true" />
                <p className="text-sm font-medium">No differences found</p>
              </div>
            )}

            {!loading && hasResult && (
              <div key={prefs.viewMode} className="wb-fade-in">
                {prefs.viewMode === "side-by-side" && (
                  <SideBySideView result={diffResult.sideBySide} />
                )}
                {prefs.viewMode === "inline" && <InlineView lines={diffResult.inlineLines} />}
                {prefs.viewMode === "unified" && <UnifiedView patch={diffResult.unifiedPatch} />}
              </div>
            )}
          </div>
        </div>
      </section>
    </ToolShell>
  );
}
