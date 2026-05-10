# Utilbench — Design System

**Codename:** *Workbench (V4)*
**Version:** 1.0 · 2026.04.28
**Owner:** Utilbench design
**Source of truth:** this file. The homepage (`variations/04-workbench.html`) and the live specimen (`design-system/v4-workbench.html`) implement everything below.

Use this document when designing any inner page (tool detail, settings, privacy, changelog, 404, etc.) so the app stays visually consistent with the homepage.

---

## 0. Voice & principles

The system is a **friendly developer toolbox**: warm cream paper, ink-black outlines, hard pop-shadows, fixed pastel "stickers." It should feel tactile — like grabbing a tool off a pegboard — never corporate, never glassy.

1. **Sticker, not shadow.** Borders are always **2 px solid ink**. Shadows are *hard* offsets — never blurred, never `rgba()`-soft.
2. **Paper, not gradient.** One warm cream background. The page-level polka-dot pattern stays at the body; cards do not carry their own pattern.
3. **Pastels, fixed set.** Pink, lilac, mint, sky, lemon. Tomato and grass are reserved for CTA / status — never as a card fill.
4. **Type with a smile.** Bricolage Grotesque does the loud bits; Inter handles body; Geist Mono runs labels, kbd, and code.
5. **Tilt, but rarely.** Stickers in the hero may rotate ±4–6°. Cards stay square. Don't tilt the world.
6. **Loud is allowed; busy is not.** A page can be playful with one big hero gesture, but the working surface (forms, tables, results) is calm.

---

## 1. Tokens

Drop this `:root` block into your global stylesheet once and every component below inherits it.

```css
:root{
  /* PAPER — warm cream stack */
  --bg:        #fff7ec;
  --bg-2:      #ffeed5;
  --bg-3:      #ffe2b8;

  /* INK */
  --ink:       #1f1a14;
  --ink-2:     #4a4138;
  --ink-3:     #786b5b;
  --rule:      #1f1a14;     /* sticker borders are always full-ink */

  /* PASTELS — fixed sticker palette */
  --pink:      #ffc8d8;
  --lilac:     #d8c8ff;
  --mint:      #b9ecd0;
  --sky:       #b8dcff;
  --lemon:     #ffea88;

  /* HOTS — CTA & status only */
  --tomato:    #ff6a4a;
  --grass:     #4a8a55;

  /* RADII */
  --rad-sm:    8px;     /* badges, micro chips */
  --rad:       14px;    /* buttons, inputs, sticker chips */
  --rad-lg:    18px;    /* tiles, cards, panels */
  --rad-pill:  999px;   /* nav, filter chips */

  /* BORDERS */
  --bw:        2px;     /* default sticker outline — never deviate */
  --bw-thick:  3px;     /* hero / focus state only */

  /* HARD SHADOWS — no blur, no opacity */
  --pop-1:     2px 2px 0 var(--ink);
  --pop-2:     3px 3px 0 var(--ink);
  --pop-3:     4px 4px 0 var(--ink);
  --pop-4:     5px 5px 0 var(--ink);
  --pop-cta:   5px 5px 0 var(--tomato);

  /* SPACING — 4px base */
  --s-1:  4px;  --s-2:  8px;  --s-3:  12px; --s-4:  16px;
  --s-5:  22px; --s-6:  28px; --s-8:  36px; --s-10: 44px;
  --s-12: 52px; --s-16: 72px; --s-20: 88px; --s-24: 112px;

  /* FACES */
  --font-sans:    "Inter", system-ui, sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;
  --font-display: "Bricolage Grotesque", "Inter", sans-serif;
}
```

### Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap">
```

---

## 2. Color usage

| Token        | Where it goes                                                   | Where it must NOT go                  |
|--------------|-----------------------------------------------------------------|---------------------------------------|
| `--bg`       | The page itself, default tile/card surface                      | Anywhere over an ink background       |
| `--bg-2/3`   | Sunken panels (results, code output, settings rows)             | As a primary card flavor              |
| `--ink`      | Text, all 2 px outlines, inverted hero/CTA fill                 | As a card flavor on more than one tile per row |
| `--ink-2/3`  | Body / meta text only                                           | As an outline                         |
| Pastels      | Tile flavors, sticker chips, hero sticker accents               | As text color on a pastel background  |
| `--tomato`   | Primary-CTA pop-shadow, hero word emphasis (`em`), error state  | As a fill — it screams                |
| `--grass`    | Success state, "all-local" status dot                           | As a fill                             |

**Rule of thirds for tile walls:** a row of 4 tiles should mix 2–3 pastel flavors plus at most one inverted (`--ink`) tile or one `--lemon` featured tile. Never two ink tiles adjacent.

### Page background pattern

Use this only on the `<body>`, never on cards:

```css
body{
  background:
    radial-gradient(circle at 12% 18%, var(--pink) 0 1px, transparent 1.4px) 0 0/22px 22px,
    radial-gradient(circle at 70% 60%, var(--lilac) 0 1px, transparent 1.4px) 11px 11px/22px 22px,
    var(--bg);
}
```

---

## 3. Type

| Role         | Class        | Family               | Weight | Size   | Line-height | Tracking  |
|--------------|--------------|----------------------|--------|--------|-------------|-----------|
| Display      | `.t-display` | Bricolage Grotesque  | 800    | 88 px  | 0.92        | -0.04em   |
| H1           | `.t-h1`      | Bricolage Grotesque  | 800    | 64 px  | 0.96        | -0.035em  |
| H2           | `.t-h2`      | Bricolage Grotesque  | 800    | 42 px  | 1.0         | -0.03em   |
| H3           | `.t-h3`      | Bricolage Grotesque  | 700    | 24 px  | 1.1         | -0.02em   |
| H4           | `.t-h4`      | Bricolage Grotesque  | 700    | 18 px  | 1.2         | -0.015em  |
| Body         | `.t-body`    | Inter                | 400    | 15 px  | 1.55        | 0         |
| Body small   | `.t-body-sm` | Inter                | 400    | 13.5 px| 1.5         | 0         |
| Meta label   | `.t-meta`    | Geist Mono           | 500    | 11 px  | —           | UPPER 0.12em |
| Mono small   | `.t-mono-sm` | Geist Mono           | 400    | 12 px  | 1.5         | 0         |

### Rules

- **Display & headings always Bricolage.** No mixing serifs in.
- **Body always Inter.** Geist Mono is for *labels, paths, kbd, code, and pin numbers* — never for paragraph text.
- **Italics in display type are an emphasis tool, not a style.** Wrap a single word in `<em>` to lift it; pair with `--tomato` for the hero hit.
- **Line height inversely proportional to size.** Don't let big type breathe with body line-height — it loses its punch.
- **Page hero rule:** exactly one `.t-display` per page. Inner pages should use `.t-h1` for their primary heading.

---

## 4. Spacing & layout

- **Grid:** 4 px base. Use the named scale (`--s-1 … --s-24`) — no arbitrary px.
- **Page shell:** `max-width: 1320px; padding: 0 28px;` (use the helper class `.shell`).
- **Section rhythm:** `padding: 72px 0` with a 2 px ink bottom rule. Stack sections, never overlap.
- **Section header anatomy:** mono pill label + display H2 + italic dim tail.
  ```html
  <div class="section-head">
    <span class="pill">§ 03 · WORKBENCH</span>
    <h2>Pick a tile, <em>start tinkering.</em></h2>
  </div>
  ```
- **Card padding:** `--s-5` (22 px) default, `--s-6` (28 px) for hero/feature cards.
- **Vertical rhythm inside a card:** `gap: 14px` between blocks (icon → title → body → arrow).

### Radii decision tree

| Element                          | Radius        |
|----------------------------------|---------------|
| Badge, kbd, micro chip           | `--rad-sm`    |
| Button, input, sticker, icn box  | `--rad`       |
| Tile, card, modal panel          | `--rad-lg`    |
| Nav bar, filter chip             | `--rad-pill`  |

### Shadow decision tree

| Element                                  | Shadow         |
|------------------------------------------|----------------|
| `.kbd`                                   | `1px 1px 0 ink` (built-in) |
| Sticker chip, input, small button        | `--pop-2`      |
| Tile / card (default)                    | `--pop-3`      |
| Ghost button, hero card, lemon button    | `--pop-4`      |
| **Primary CTA only**                     | `--pop-cta`    |

Hover lift: `transform: translate(-2px,-2px)` and bump shadow by 1 step (e.g. `--pop-3 → 6px 6px 0 ink`).

---

## 5. Components

### 5.1 Buttons

```html
<a class="btn">Primary action →</a>
<a class="btn btn--ghost">Secondary</a>
<a class="btn btn--lemon">On dark surfaces</a>
<a class="btn btn--sm">Compact</a>
<a class="btn btn--pill">Pill shape</a>
```

| Variant       | Fill        | Shadow       | When                                              |
|---------------|-------------|--------------|---------------------------------------------------|
| `.btn`        | `--ink`     | `--pop-cta`  | The single primary action on a page               |
| `.btn--ghost` | `--bg`      | `--pop-4`    | Secondary actions, "Cancel," "Read more"          |
| `.btn--lemon` | `--lemon`   | `--pop-4`    | Primary action on top of an ink/dark surface (nav)|
| `.btn--sm`    | inherits    | `--pop-2`    | Inline / table actions                            |
| `.btn--pill`  | inherits    | `--pop-2`    | Filter rows, segmented controls                   |

**Never** more than one `--pop-cta` button visible at once.

### 5.2 Inputs

```html
<label class="input">
  <svg>…search icon…</svg>
  <input placeholder="Search 17 utilities…" />
  <span class="kbd">⌘K</span>
