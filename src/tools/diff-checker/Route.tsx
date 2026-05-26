import type { Change } from "diff";
import {
  ArrowLeftRight,
  Check,
  CheckCircle,
  Copy,
  GitCompare,
  Loader2,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
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

function DiffLine({
  lineNumber,
  content,
  tone = "default",
  prefix,
}: {
  lineNumber: number | null;
  content: string;
  tone?: DiffTone;
  prefix?: string;
}) {
  const rowToneClass =
    tone === "added"
      ? "bg-mint/40 hover:bg-mint/60"
      : tone === "removed"
        ? "bg-tomato/15 hover:bg-tomato/25"
        : "hover:bg-paper-2/60";

  const gutterToneClass =
    tone === "added" ? "bg-mint/40" : tone === "removed" ? "bg-tomato/15" : "bg-paper-2";

  return (
    <div className={`flex ${rowToneClass}`}>
      <div
        className={`w-10 flex-none border-r border-ink/40 pr-2 text-right font-mono text-sm text-ink-3 select-none ${gutterToneClass}`}
      >
        {lineNumber ?? ""}
      </div>
      {prefix !== undefined && (
        <div
          className={`w-5 flex-none text-center font-mono text-sm font-bold select-none ${
            tone === "added" ? "text-grass" : tone === "removed" ? "text-tomato" : "text-ink-3"
          }`}
        >
          {prefix}
        </div>
      )}
      <div className="px-2 font-mono text-sm text-ink whitespace-pre">{content}</div>
    </div>
  );
}

function SideBySideView({ result }: { result: SideBySideResult }) {
  return (
    <div className="flex flex-col lg:flex-row">
      <div className="flex-1 border-r-2 border-ink">
        <div className="border-b-2 border-ink bg-paper-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          Original
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-max py-0 leading-6">
            {result.original.map((line) => (
              <DiffLine
                key={line.id}
                lineNumber={line.lineNumber}
                content={line.content}
                tone={line.tone}
                prefix={line.tone === "removed" ? "-" : line.tone === "added" ? "+" : " "}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <div className="border-b-2 border-ink bg-paper-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          Modified
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-max py-0 leading-6">
            {result.modified.map((line) => (
              <DiffLine
                key={line.id}
                lineNumber={line.lineNumber}
                content={line.content}
                tone={line.tone}
                prefix={line.tone === "added" ? "+" : line.tone === "removed" ? "-" : " "}
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
        {lines.map((line) => (
          <DiffLine
            key={line.id}
            lineNumber={line.lineNumber}
            content={line.content}
            tone={line.tone}
            prefix={line.tone === "added" ? "+" : line.tone === "removed" ? "-" : " "}
          />
        ))}
      </div>
    </div>
  );
}

function UnifiedView({ patch }: { patch: string }) {
  const lines = patch.split("\n");

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max py-0 leading-6">
        {lines.map((line, i) => {
          let tone: DiffTone = "default";
          let className = "text-ink";
          if (line.startsWith("+") && !line.startsWith("+++")) {
            tone = "added";
            className = "text-grass";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            tone = "removed";
            className = "text-tomato";
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

export default function DiffCheckerRoute() {
  const [originalText, setOriginalText] = useState("");
  const [modifiedText, setModifiedText] = useState("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [prefs, setPrefs] = useToolPreferences("diff-checker", DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useClipboard();
  const settingsRef = useRef<HTMLDivElement>(null);

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
      setDiffResult(buildDiffResult(changes, unifiedPatch));
    } catch {
      setDiffResult(null);
    } finally {
      setLoading(false);
    }
  }, [originalText, modifiedText, prefs.ignoreCase, prefs.ignoreWhitespace]);

  const clearOriginal = useCallback(() => {
    setOriginalText("");
    setDiffResult(null);
  }, []);

  const clearModified = useCallback(() => {
    setModifiedText("");
    setDiffResult(null);
  }, []);

  const clearAll = useCallback(() => {
    clearOriginal();
    clearModified();
  }, [clearOriginal, clearModified]);

  const shortcuts = useMemo(
    () => [
      { key: "Enter", meta: true, handler: findDifferences, enabled: !loading },
      {
        key: "c",
        meta: true,
        shift: true,
        handler: () => diffResult && copy(diffResult.unifiedPatch),
        enabled: !!diffResult,
      },
      { key: "x", meta: true, shift: true, handler: clearAll },
    ],
    [findDifferences, loading, diffResult, copy, clearAll],
  );

  useKeyboardShortcut(shortcuts);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [settingsOpen]);

  const hasNoDifferences =
    diffResult !== null && diffResult.stats.added === 0 && diffResult.stats.removed === 0;

  return (
    <ToolShell variant="wide" className="flex flex-col gap-8 py-6 sm:py-8">
      <Tabs value={prefs.viewMode} onValueChange={(v) => setPrefs({ viewMode: v as ViewMode })}>
        <TabsList>
          <TabsTrigger value="side-by-side">Side-by-Side</TabsTrigger>
          <TabsTrigger value="inline">Inline View</TabsTrigger>
          <TabsTrigger value="unified">Unified</TabsTrigger>
        </TabsList>
      </Tabs>

      <TwoPane
        left={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="Original Text"
              htmlFor="diff-checker-original"
              className="mb-0"
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={clearOriginal}
                  className="text-xs font-bold"
                >
                  Clear
                </Button>
              }
            />
            <div className="group relative">
              <Textarea
                id="diff-checker-original"
                value={originalText}
                onChange={(e) => setOriginalText(e.target.value)}
                placeholder="Paste original text here..."
                className="h-48 resize-none font-mono text-sm leading-relaxed sm:h-80"
              />
              <div className="absolute right-3 bottom-3 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="font-mono text-[10px] text-muted-foreground">UTF-8</span>
              </div>
            </div>
          </div>
        }
        right={
          <div className="flex flex-col gap-3">
            <PaneHeader
              label="Modified Text"
              htmlFor="diff-checker-modified"
              className="mb-0"
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={clearModified}
                  className="text-xs font-bold"
                >
                  Clear
                </Button>
              }
            />
            <div className="group relative">
              <Textarea
                id="diff-checker-modified"
                value={modifiedText}
                onChange={(e) => setModifiedText(e.target.value)}
                placeholder="Paste modified text here..."
                className="h-48 resize-none font-mono text-sm leading-relaxed sm:h-80"
              />
              <div className="absolute right-3 bottom-3 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="font-mono text-[10px] text-muted-foreground">UTF-8</span>
              </div>
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Button onClick={findDifferences} disabled={loading} size="lg">
            {loading ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Comparing...
              </>
            ) : (
              <>
                <GitCompare className="size-5" />
                Find Differences
                <KbdHint>⌘⏎</KbdHint>
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            <Switch
              id="diff-ignorecase"
              checked={prefs.ignoreCase}
              onCheckedChange={(v) => setPrefs({ ignoreCase: v })}
            />
            <Label htmlFor="diff-ignorecase">Ignore case</Label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div ref={settingsRef} className="relative">
            <Button
              variant="ghost"
              size="icon"
              title="Settings"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings className="size-5" />
            </Button>
            {settingsOpen && (
              <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-card p-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <Switch
                    id="diff-ignorewhitespace"
                    checked={prefs.ignoreWhitespace}
                    onCheckedChange={(v) => setPrefs({ ignoreWhitespace: v })}
                  />
                  <Label htmlFor="diff-ignorewhitespace">Ignore whitespace</Label>
                </div>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => diffResult && copy(diffResult.unifiedPatch)}
            disabled={!diffResult}
          >
            <IconSwap swapKey={copied}>
              {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
              {copied ? "Copied!" : "Copy Result"}
            </IconSwap>
            <KbdHint>⌘⇧C</KbdHint>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Comparison Result</h2>
          {diffResult && !hasNoDifferences && (
            <div className="flex items-center gap-4 font-mono text-sm">
              <span className="flex items-center gap-1.5 text-grass">
                <span className="inline-block size-2.5 rounded-sm bg-grass" aria-hidden="true" />+
                {diffResult.stats.added}
              </span>
              <span className="flex items-center gap-1.5 text-tomato">
                <span className="inline-block size-2.5 rounded-sm bg-tomato" aria-hidden="true" />-
                {diffResult.stats.removed}
              </span>
              <span className="flex items-center gap-1.5 text-ink-3">
                <span className="inline-block size-2.5 rounded-sm bg-ink-3/40" aria-hidden="true" />
                {diffResult.stats.unchanged}
              </span>
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">Computing differences...</span>
            </div>
          )}

          {!loading && diffResult === null && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <ArrowLeftRight className="size-10" />
              <p className="text-sm">Enter text in both panels and click Find Differences</p>
            </div>
          )}

          {!loading && hasNoDifferences && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-ink">
              <CheckCircle className="size-10 text-grass" />
              <p className="text-sm font-medium">No differences found</p>
            </div>
          )}

          {!loading && diffResult !== null && !hasNoDifferences && (
            <>
              {prefs.viewMode === "side-by-side" && (
                <SideBySideView result={diffResult.sideBySide} />
              )}
              {prefs.viewMode === "inline" && <InlineView lines={diffResult.inlineLines} />}
              {prefs.viewMode === "unified" && <UnifiedView patch={diffResult.unifiedPatch} />}
            </>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
