import { Download, Eraser, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbdHint } from "../../components/KbdHint";
import {
  ErrorAlert,
  PaneHeader,
  ToolShell,
  TwoPane,
  WarningAlert,
} from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import {
  DEFAULTS,
  type FontFamilyKey,
  type MarginKey,
  type Orientation,
  type PageSizeKey,
  type PrintOptions,
  cancelPrint,
  printMarkdown,
  renderMarkdown,
} from "./print";
import "./preview.css";

const PAGE_SIZE_OPTIONS: { value: PageSizeKey; label: string }[] = [
  { value: "A4", label: "A4" },
  { value: "Letter", label: "Letter" },
  { value: "Legal", label: "Legal" },
];

const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const MARGIN_OPTIONS: { value: MarginKey; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "narrow", label: "Narrow" },
  { value: "none", label: "None" },
];

const FONT_OPTIONS: { value: FontFamilyKey; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
];

const LARGE_DOC_BYTES = 2_000_000;

const PANE_HEIGHT = "clamp(420px,60vh,720px)";

const EXAMPLE_MARKDOWN = `# Project Brief

A quick overview of what this document covers. Everything renders **locally** —
*nothing leaves your browser*.

## Goals

1. Ship the feature
2. Write the docs
3. Celebrate

### Checklist

- [x] Draft the spec
- [x] Review with the team
- [ ] Ship to production

## Numbers

| Metric | Q1 | Q2 |
|--------|----|----|
| Users  | 120 | 340 |
| Revenue | $1.2k | $4.8k |

## Code

\`\`\`ts
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Keep it simple. Print it to PDF when you're done.

See the [docs](https://example.com) for more.
`;

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

// Hidden-iframe print() is unreliable on narrow/touch UAs (plan §10.2 / §14 A11).
function computeNarrowUa(): boolean {
  if (typeof window === "undefined") return false;
  // Touch-PRIMARY device (phones/tablets). (hover: none) and (pointer: coarse) excludes
  // touchscreen laptops/desktops, which report a fine pointer + hover and are desktop-class.
  const coarse = window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ?? false;
  const narrow = window.matchMedia?.("(max-width: 640px)")?.matches ?? false;
  return coarse || narrow;
}