</label>
```

- 2 px ink outline, `--pop-2` shadow, `--rad`.
- **No focus ring.** Focus state inverts the surface to `--bg-2` and bumps shadow to `--pop-3`.
- Error state: keep the outline ink, set shadow color to `--tomato`, add a `.t-mono-sm` message in `--tomato` below.
- Textareas inherit the same outline & shadow; height is content-driven, never auto-resize on each keystroke.

### 5.3 KBD

```html
<span class="kbd">⌘</span> <span class="kbd">K</span>
```

Inline only. Never stack vertically. Never use inside body text without a leading space.

### 5.4 Stickers (chips)

```html
<span class="sticker"><span class="dot"></span>17 utilities</span>
<span class="sticker sticker--mint"><span class="dot" style="background:var(--grass)"></span>all-local</span>
```

- Default upright. Apply `.tilt-l` / `.tilt-r` **only in hero contexts** (max 4 per page).
- Status dot color carries the meaning: ink (neutral), tomato (alert), grass (ok).

### 5.5 Filter chips

```html
<span class="chip on">All · 17</span>
<span class="chip">Media</span>
<span class="chip">Data</span>
<span class="chip">Text</span>
```

Pill-shaped, 2 px outline. `.on` inverts to ink. Off-state hovers to `--lemon`.

### 5.6 Tile (the workhorse)

```html
<a class="tile tile--mint">
  <span class="pin">★ 02</span>
  <div class="icn"><svg width="20" height="20">…</svg></div>
  <h3>Cron Parser</h3>
  <p>Translate cron strings into plain English.</p>
  <span class="arrow">Open →</span>
