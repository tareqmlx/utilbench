import { Check, Copy, Download, PenLine, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ErrorAlert, PaneHeader, ToolShell, TwoPane } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { parseMarkdown } from "./markdown";
import "./preview.css";

const DEFAULT_MARKDOWN = `# Welcome to Utilbench Markdown Editor

A markdown previewer with full GFM support.

## Features
- Real-time preview with debounced rendering
- GitHub Flavored Markdown support
- Export to HTML or copy to clipboard

### GFM Examples

#### Table

| Feature | Status |
|---------|--------|
| Tables | Supported |
| Task Lists | Supported |
| Strikethrough | Supported |

#### Task List

- [x] Markdown parsing
- [x] Live preview
- [ ] More features coming soon

#### Strikethrough

This is ~~removed~~ updated text.

### Example Code Block

\`\`\`js
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

> Markdown is a lightweight markup language for creating formatted text.
`;

const INITIAL_HTML = parseMarkdown(DEFAULT_MARKDOWN);

export default function MarkdownPreviewRoute() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [html, setHtml] = useState(INITIAL_HTML);
  const [error, setError] = useState<string | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [parseTick, setParseTick] = useState(0);
  const { copied, copy } = useClipboard();

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        setHtml(parseMarkdown(markdown));
        setError(null);
        setParseTick((t) => t + 1);
      } catch {
        setError("Failed to parse markdown. Please check your input.");
      }
    }, 250);
  }, [markdown]);

  const updateCursorPosition = useCallback((el: HTMLTextAreaElement) => {
    const pos = el.selectionStart;
    const text = el.value.substring(0, pos);
    const lines = text.split("\n");
    setCursorLine(lines.length);
    setCursorCol((lines[lines.length - 1]?.length ?? 0) + 1);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMarkdown(e.target.value);
      setError(null);
      updateCursorPosition(e.target);
    },
    [updateCursorPosition],
  );

  const handleCursorMove = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      updateCursorPosition(e.currentTarget);
    },
    [updateCursorPosition],
  );

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setMarkdown(text);
        setError(null);
      }
    };
    reader.onerror = () => {
      setError("Failed to read file. Please try again.");
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-imported
    e.target.value = "";
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown]);

  const handleClear = useCallback(() => {
    setMarkdown("");
    setHtml("");
    setError(null);
  }, []);

  const handleCopyHtml = useCallback(() => {
    copy(html);
  }, [copy, html]);

  const shortcuts = useMemo(
    () => [
      { key: "c", meta: true, shift: true, handler: handleCopyHtml, enabled: !!html },
      { key: "x", meta: true, shift: true, handler: handleClear },
    ],
    [handleCopyHtml, html, handleClear],
  );

  useKeyboardShortcut(shortcuts);

  return (
    <ToolShell className="flex-grow sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleImport}
            className="min-h-11 sm:min-h-0"
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="min-h-11 sm:min-h-0"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClear}
            className="min-h-11 sm:min-h-0"
          >
            Clear
            <KbdHint>⌘⇧X</KbdHint>
          </Button>
          <Button size="sm" onClick={handleCopyHtml} className="min-h-11 sm:min-h-0">
            <IconSwap swapKey={copied}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy HTML"}
            </IconSwap>
            <KbdHint>⌘⇧C</KbdHint>
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} className="mb-4 mt-0" />

      <TwoPane
        className="gap-0 overflow-hidden rounded-lg border-2 border-ink bg-paper shadow-pop-3 transition-shadow duration-300 ease-out focus-within:shadow-pop-cta"
        left={
          <div className="flex flex-col border-b-2 border-ink lg:border-b-0 lg:border-r-2">
            <PaneHeader
              label="Markdown Editor"
              htmlFor="markdown-editor"
              className="border-b-2 bg-paper-2 px-4 py-2"
              actions={
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Line {cursorLine}, Column {cursorCol}
                </span>
              }
            />
            <Textarea
              id="markdown-editor"
              className="h-[500px] w-full resize-none rounded-none border-none bg-transparent p-6 font-mono text-sm leading-relaxed text-ink shadow-none placeholder:text-ink-3 focus-visible:ring-0"
              placeholder={"# Hello World\n\nType your markdown here..."}
              value={markdown}
              onChange={handleChange}
              onSelect={handleCursorMove}
              onClick={handleCursorMove}
              onKeyUp={handleCursorMove}
            />
          </div>
        }
        right={
          <div className="flex flex-col">
            <PaneHeader
              label="Preview"
              className="border-b-2 bg-paper-2 px-4 py-2"
              actions={
                <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  <span key={parseTick} className="wb-md-livedot" aria-hidden="true" />
                  Live
                </span>
              }
            />
            {html ? (
              <div
                className="markdown-preview h-[500px] overflow-y-auto p-6"
                data-testid="preview-pane"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized via DOMPurify
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div
                className="flex h-[500px] flex-col items-center justify-center gap-3 text-ink-3"
                data-testid="preview-empty"
              >
                <div className="wb-md-empty-icon grid size-14 place-items-center rounded-md border-2 border-ink bg-mint shadow-pop-2">
                  <PenLine className="h-6 w-6 text-ink" strokeWidth={2.25} />
                </div>
                <p className="text-sm font-medium text-ink-2">Start typing to see the preview</p>
              </div>
            )}
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        className="hidden"
        onChange={handleFileChange}
        data-testid="file-input"
      />
    </ToolShell>
  );
}