export default function MarkdownToPdfRoute() {
  const [markdown, setMarkdown] = useState("");
  const [html, setHtml] = useState("");
  const [prefs, setPrefs] = useToolPreferences("markdown-to-pdf", {
    pageSize: DEFAULTS.pageSize as PageSizeKey,
    orientation: DEFAULTS.orientation as Orientation,
    margin: DEFAULTS.margin as MarginKey,
    fontFamily: DEFAULTS.fontFamily as FontFamilyKey,
  });
  const [docTitle, setDocTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "preparing" | "dialog-open">("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Tracks an explicit dismiss of the large-doc warning so it doesn't re-flap on every keystroke.
  const warningDismissedRef = useRef(false);
  // Reactive so resizing/rotating below 640px after load toggles the desktop note (plan §10.2 / §14 A11).
  const [isNarrowUa, setIsNarrowUa] = useState(computeNarrowUa);
  useEffect(() => {
    const mql = window.matchMedia?.("(max-width: 640px)");
    if (!mql) return;
    const update = () => setIsNarrowUa(computeNarrowUa());
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounced preview render. renderMarkdown is sync; on failure keep the last good html.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setHtml(renderMarkdown(markdown));
        setError(null);
      } catch {
        setError("Failed to render markdown. Please check your input.");
      }
      // Large-document warning for ANY input — typed, pasted, or imported (plan §7 / §6.2).
      // Byte count (not UTF-16 length) so it matches LARGE_DOC_BYTES and imported UTF-8 file sizes.
      const isLarge = new TextEncoder().encode(markdown).length > LARGE_DOC_BYTES;
      if (!isLarge) warningDismissedRef.current = false; // re-arm once back under the threshold
      setWarning(
        isLarge && !warningDismissedRef.current
          ? "Large document — the preview and print may be slow."
          : null,
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [markdown]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-imported even if we bail early.
    e.target.value = "";
    if (!file) return;

    setError(null);
    // A freshly imported file is new content → re-arm the large-doc warning even if a prior one was
    // dismissed. The warning itself is derived from the loaded text in the debounced effect (plan §7).
    warningDismissedRef.current = false;
    try {
      const text = await file.text();
      setMarkdown(text);
      setDocTitle(stripExtension(file.name));
    } catch {
      setError("Failed to read file. Please try again.");
    }
  }, []);

  const handleLoadExample = useCallback(() => {
    setMarkdown(EXAMPLE_MARKDOWN);
    setDocTitle("Project Brief");
    setError(null);
    setWarning(null);
  }, []);

  const handleClear = useCallback(() => {
    setMarkdown("");
    setHtml("");
    setDocTitle("");
    setError(null);
    setDownloadError(null);
    setWarning(null);
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloadError(null);
    if (status !== "idle") return;
    if (!markdown.trim()) {
      setDownloadError("Add some Markdown first.");
      return;
    }

    const opts: PrintOptions = {
      pageSize: prefs.pageSize,
      orientation: prefs.orientation,
      margin: prefs.margin,
      fontFamily: prefs.fontFamily,
      title: docTitle || undefined,
    };

    try {
      await printMarkdown(markdown, opts, {
        // The status union has no "done" — map it back to "idle" so the button re-enables.
        onStatus: (s) => setStatus(s === "done" ? "idle" : s),
      });
    } catch (e) {
      setStatus("idle");
      setDownloadError(
        e instanceof Error
          ? e.message
          : "Could not open the print dialog. Check your browser's popup/print settings.",
      );
    }
  }, [status, markdown, prefs, docTitle]);

  const canDownload = status === "idle" && !!markdown.trim();

  useKeyboardShortcut(
    useMemo(
      () => [
        { key: "Enter", meta: true, handler: () => void handleDownload(), enabled: canDownload },
      ],
      [handleDownload, canDownload],
    ),
  );

  const left = (
    // focus-within ring on the editor surface: the textarea zeroes its own ring, so the panel
    // carries the system tomato --ring on keyboard focus (Principle 4). has-[:focus-visible] (not
    // focus-within) keeps it off mouse clicks, matching the focus-visible convention used elsewhere.
    <div className="flex flex-col rounded-lg border-2 border-ink bg-paper shadow-pop-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background">
      <PaneHeader
        label="Markdown"
        htmlFor="md-input"
        icon={<FileText className="size-4" aria-hidden="true" />}
        className="bg-paper-2"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImport}
              className="min-h-11 sm:min-h-0"
            >
              <Upload className="size-4" aria-hidden="true" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLoadExample}
              className="min-h-11 sm:min-h-0"
              data-testid="load-example"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Load example
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClear}
              className="min-h-11 sm:min-h-0"
            >
              <Eraser className="size-4" aria-hidden="true" />
              Clear
            </Button>
          </div>
        }
      />
      <Textarea
        id="md-input"
        style={{ height: PANE_HEIGHT }}
        className="w-full resize-none rounded-none border-none bg-transparent p-6 font-mono text-sm leading-relaxed text-ink shadow-none placeholder:text-ink-3 focus-visible:ring-0"
        placeholder={"# Hello World\n\nType your Markdown here, then download as PDF…"}
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChange}
        data-testid="md-input-file"
      />
      <div className="px-4 pb-4">
        <ErrorAlert error={error} className="mt-0" onDismiss={() => setError(null)} />
      </div>
    </div>
  );

  const right = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col rounded-lg border-2 border-ink bg-paper shadow-pop-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background">
        <PaneHeader
          label="Preview"
          icon={<FileText className="size-4" aria-hidden="true" />}
          className="bg-paper-2"
        />
        {html ? (
          <div
            // Distinct key from the empty branch → React remounts on the empty→filled edge, so
            // wb-fade-in plays once when content first renders. Stable across keystrokes (key stays
            // "filled"), so the reveal doesn't re-flap on every debounced re-render.
            key="preview-filled"
            // Labeled landmark + tabindex so keyboard users can focus and arrow-scroll the
            // overflowing preview (WCAG 2.1.1); the region also scopes the rendered document's own
            // heading outline. focus shows on the panel wrapper's tomato ring (no inner outline).
            role="region"
            aria-label="Rendered Markdown preview"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region — tabIndex=0 lets keyboard users focus and arrow-scroll the overflow (WCAG 2.1.1)
            tabIndex={0}
            style={{ height: PANE_HEIGHT }}
            className="markdown-preview wb-fade-in overflow-y-auto p-6 focus-visible:outline-none"
            data-testid="preview-pane"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized via DOMPurify
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div
            // Intentionally no enter animation: clearing should feel instant, and we avoid a
            // page-load fade on the default empty state (product register: no load choreography).
            key="preview-empty"
            aria-label="Rendered Markdown preview"
            style={{ height: PANE_HEIGHT }}
            className="flex flex-col items-center justify-center gap-3 text-ink-3"
            data-testid="preview-empty"
          >
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-md border-2 border-ink bg-mint shadow-pop-2"
            >
              <FileText className="h-6 w-6 text-ink" strokeWidth={2.25} />
            </span>
            <p className="text-sm font-medium text-ink-2">
              {markdown
                ? "Nothing to preview yet — add some Markdown content."
                : "Start typing to see the preview, then download as PDF"}
            </p>
          </div>
        )}
      </div>

      <section
        className="flex flex-col gap-5 rounded-lg border-2 border-ink bg-paper p-5 shadow-pop-2 sm:p-6"
        aria-label="Page setup"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="md-page-size" className="text-ink-2">
              Page size
            </Label>
            <Select
              value={prefs.pageSize}
              onValueChange={(v) => setPrefs({ pageSize: v as PageSizeKey })}
            >
              <SelectTrigger
                id="md-page-size"
                className="h-11 border-2 border-ink bg-paper sm:h-10"
                data-testid="page-size-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="md-orientation" className="text-ink-2">
              Orientation
            </Label>
            <Select
              value={prefs.orientation}
              onValueChange={(v) => setPrefs({ orientation: v as Orientation })}
            >
              <SelectTrigger
                id="md-orientation"
                className="h-11 border-2 border-ink bg-paper sm:h-10"
                data-testid="orientation-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORIENTATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="md-margin" className="text-ink-2">
              Margins
            </Label>
            <Select
              value={prefs.margin}
              onValueChange={(v) => setPrefs({ margin: v as MarginKey })}
            >
              <SelectTrigger
                id="md-margin"
                className="h-11 border-2 border-ink bg-paper sm:h-10"
                data-testid="margin-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARGIN_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="md-font" className="text-ink-2">
              Font
            </Label>
            <Select
              value={prefs.fontFamily}
              onValueChange={(v) => setPrefs({ fontFamily: v as FontFamilyKey })}
            >
              <SelectTrigger
                id="md-font"
                className="h-11 border-2 border-ink bg-paper sm:h-10"
                data-testid="font-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="md-title" className="text-ink-2">
            Document title <span className="text-ink-3">(optional)</span>
          </Label>
          <Input
            id="md-title"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder="document"
            className="h-11 border-2 border-ink bg-paper sm:h-10"
            data-testid="doc-title"
          />
        </div>

        {isNarrowUa && (
          <p
            className="rounded-[14px] border-2 border-ink bg-lemon px-4 py-3 text-[13px] leading-relaxed text-ink"
            data-testid="desktop-note"
          >
            PDF export works best on desktop. On mobile, your browser may not offer a "Save as PDF"
            option.
          </p>
        )}

        <Button
          type="button"
          onClick={() => void handleDownload()}
          disabled={!canDownload}
          aria-busy={status === "preparing"}
          className="wb-btn w-full justify-center py-4 text-[15px]"
          data-testid="download-pdf"
        >
          {status === "preparing" ? (
            // Spinner conveys the (brief) render+font-load work; motion-reduce keeps it a static glyph.
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {status === "preparing" ? "Preparing…" : "Download PDF"}
          <KbdHint>⌘⏎</KbdHint>
        </Button>

        <ErrorAlert
          error={downloadError}
          className="mt-0"
          onDismiss={() => setDownloadError(null)}
        />

        {status === "dialog-open" && (
          <output
            className="wb-fade-in flex items-start gap-3 rounded-[14px] border-2 border-ink bg-paper-2 px-4 py-3"
            data-testid="dialog-hint"
          >
            <span className="flex-1 font-mono text-[13px] leading-relaxed text-ink">
              Your browser's print dialog should open — choose "Save as PDF". If you don't see it,
              check your browser's popup/print settings.
            </span>
            <button
              type="button"
              // If print() failed silently, no dialog/event fires — let the user dismiss now and retry
              // instead of waiting out the 60s backstop. cancelPrint() force-cleans the in-flight print
              // (its onStatus "done" maps status back to idle, hiding this hint and re-enabling Download).
              onClick={() => cancelPrint()}
              className="shrink-0 font-mono text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink"
              data-testid="dialog-hint-dismiss"
            >
              Dismiss
            </button>
          </output>
        )}

        <WarningAlert
          warning={warning}
          className="mt-0"
          onDismiss={() => {
            warningDismissedRef.current = true;
            setWarning(null);
          }}
        />
      </section>
    </div>
  );

  return (
    <ToolShell>
      <TwoPane gap="8" left={left} right={right} />
    </ToolShell>
  );
}
