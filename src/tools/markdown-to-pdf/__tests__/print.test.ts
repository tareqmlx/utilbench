import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarginKey, Orientation, PageSizeKey, PrintOptions } from "../print";
import {
  DEFAULTS,
  FONT_STACKS,
  MARGIN_PRESETS,
  PAGE_SIZES,
  SRCDOC_MAX,
  buildPrintDocument,
  buildPrintStylesheet,
  printHtml,
} from "../print";

const baseOpts: PrintOptions = {
  pageSize: "A4",
  orientation: "portrait",
  margin: "normal",
  fontFamily: "sans",
};

// Extract the body of a top-level CSS rule (e.g. `table { ... }`) without matching
// nested selectors. Returns the captured `{ ... }` body or null.
function ruleBody(css: string, selector: string): string | null {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? (m[1] ?? null) : null;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("buildPrintStylesheet", () => {
  const sizes: PageSizeKey[] = ["A4", "Letter", "Legal"];
  const orientations: Orientation[] = ["portrait", "landscape"];

  for (const size of sizes) {
    for (const orientation of orientations) {
      it(`@page size matches ${size} ${orientation}`, () => {
        const css = buildPrintStylesheet({ ...baseOpts, pageSize: size, orientation });
        expect(css).toContain(`size: ${PAGE_SIZES[size]} ${orientation};`);
      });
    }
  }

  it("maps margin presets normal/narrow/none", () => {
    const margins: MarginKey[] = ["normal", "narrow", "none"];
    for (const margin of margins) {
      const css = buildPrintStylesheet({ ...baseOpts, margin });
      expect(css).toContain(`margin: ${MARGIN_PRESETS[margin]};`);
    }
    expect(MARGIN_PRESETS.normal).toBe("20mm");
    expect(MARGIN_PRESETS.narrow).toBe("12mm");
    expect(MARGIN_PRESETS.none).toBe("0mm");
  });

  it("switches the font stack between sans and serif", () => {
    const sansCss = buildPrintStylesheet({ ...baseOpts, fontFamily: "sans" });
    const serifCss = buildPrintStylesheet({ ...baseOpts, fontFamily: "serif" });
    expect(sansCss).toContain(FONT_STACKS.sans);
    expect(sansCss).toContain("'Inter'");
    expect(sansCss).not.toContain("Georgia");
    expect(serifCss).toContain(FONT_STACKS.serif);
    expect(serifCss).toContain("Georgia");
    expect(serifCss).not.toContain("'Inter', system-ui");
  });

  it("applies break-inside: avoid to pre, blockquote, img", () => {
    const css = buildPrintStylesheet(baseOpts);
    const body = ruleBody(css, "pre, blockquote, img, figure");
    expect(body).not.toBeNull();
    expect(body).toContain("break-inside: avoid");
    expect(body).toContain("page-break-inside: avoid");
  });

  it("does NOT apply break-inside to the bare table selector", () => {
    const css = buildPrintStylesheet(baseOpts);
    // The `table { ... }` rule body must not contain break-inside.
    const tableBody = ruleBody(css, "table");
    expect(tableBody).not.toBeNull();
    expect(tableBody).not.toContain("break-inside");
  });

  it("keeps tr break-inside: avoid and thead table-header-group", () => {
    const css = buildPrintStylesheet(baseOpts);
    const trBody = ruleBody(css, "tr");
    expect(trBody).not.toBeNull();
    expect(trBody).toContain("break-inside: avoid");
    const theadBody = ruleBody(css, "thead");
    expect(theadBody).not.toBeNull();
    expect(theadBody).toContain("display: table-header-group");
  });

  it("is a plain document stylesheet, not wrapped in @media print", () => {
    const css = buildPrintStylesheet(baseOpts);
    expect(css).not.toContain("@media print");
  });
});

describe("buildPrintDocument", () => {
  it("wraps body in doctype + html and includes the stylesheet", () => {
    const doc = buildPrintDocument("<p>hi</p>", baseOpts);
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain("<html");
    expect(doc).toContain("<p>hi</p>");
    expect(doc).toContain(buildPrintStylesheet(baseOpts));
  });

  it("includes the Inter @font-face only for sans", () => {
    const sansDoc = buildPrintDocument("", { ...baseOpts, fontFamily: "sans" });
    const serifDoc = buildPrintDocument("", { ...baseOpts, fontFamily: "serif" });
    expect(sansDoc).toContain("@font-face");
    expect(sansDoc).toContain("inter-variable.woff2");
    expect(serifDoc).not.toContain("@font-face");
  });

  it("sets and sanitizes the title", () => {
    const doc = buildPrintDocument("", { ...baseOpts, title: "a<b>&c\n\td" });
    const title = doc.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    expect(title).not.toContain("<");
    expect(title).not.toContain(">");
    expect(title).not.toContain("&");
    expect(title).not.toContain("\n");
    expect(title).not.toContain("\t");
  });

  it("falls back to 'document' for empty/undefined title", () => {
    expect(buildPrintDocument("", baseOpts)).toContain("<title>document</title>");
    expect(buildPrintDocument("", { ...baseOpts, title: "" })).toContain("<title>document</title>");
    expect(buildPrintDocument("", { ...baseOpts, title: "   " })).toContain(
      "<title>document</title>",
    );
  });

  it("truncates a long title to <= 80 chars", () => {
    const longTitle = "x".repeat(200);
    const doc = buildPrintDocument("", { ...baseOpts, title: longTitle });
    const title = doc.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("maps DEFAULTS to A4/portrait/20mm/Inter in the document", () => {
    const doc = buildPrintDocument("<p>x</p>", { ...DEFAULTS });
    expect(doc).toContain("size: A4 portrait;");
    expect(doc).toContain("margin: 20mm;");
    expect(doc).toContain("'Inter'");
    expect(doc).toContain("@font-face");
  });
});

// ---------------------------------------------------------------------------
// printHtml lifecycle
// ---------------------------------------------------------------------------

interface FakeWindow {
  print: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  matchMedia: ReturnType<typeof vi.fn>;
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  addEventListener: ReturnType<typeof vi.fn>;
}

interface FakeIframe {
  setAttribute: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  style: { cssText: string };
  srcdoc?: string;
  src?: string;
  contentWindow: FakeWindow | null;
  contentDocument: Document | null;
  __listeners: Record<string, EventListener[]>;
  __fireLoad: () => void;
}

interface FakeFonts {
  ready: Promise<unknown>;
}

interface BuildFakeOpts {
  nullContentWindow?: boolean;
  fontsReady?: Promise<unknown>;
}

let mqlObj: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function buildFakeIframe(opts: BuildFakeOpts = {}): FakeIframe {
  const listeners: Record<string, EventListener[]> = {};

  mqlObj = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  const fonts: FakeFonts = { ready: opts.fontsReady ?? Promise.resolve() };

  const win: FakeWindow = {
    print: vi.fn(),
    focus: vi.fn(),
    matchMedia: vi.fn(() => mqlObj),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
    addEventListener: vi.fn(),
  };

  const idoc = {
    fonts,
    images: [] as HTMLImageElement[],
  } as unknown as Document;

  const fake: FakeIframe = {
    setAttribute: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const list = listeners[type] ?? [];
      list.push(listener);
      listeners[type] = list;
    }),
    remove: vi.fn(),
    style: { cssText: "" },
    contentWindow: opts.nullContentWindow ? null : win,
    contentDocument: opts.nullContentWindow ? null : idoc,
    __listeners: listeners,
    __fireLoad: () => {
      for (const l of listeners.load ?? []) l(new Event("load"));
    },
  };
  return fake;
}

describe("printHtml lifecycle", () => {
  let originalUserAgent: PropertyDescriptor | undefined;
  let fake: FakeIframe;

  function install(fakeIframe: FakeIframe) {
    fake = fakeIframe;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, ...rest: unknown[]) => {
      if (tag === "iframe") return fakeIframe as unknown as HTMLElement;
      // @ts-expect-error pass-through for non-iframe tags
      return realCreate(tag, ...rest);
    }) as typeof document.createElement);

    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      // The load listener is registered inside the same Promise executor before
      // appendChild runs — fire it now to resolve the load race synchronously.
      if (node === (fakeIframe as unknown as Node)) {
        fakeIframe.__fireLoad();
        return node;
      }
      return node;
    }) as typeof document.body.appendChild);
  }

  function setUserAgent(ua: string) {
    originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalUserAgent) {
      Object.defineProperty(navigator, "userAgent", originalUserAgent);
      originalUserAgent = undefined;
    }
    vi.restoreAllMocks();
  });

  it("sets the sandbox attribute without allow-scripts", async () => {
    install(buildFakeIframe());
    const p = printHtml("<p>x</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p;

    const sandboxCall = fake.setAttribute.mock.calls.find((c) => c[0] === "sandbox");
    expect(sandboxCall).toBeDefined();
    expect(sandboxCall?.[1]).toBe("allow-same-origin allow-modals");
    expect(sandboxCall?.[1]).not.toContain("allow-scripts");
  });

  it("uses srcdoc for a normal-size document", async () => {
    install(buildFakeIframe());
    const p = printHtml("<p>small</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p;

    expect(fake.srcdoc).toBeDefined();
    expect(fake.srcdoc).toContain("<!doctype html>");
    expect(fake.src).toBeUndefined();
  });

  it("uses a blob URL when the document exceeds SRCDOC_MAX", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    install(buildFakeIframe());
    const huge = `<p>${"y".repeat(SRCDOC_MAX + 100)}</p>`;
    const p = printHtml(huge, baseOpts);
    await vi.runAllTimersAsync();
    await p;

    expect(createObjectURL).toHaveBeenCalled();
    expect(fake.src).toBe("blob:fake");
    expect(fake.srcdoc).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("calls print() only after fonts.ready resolves", async () => {
    let resolveFonts!: () => void;
    const deferred = new Promise<void>((r) => {
      resolveFonts = r;
    });
    install(buildFakeIframe({ fontsReady: deferred }));

    const onStatus = vi.fn();
    const p = printHtml("<p>x</p>", baseOpts, { onStatus });

    await flush();
    expect(fake.contentWindow?.print).not.toHaveBeenCalled();

    resolveFonts();
    await flush();
    expect(fake.contentWindow?.print).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await p;
  });

  it("proceeds to print() and clears the mutex when fonts.ready never resolves", async () => {
    // A promise that never resolves — only the 4000ms race timeout can unblock.
    install(buildFakeIframe({ fontsReady: new Promise<void>(() => {}) }));
    const p = printHtml("<p>x</p>", baseOpts);

    await flush();
    expect(fake.contentWindow?.print).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    await flush();
    expect(fake.contentWindow?.print).toHaveBeenCalledTimes(1);

    // Drain remaining timers (backstop) → mutex clears.
    await vi.runAllTimersAsync();
    await p;

    // A subsequent print must run (mutex cleared).
    install(buildFakeIframe());
    const p2 = printHtml("<p>again</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p2;
    expect(fake.contentWindow?.print).toHaveBeenCalledTimes(1);
  });

  it("ignores a second concurrent printHtml call (mutex)", async () => {
    let resolveFonts!: () => void;
    const deferred = new Promise<void>((r) => {
      resolveFonts = r;
    });
    const first = buildFakeIframe({ fontsReady: deferred });
    install(first);

    const onStatus1 = vi.fn();
    const p1 = printHtml("<p>first</p>", baseOpts, { onStatus: onStatus1 });
    await flush();

    // Second call while the first is in flight — should be a no-op.
    const onStatus2 = vi.fn();
    const p2 = printHtml("<p>second</p>", baseOpts, { onStatus: onStatus2 });
    await p2; // resolves immediately (returns undefined)
    expect(onStatus2).not.toHaveBeenCalled();

    // Let the first one finish.
    resolveFonts();
    await vi.runAllTimersAsync();
    await p1;
    expect(onStatus1).toHaveBeenCalledWith("preparing");
  });

  it("fires onStatus preparing → dialog-open → done across the lifecycle", async () => {
    install(buildFakeIframe());
    const onStatus = vi.fn();
    const p = printHtml("<p>x</p>", baseOpts, { onStatus });

    await flush();
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(["preparing", "dialog-open"]);

    await vi.runAllTimersAsync();
    await p;
    expect(onStatus).toHaveBeenLastCalledWith("done");
  });

  it("removes the iframe only after MIN_HOLD following the mql not-matches signal", async () => {
    install(buildFakeIframe());
    const p = printHtml("<p>x</p>", baseOpts);
    await flush();

    // Retrieve the mql change handler the code registered.
    const changeHandler = mqlObj.addEventListener.mock.calls.find((c) => c[0] === "change")?.[1] as
      | ((e: { matches: boolean }) => void)
      | undefined;
    expect(changeHandler).toBeDefined();

    // Print dialog ends → matchMedia('print') no longer matches.
    changeHandler?.({ matches: false });

    // Before MIN_HOLD elapses, the iframe is still alive.
    await vi.advanceTimersByTimeAsync(1499);
    expect(fake.remove).not.toHaveBeenCalled();

    // After crossing MIN_HOLD (1500ms total), cleanup removes it.
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fake.remove).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await p;
  });

  it("does NOT register afterprint on Safari", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    );
    install(buildFakeIframe());
    const p = printHtml("<p>x</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p;

    const afterprintRegistered = fake.contentWindow?.addEventListener.mock.calls.some(
      (c) => c[0] === "afterprint",
    );
    expect(afterprintRegistered).toBe(false);
  });

  it("registers afterprint on Chrome", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    install(buildFakeIframe());
    const p = printHtml("<p>x</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p;

    const afterprintRegistered = fake.contentWindow?.addEventListener.mock.calls.some(
      (c) => c[0] === "afterprint",
    );
    expect(afterprintRegistered).toBe(true);
  });

  it("rejects when contentWindow is null and clears the mutex", async () => {
    install(buildFakeIframe({ nullContentWindow: true }));
    await expect(printHtml("<p>x</p>", baseOpts)).rejects.toThrow("Could not open a print frame.");
    expect(fake.remove).toHaveBeenCalled();

    // Mutex cleared — a subsequent (valid) call proceeds.
    install(buildFakeIframe());
    const p = printHtml("<p>ok</p>", baseOpts);
    await vi.runAllTimersAsync();
    await p;
    expect(fake.contentWindow?.print).toHaveBeenCalledTimes(1);
  });
});