</a>
```

**Anatomy (top → bottom):**
1. `.pin` — top-right mono micro-label (`★ 02`, `NEW`, `BETA`, `★ FEATURED`).
2. `.icn` — 48×48, 2 px outline, `--rad`. Stroke-icon centered. Stroke width **2**.
3. `<h3>` — Bricolage 700, 24 px.
4. `<p>` — Inter 13.5 px, `--ink-2`.
5. `.arrow` — bold "Open →" anchor at the bottom-left.

**Flavors:** `--pink`, `--lilac`, `--mint`, `--sky`, `--lemon`, `--bg-2`, `--bg-3`, plus inverted `--ink` (use sparingly — max one per row).

The big featured tile on the homepage uses `--lemon` with an ink-filled `.icn` and a 36 px `<h3>`.

### 5.7 Cards & panels

For inner pages, treat **`.tile`** as the universal panel:

- Form panels: `tile` with `--bg` fill, no `.pin`, larger padding (`--s-6`).
- Result / output panels: `tile` with `--bg-2` fill, `.t-meta` header, optional `.kbd` "copy" hint at top-right.
- Sidebars / nav rails: `tile` with `--bg-3` fill, vertical link list.

### 5.8 Code blocks

```html
<pre class="code">…</pre>
```

```css
pre.code{
  background: var(--ink);
  color: var(--bg);
  border: var(--bw) solid var(--ink);
  border-radius: var(--rad);
  padding: 18px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  box-shadow: var(--pop-3);
}
pre.code .c{ color:#a89a85 }   /* comment */
pre.code .k{ color:var(--lemon) } /* keyword */
pre.code .s{ color:var(--mint) }  /* string */
```

Code blocks are the only place ink is used as a background outside the nav.

---

## 6. Patterns

### 6.1 Top nav

A **floating black pill** sits 14 px below the top edge.

```html
<nav class="spec-nav"><div class="inner">
  <div class="brand"><span class="badge-glyph">…U…</span> Utilbench</div>
  <div class="toc">
    <a href="/tools" class="on">Tools</a>
    <a href="/privacy">Privacy</a>
    <a href="/changelog">Changelog</a>
  </div>
  <a href="#palette" class="cta">Open ⌘K palette →</a>
</div></nav>
```

- Background: `--ink`, text `--bg`, `--rad-pill`, shadow `--pop-cta`.
- Brand glyph: 28×28 lemon square, 2 px ink outline, rotated –6°.
- Active link: white-on-black with `rgba(255,255,255,.12)` fill.
- Right-side CTA always uses `.cta` (lemon pill).

### 6.2 Hero (homepage and any landing page)

```html
<section class="hero">
  <h1>The toolbox<br><em>for the browser.</em><br><span class="blob">no servers</span></h1>
  <p class="lede">17 fast, private utilities…</p>
  <div class="cta-row">
    <a class="btn">Browse the workbench →</a>
    <a class="btn btn--ghost">Read the privacy bit</a>
  </div>
  <span class="sticker s1 sticker--pink tilt-l">privacy first</span>
  <!-- up to 4 floating stickers, each tilted -->
</section>
```

- Display heading is the only `.t-display` on the page.
- One word in `<em>` colored `--tomato`.
- Optional `.blob`: lemon sticker pill containing one phrase, 2 px outline, rotated -2°.
- Floating stickers ride the corners (`s1` top-left, `s2` top-right, `s3` bottom-left, `s4` bottom-right).

### 6.3 Inner page hero (lighter)

For tool pages and content pages, demote to `.t-h1` and skip the blob/floating stickers.

```html
<section class="page-hero">
  <span class="sticker sticker--mint"><span class="dot" style="background:var(--grass)"></span>all-local</span>
  <h1 class="t-h1">JSON <em>Formatter</em>.</h1>
  <p class="t-body" style="max-width:62ch">Format, validate, and beautify JSON…</p>
</section>
```

### 6.4 Tool page layout

A two-column workbench: input on the left, output on the right, both as `.tile` panels.

```
┌─────────── nav ───────────┐
│                           │
│  page-hero (sticker, h1)  │
│                           │
├─────────────┬─────────────┤
│   INPUT     │   OUTPUT    │   ← two .tile panels
│   tile      │   tile bg-2 │
│   (form)    │   (result)  │
└─────────────┴─────────────┘
│  related tools (3 tiles)  │
└─────────── footer ────────┘
```

- Both panels share the same height via `align-self: stretch`.
- Toolbar above each panel: `.t-meta` label on the left, `.btn--sm` actions on the right (Copy, Download, Reset).
- On mobile, stack vertically; output panel keeps `--bg-2` fill so the result is recognisable at a glance.

### 6.5 Section rhythm (any page)

```html
<section class="section">
  <div class="shell">
    <div class="section-head">
      <span class="pill">§ 02 · OUTPUT</span>
      <h2>Your formatted JSON, <em>line by line.</em></h2>
    </div>
    <!-- content -->
  </div>
</section>
```

- Sections separated by 2 px ink rules — never spaced by margin alone.
- Each page has 3–5 sections max.

### 6.6 Footer

```html
<footer>
  <div class="shell row">
    <h5>UTILBENCH</h5> <ul>…</ul>
    <h5>TOOLS</h5>   <ul>…</ul>
    <h5>SYSTEM</h5>  <ul>…</ul>
    <h5>SAY HI</h5>  <ul>…</ul>
  </div>
</footer>
```

- Footer is always full-bleed `--ink`, `--bg` text, `border-radius: 32px 32px 0 0`.
- Section headers `.t-meta` in `#a89a85`. Links `--bg` at .85 opacity, hover to 1.

---

## 7. Iconography

- Style: **Lucide stroke icons**, stroke width **2**, no fills.
- Render at 18–22 px inside `.icn`, or 14 px inline.
- Color: `currentColor` — never coloured fills.
- One icon per tile. Don't stack icons.

---

## 8. Motion

- Default transition: `transition: .15s` on `transform, box-shadow, background`.
- Hover lift: `translate(-2px, -2px)` + shadow bump by 1 step.
- Active (pressed): `translate(0, 0)` + shadow drop to `--pop-1`.
- No fade-ins on scroll. No parallax. No glow.
- Loading: a sticker that says `WORKING…` with a `1s steps(3)` ellipsis animation. No spinners.

---

## 9. States

| State        | Treatment                                                                 |
|--------------|---------------------------------------------------------------------------|
| Hover        | translate(-2,-2), shadow +1 step                                          |
| Active/press | translate(0,0), shadow `--pop-1`                                          |
| Focus        | shadow color → `--tomato` (keeps 2 px ink outline as the visible ring)    |
| Disabled     | `opacity: .5; pointer-events: none;` — never grey out the outline         |
| Selected     | `.on` modifier (chip) or `tile--ink` swap (tile-as-toggle)                |
| Error        | shadow color → `--tomato`, message below in `.t-mono-sm` colored `--tomato` |
| Success      | `.sticker` with grass dot, message in `.t-body-sm`                        |
| Empty        | A `.tile tile--bg-2` containing a single sticker + `.t-h3` + `.t-body-sm` |

---

## 10. Accessibility

- Body type minimum 14 px; meta minimum 11 px.
- All interactive elements must have an ink outline at rest — focus is signalled by shadow color, **never** by colour-only.
- Color contrast: ink (#1f1a14) on every pastel passes AA at body size. Do not put `--ink-3` on a pastel.
- Hit target minimum 36 × 36 px (use `--s-8`).
- `prefers-reduced-motion`: drop the hover translate, keep the shadow change.
- Always pair color status (tomato/grass) with a text label or icon.

---

## 11. Don'ts

- Don't introduce blurred shadows. The shadow is the brand.
- Don't introduce a new accent color. Five pastels + tomato + grass — full stop.
- Don't replace 2 px outlines with 1 px hairlines. The system loses its weight.
- Don't tilt cards, only stickers, only in hero.
- Don't put body text in Bricolage. Don't put paragraph text in Geist Mono.
- Don't use rounded-rect drop shadows from Material/iOS. Use `--pop-*`.
- Don't gradient-fill a tile.
- Don't stack two ink tiles or two lemon tiles next to each other.
- Don't add a focus ring around an already-outlined element.

---

## 12. Component checklist for new pages

When designing an inner page, walk this list:

- [ ] Page background uses the polka-dot pattern from §2.
- [ ] Top nav uses the floating black pill, with active link highlighted.
- [ ] Page hero uses `.t-h1` (not `.t-display`) and at most one sticker.
- [ ] All borders are 2 px solid `--ink`. No 1 px, no rgba.
- [ ] All shadows are from the `--pop-*` set. No blur.
- [ ] Exactly one primary `.btn` (`--pop-cta`) per page.
- [ ] Tiles/panels use the right flavor mix: 2–3 pastels + at most one ink/lemon.
- [ ] Type uses the role classes (`.t-h1`, `.t-body`, etc.) — no ad-hoc font sizes.
- [ ] Icons are Lucide-style stroke, 2 px, `currentColor`.
- [ ] Footer is the full-bleed ink slab with rounded top corners.
- [ ] Reduced-motion users still see hover state via shadow change.

---

## 13. Quick HTML scaffold for a new inner page

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Utilbench — [Page name]</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/design-system/v4-workbench.css">
</head>
<body>
  <nav class="spec-nav"><div class="inner">…</div></nav>

  <section class="page-hero shell">
    <span class="sticker sticker--mint">…status…</span>
    <h1 class="t-h1">[Page title], <em>one bold word.</em></h1>
    <p class="t-body" style="max-width:62ch">[One-sentence lede.]</p>
  </section>

  <section class="section">
    <div class="shell">
      <div class="section-head">
        <span class="pill">§ 01 · [LABEL]</span>
        <h2>[Section heading], <em>quiet tail.</em></h2>
      </div>
      <!-- .tile panels go here -->
    </div>
  </section>

  <footer>…</footer>
</body>
</html>
```

---

*Implementations:*
- Live homepage — `variations/04-workbench.html`
- Live specimen — `design-system/v4-workbench.html` (copy its `<style>` block to bootstrap a CSS file)
