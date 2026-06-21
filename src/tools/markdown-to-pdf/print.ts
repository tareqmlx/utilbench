import { renderMarkdown } from "@/lib/markdown";

export type PageSizeKey = "A4" | "Letter" | "Legal";
export type Orientation = "portrait" | "landscape";
export type MarginKey = "normal" | "narrow" | "none";
export type FontFamilyKey = "sans" | "serif";

// CSS @page sizes — keywords the print engine understands directly.
export const PAGE_SIZES: Record<PageSizeKey, string> = {
  A4: "A4",
  Letter: "letter",
  Legal: "legal",
};

// Margin presets → CSS @page margin value.
export const MARGIN_PRESETS: Record<MarginKey, string> = {
  normal: "20mm",
  narrow: "12mm",
  none: "0mm",
};

export const FONT_STACKS: Record<FontFamilyKey, string> = {
  sans: "'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
};

export const DEFAULTS = {
  pageSize: "A4" as PageSizeKey,
  orientation: "portrait" as Orientation,
  margin: "normal" as MarginKey,
  fontFamily: "sans" as FontFamilyKey,
} as const;

export interface PrintOptions {
  pageSize: PageSizeKey;
  orientation: Orientation;
  margin: MarginKey;
  fontFamily: FontFamilyKey;
  title?: string; // sets the iframe <title>; used by the browser as the default save filename
}

export interface PrintHooks {
  onStatus?: (s: "preparing" | "dialog-open" | "done") => void;
  timeoutMs?: number; // fallback cleanup if afterprint never fires (default ~60s)
}

export function buildPrintStylesheet(opts: PrintOptions): string {
  const size = `${PAGE_SIZES[opts.pageSize]} ${opts.orientation}`;
  const margin = MARGIN_PRESETS[opts.margin];
  const body = FONT_STACKS[opts.fontFamily];
  return `
    @page { size: ${size}; margin: ${margin}; }
    html, body { background: #fff; color: #111; }
    /* break-word mirrors the on-screen preview (preview.css: word-wrap:break-word) so long
       unbreakable tokens (300+ char URLs, bare links) WRAP instead of overflowing the fixed-width
       @page box and clipping silently in the PDF. overflow-wrap is inherited by all text descendants. */
    body { font-family: ${body}; font-size: 12pt; line-height: 1.5; margin: 0; overflow-wrap: break-word; }
    /* Headings */
    h1,h2,h3,h4,h5,h6 { color: #111; line-height: 1.25; margin: 1.2em 0 0.5em; page-break-after: avoid; break-after: avoid; }
    h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 0.8em; }
    /* Keep atomic blocks intact across pages. NOTE: do NOT put break-inside:avoid on <table> —
       a table taller than one page would then overflow/clip in Chrome. Allow the table to break
       between rows (thead repeats below); only individual rows/blocks are kept atomic. */
    pre, blockquote, img, figure { break-inside: avoid; page-break-inside: avoid; }
    pre { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 10pt;
          background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
    code { font-family: inherit; background: #eff1f3; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    /* Tables: repeat the header on every page */
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    blockquote { border-left: 4px solid #d0d7de; padding-left: 1em; color: #555; }
    img { max-width: 100%; height: auto; }
    a { color: #0969da; text-decoration: underline; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
    ul, ol { padding-left: 1.5em; }
    /* Decorative GFM task-list checkboxes (match markdown-preview) */
    input[type="checkbox"] { margin-right: 0.4em; }
  `;
}

// Inter @font-face injected so the iframe (a separate document) has the self-hosted font.
// Path matches public/fonts/inter-variable.woff2 (referenced by src/fonts.css, preloaded in index.html).
function interFontFace(): string {
  return `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url('/fonts/inter-variable.woff2') format('woff2');
      /* unicode-range copied verbatim from src/fonts.css so Inter is claimed only for Latin
         codepoints and CJK/emoji fall through to the system stack. */
      unicode-range:
        U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
        U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
        U+2212, U+2215, U+FEFF, U+FFFD;
    }
  `;
}

export function buildPrintDocument(bodyHtml: string, opts: PrintOptions): string {
  // Title is plain text → strip angle brackets/ampersand AND newlines/control chars (imported filenames
  // can carry them, producing a malformed <title>). Collapse whitespace; cap length.
  const title =
    (opts.title || "document")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars (newlines/tabs/NUL) that imported filenames can carry, so the <title> can't be malformed
      .replace(/[\x00-\x1f<>&]/g, " ") // control + HTML-significant chars
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "document"; // cap ~80 — the <title> becomes Chrome's save filename
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<style>${opts.fontFamily === "sans" ? interFontFace() : ""}${buildPrintStylesheet(opts)}</style>
</head><body>${bodyHtml}</body></html>`;
}

export const SRCDOC_MAX = 1_500_000; // ~1.5 MB — below the conservative srcdoc ceiling; exported for tests
let isPrinting = false; // module-level mutex (§2.1 trap 8)
let activeCleanup: (() => void) | null = null; // current print's cleanup, for cancelPrint()

// Force-cleanup the in-flight print. Used when print() fails silently (§2.1 trap 7): no dialog opens
// and no matchMedia/afterprint fires, so the UI would otherwise stay pinned until the 60s backstop.
// Lets the user dismiss the hint and retry immediately. No-op if nothing is printing.
export function cancelPrint(): void {
  activeCleanup?.();
}

export async function printHtml(
  bodyHtml: string,
  opts: PrintOptions,
  hooks?: PrintHooks,
): Promise<void> {
  if (isPrinting) return; // ignore a second click while a print is in flight
  isPrinting = true;
  hooks?.onStatus?.("preparing");
  const doc = buildPrintDocument(bodyHtml, opts);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // OFF-SCREEN with NON-ZERO width — width:0;height:0 is a flaky corner of Chrome's print pipeline
  // (blank first pages) and display:none/visibility:hidden suppress layout. left:-9999px keeps it
  // invisible while giving the document a real layout width.
  iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:1024px;height:1px;border:0;";
  // allow-same-origin: parent can write + read fonts; allow-modals: print() permitted. NO allow-scripts.
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");

  // srcdoc for normal docs; blob: URL for docs above the srcdoc ceiling (§2.1 trap 9).
  let blobUrl: string | null = null;
  if (doc.length <= SRCDOC_MAX) {
    iframe.srcdoc = doc;
  } else {
    blobUrl = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    iframe.src = blobUrl; // same sandbox applies
  }

  let cleaned = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  // backstop/mql are assigned once, but must be declared here (not const at the assignment site):
  // the early-exit cleanup() paths below reference them before assignment, which const would make a TDZ error.
  // biome-ignore lint/style/useConst: see above — needed for the early-cleanup forward reference
  let backstop: ReturnType<typeof setTimeout> | undefined;
  // biome-ignore lint/style/useConst: see above — needed for the early-cleanup forward reference
  let mql: MediaQueryList | undefined;
  const onMql = (e: MediaQueryListEvent) => {
    if (!e.matches) scheduleCleanup();
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer) clearTimeout(cleanupTimer);
    if (backstop) clearTimeout(backstop);
    mql?.removeEventListener?.("change", onMql);
    iframe.remove();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    activeCleanup = null;
    isPrinting = false;
    hooks?.onStatus?.("done");
  };
  activeCleanup = cleanup; // expose to cancelPrint() for the silent-failure path

  const MIN_HOLD = 1500; // ms the iframe must stay alive after the print signal before removal
  const scheduleCleanup = () => {
    if (cleanupTimer) clearTimeout(cleanupTimer); // single re-armed timer — never stack
    cleanupTimer = setTimeout(cleanup, MIN_HOLD);
  };

  // LOAD with a timeout race: a hung load would otherwise wedge isPrinting forever, because the 60 s
  // backstop is only armed AFTER load resolves. On timeout → cleanup + throw.
  const loadedOk = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 10_000);
    iframe.addEventListener(
      "load",
      () => {
        clearTimeout(t);
        resolve(true);
      },
      { once: true },
    );
    document.body.appendChild(iframe);
  });
  if (!loadedOk) {
    cleanup();
    throw new Error("Could not open a print frame.");
  }

  // contentDocument can THROW (not just return null) on some Firefox sandboxed-blob cases — guard so
  // cleanup() always runs and isPrinting can't wedge.
  let win: Window | null = null;
  let idoc: Document | null = null;
  try {
    win = iframe.contentWindow;
    idoc = iframe.contentDocument;
  } catch {
    /* falls to the check below */
  }
  if (!win || !idoc) {
    cleanup();
    throw new Error("Could not open a print frame.");
  }

  // 1) fonts loaded (else wrong metrics / fallback font). RACE a timeout so a hung font can't wedge
  //    isPrinting — fall through to the system-ui stack on timeout.
  const withTimeout = (p: Promise<unknown>, ms: number) =>
    Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
  try {
    await withTimeout(idoc.fonts?.ready ?? Promise.resolve(), 4000);
  } catch {
    /* proceed with fallback */
  }
  // 2) images decoded (else blank images in the print)
  await Promise.allSettled(
    Array.from(idoc.images).map((img) =>
      img.complete ? Promise.resolve() : img.decode().catch(() => {}),
    ),
  );
  // 3) one layout tick on the IFRAME window before print(), RACED against ~2 s so a throttled/paused
  //    rAF (background tab, power-save) can't wedge isPrinting. Layout is best-effort.
  await withTimeout(new Promise<void>((r) => win.requestAnimationFrame(() => r())), 2000);

  // 4) CLEANUP. PRIMARY signal: matchMedia('print')→not-print (fires when the dialog truly ends); each
  //    signal re-arms the single MIN_HOLD timer (anchored to the signal, not prep start). The 60 s
  //    backstop is the real fallback. `afterprint` is wired ONLY on non-WebKit: on Safari it fires at
  //    dialog-OPEN, which would schedule removal mid-dialog — there, mql + backstop carry cleanup.
  mql = win.matchMedia?.("print");
  mql?.addEventListener?.("change", onMql);
  // Treat iOS WebKit + desktop Safari as afterprint-unreliable; everything else wires afterprint.
  const isWebKit = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (!isWebKit) win.addEventListener("afterprint", scheduleCleanup, { once: true });
  backstop = setTimeout(cleanup, hooks?.timeoutMs ?? 60_000);

  hooks?.onStatus?.("dialog-open");
  try {
    win.focus(); // some browsers require focus before print()
    win.print(); // opens the native dialog; returns immediately, no reliable success/failure signal
  } catch (err) {
    // print()/focus() rarely throws (it usually fails silently — §2.1 trap 7), but if it does, the
    // backstop would otherwise hold isPrinting for 60 s and leak the iframe. Clean up now and rethrow.
    cleanup();
    throw err;
  }
}

// Convenience wrapper used by Route: render markdown then print.
export async function printMarkdown(
  src: string,
  opts: PrintOptions,
  hooks?: PrintHooks,
): Promise<void> {
  const html = renderMarkdown(src); // from @/lib/markdown (re-exported)
  return printHtml(html, opts, hooks);
}

export { renderMarkdown };
