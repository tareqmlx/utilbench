---
name: Utilbench
description: A workbench for the browser — friendly, paper-warm, sticker-board UI for local-only developer tools.
colors:
  bg: "#fff7ec"
  bg-2: "#ffeed5"
  bg-3: "#ffe2b8"
  ink: "#1f1a14"
  ink-2: "#4a4138"
  ink-3: "#786b5b"
  tomato: "#ff6a4a"
  lemon: "#ffea88"
  grass: "#4a8a55"
  pink: "#ffc8d8"
  lilac: "#d8c8ff"
  mint: "#b9ecd0"
  sky: "#b8dcff"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "clamp(40px, 9vw, 148px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  h1:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "clamp(32px, 4.5vw, 48px)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.035em"
  h2:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "clamp(28px, 3.4vw, 40px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  h3:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.12em"
  mono-sm:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
  button-ghost:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-lemon:
    backgroundColor: "{colors.lemon}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  chip-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  tile:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "22px"
  panel:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0"
  panel-out:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  sticker:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  kbd:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "6px"
    padding: "2px 6px"
---

# Design System: Utilbench

## 1. Overview

**Creative North Star: "The Sticker Workbench"**

Utilbench feels like a pegboard above a maker's desk: warm cream paper, ink-black outlines, candy-pastel stickers tacked at jaunty angles, and hard pop-shadows that cast a confident offset instead of a polite blur. Every tile is a tool you can almost lift off the wall. The whole surface is a single light theme — there is no dark mode and there is no system-pref fallback; the workbench is the workbench at any hour.

This system rejects the entire current decade of developer-tool aesthetic reflex: no slate-grey terminal chrome, no dark-mode-with-neon-accents, no glassmorphism, no SaaS-cream landing-page minimalism, no big-number/small-label hero metric grid. The page is allowed to be loud in *one* gesture (the hero, a sticker, a tomato em) and calm everywhere else. The working surface — forms, panels, results — is hushed; the marketing surface — homepage tiles, footer headline — is animated by hard color and weight.

**Key Characteristics:**
- One warm cream background. One ink. Five fixed pastels for tiles. One tomato for emphasis.
- Borders are always 2px solid ink — never hairlines, never tinted strokes.
- Shadows are always **hard offsets** of ink or tomato — never blurred, never `rgba()`-soft.
- Display type is condensed sans (Bricolage Grotesque, 800) with tight tracking and italic `<em>` highlights.
- Stickers may rotate ±2–6°. Cards stay square. Don't tilt the world.

## 2. Colors

A paper-and-pastel palette anchored by warm cream, locked to a single ink, and accented by exactly one CTA color (tomato) used sparingly.

### Primary
- **Tomato Flag** (`#ff6a4a`): The voice color. Used on the second line of the hero headline, the focus ring (`--ring`), the CTA pop-shadow halo, the leading "01." numerals in feature blocks, and `destructive` UI. Never used as a tile fill. Its rarity is its volume.

### Secondary
- **Lemon Highlight** (`#ffea88`): Worn by the header search button, by the hover state of pill chips, by the "No servers needed." rotated tag in the hero, and by selection (`::selection`). The system's secondary energy — playful, never urgent.

### Tertiary (the Sticker Set)
- **Sticker Pink** (`#ffc8d8`): Tile fill; hero sticker fill.
- **Sticker Lilac** (`#d8c8ff`): Tile fill; secondary sticker fill.
- **Sticker Mint** (`#b9ecd0`): Tile fill; "private by default" hero sticker; inline highlight on body copy.
- **Sticker Sky** (`#b8dcff`): Tile fill; hero sticker fill.
- **Grass** (`#4a8a55`): Status-only — the green dot on the "private by default" sticker. Never a fill, never a stroke.

### Neutral
- **Paper Cream** (`#fff7ec`): The page surface. The body background is this color painted under a fixed polka-dot lattice (`pink` and `lilac` dots, 22×22 grid). Cards do not repeat that pattern.
- **Paper Cream 2** (`#ffeed5`): Slight elevation — the output panel, the secondary tile flavor, feature blocks, the mobile menu.
- **Paper Cream 3** (`#ffe2b8`): Strongest tinted surface; used for one of the seven tile flavors.
- **Ink** (`#1f1a14`): The single text, border, and primary-fill color. A warm brown-black, never `#000`.
- **Ink 2** (`#4a4138`): Body copy on tinted tiles; secondary prose.
- **Ink 3** (`#786b5b`): Muted captions, pin labels on tiles, italic emphasis in display headlines.

### Named Rules

**The One Ink Rule.** There is one ink (`#1f1a14`). Every border, every divider, every hard shadow, every body text run uses *that* ink. Never substitute `#000`, never tint borders with the tile fill underneath them. The pegboard is held together by a single nail color.

**The One Voice Rule.** Tomato is the only color allowed to carry emphasis. It appears on ≤10% of any given screen. If a second emphasis color shows up, one of them is wrong.

**The Pegboard Rule.** Pink / Lilac / Mint / Sky / Lemon are tile fills. Tomato and Grass are *never* tile fills — they are status and voice. Mixing those roles dilutes both.

## 3. Typography

**Display Font:** Bricolage Grotesque (with Inter, sans-serif fallback)
**Body Font:** Inter (with ui-sans-serif, system-ui fallback)
**Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo fallback)

**Character:** Bricolage Grotesque does the shouting — variable-weight, condensed at scale, with italic alternates that lean editorial when used inside `<em>`. Inter keeps the working surface legible without personality intrusion. Geist Mono is the lab-notebook hand: small caps for `wb-meta`, kbd chips, pin labels on tiles, and the footer copyright run.

### Hierarchy

- **Display** (800, `clamp(40px, 9vw, 148px)`, line-height 0.92, tracking -0.04em): Hero headline only. One per page, max. Permitted to span three visual lines, with the second line in tomato and the third line as a rotated lemon sticker.
- **H1 / wb-h1** (800, `clamp(32px, 4.5vw, 48px)`, line-height 0.96, tracking -0.035em): Section anchors on long pages. Italic `<em>` in `ink-3` for the second half of a sentence is the system's signature emphasis pattern.
- **H2 / wb-h2** (800, line-height 1, tracking -0.03em): "The workbench" wall, "What you'll find here", and other major section openers.
- **H3 / wb-h3** (700, 22px, line-height 1.1, tracking -0.02em): Tile headings, feature block titles. The largest type allowed inside a card.
- **H4 / wb-h4** (700, line-height 1.2, tracking -0.015em): Tool sub-sections.
- **Body** (400, 16px, line-height 1.55): Inter. Wraps at 62ch in hero copy (`max-w-[62ch]`), 65–75ch elsewhere.
- **Body Small** (400, 13.5px, line-height 1.5, color `ink-2`): Tile descriptions, feature block bodies, footer links.
- **Meta / wb-meta** (500, 11px, mono, uppercase, tracking 0.12em, color `ink-3`): Footer column headers, status row labels, `§ The workbench` chip.
- **Mono Small / wb-mono-sm** (400, 12px, mono, color `ink-2`): Inline values, pin labels, kbd hints.

### Named Rules

**The Italic Half Rule.** When a headline has a clause to soften ("start tinkering.", "for the browser."), set the soft half in `<em>` — Bricolage's italic alternates in `ink-3`. Never italicize the loud half. The pairing is the brand: loud display + whispered italic.

**The No-Gradient-Text Rule.** Type is never gradient-clipped. Emphasis is achieved with weight, color (tomato, ink-3), or a sticker background — never with `background-clip: text`.

## 4. Elevation

Utilbench is **lifted, not layered**. Every clickable surface — button, tile, panel, sticker — wears a **hard, solid-color offset shadow**. No `rgba()`, no blur radius, no spread. Hover increases the offset and pulls the surface upward via a `translate(-2px, -2px)` transform, simulating a physical lift off the pegboard. Reduced-motion drops the transform but keeps the shadow.

### Shadow Vocabulary

- **pop-1** (`box-shadow: 2px 2px 0 #1f1a14`): Small chips, kbd, low-weight stickers.
- **pop-2** (`box-shadow: 3px 3px 0 #1f1a14`): Default sticker, small button, mobile sticker chips.
- **pop-3** (`box-shadow: 4px 4px 0 #1f1a14`): Tiles, panels, "No servers needed." hero tag.
- **pop-4** (`box-shadow: 5px 5px 0 #1f1a14`): Ghost button, lemon button — heavier resting weight.
- **pop-cta** (`box-shadow: 5px 5px 0 #ff6a4a`): Sticky header pill, primary CTA button at rest. The tomato halo signals "this is the voice."

### Named Rules

**The Hard-Offset Rule.** Every shadow is `<x> <y> 0 <solid-color>`. The blur slot is permanently zero. If you want softness, use a tile fill — not a soft shadow.

**The Lift-On-Hover Rule.** Interactive surfaces shift `-2px, -2px` and grow their shadow offset by ~2px on hover (e.g. `pop-cta` → `7px 7px 0 tomato`). Stationary surfaces do not animate.

## 5. Components

### Buttons (`.wb-btn`)
- **Shape:** rounded (14px), 2px ink border, hard-offset shadow.
- **Primary:** ink fill, paper text, `pop-cta` (tomato halo) at rest → `7px 7px 0 tomato` on hover, with -2/-2 translate.
- **Ghost (`.wb-btn--ghost`):** paper fill, ink text, `pop-4` ink shadow at rest → `7px 7px 0 ink` on hover.
- **Lemon (`.wb-btn--lemon`):** lemon fill, ink text, `pop-4` ink shadow — used for "secondary energy" CTAs where ghost would feel too quiet.
- **Small (`.wb-btn--sm`):** 7px 12px padding, 12.5px text, `pop-2` shadow → `4px 4px 0 ink` on hover.
- **Disabled:** `opacity: 0.5` and `pointer-events: none`. No greyed-out shadow.

### Chips (`.wb-chip`)
- **Shape:** pill (radius 999px), 2px ink border, no shadow.
- **Default:** paper fill, ink text, 7×14 padding, 13px font.
- **Hover:** background flips to lemon, transform `translateY(-1px)`, spring ease `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- **On (`.on`):** ink fill, paper text — the active filter state.

### Tiles (`.wb-tile`) — the signature component
- **Shape:** rounded-lg (18px), 2px ink border, `pop-3` shadow → `6px 6px 0 ink` on hover with -2/-2 translate.
- **Anatomy:** 48×48 icon plate (ink border, rad-md, paper fill) → H3 display heading → 13.5px body → "Open →" arrow pinned to bottom.
- **Flavors:** seven backgrounds — `wb-tile--pink`, `wb-tile--lilac`, `wb-tile--mint`, `wb-tile--sky`, `wb-tile--lemon`, `wb-tile--bg2`, `wb-tile--bg3`, plus an inverted `wb-tile--ink` (ink fill, paper text). The home grid cycles them so adjacent tiles never share a color.
- **Pin:** optional uppercase mono label in the top-right (`★ FEATURED`, `★`) — color `ink-3`.

### Panels (`.wb-panel`)
- **Shape:** rounded-lg (18px), 2px ink border, `pop-3` shadow, `overflow: hidden`.
- **Input panel:** paper fill — the data the user is editing.
- **Output panel (`.wb-panel--out`):** bg-2 fill — clearly secondary, the read-side of a TwoPane layout.
- **Ink panel (`.wb-panel--ink`):** ink fill, paper text — used for code preview and high-contrast inversions.

### Stickers (`.wb-sticker`) — the small floaters
- **Shape:** rounded (14px), 2px ink border, `pop-2` shadow.
- **Style:** 8×12 padding, 12.5px semibold, optional 8×8 round "dot" prefix.
- **Tilt:** rotated ±4–6° in hero contexts. Inline stickers (status row, breadcrumbs) stay flat.
- **Flavors:** five color modifiers (`--pink`, `--lilac`, `--mint`, `--sky`, `--lemon`); the green status dot uses Grass.

### Inputs (shadcn `Input`, `Textarea`)
- **Shape:** rounded-md (8px), 1px `--input` (ink) border, paper fill.
- **Padding:** 12×8, height 40px.
- **Focus:** 2px tomato `--ring` outline at 2px offset. No glow, no border-color shift.
- **Disabled:** `cursor-not-allowed`, opacity 0.5.

### Navigation (sticky pill header)
- **Container:** rounded-full, 2px ink border, ink fill, paper text, `pop-cta` shadow. Centered, max-width 1320px, sticky 14px from top.
- **Links:** rounded-full pill items, 13px medium. Active state = `rgba(255,255,255,.12)` background and opacity 1; inactive items sit at opacity 0.7.
- **Search trigger:** lemon-filled pill on ink, with a paper-tinted `kbd` chip showing `⌘K`. Mobile collapses to a 36px circular lemon search button + a sheet menu.

### KBD (`.wb-kbd`)
- **Style:** mono 11px, paper fill, 2px ink border, 6px radius, `1px 1px 0 ink` shadow, 2×6 padding. Used inline anywhere a keystroke is named.

### Signature: Hero Headline Lockup
The home hero is the system's loudest moment. Three lines, three voices:
1. Ink display, 800, 9vw clamp — "A workbench"
2. Same scale, tomato fill, with `<em>` for "browser" — "for the *browser*."
3. A rotated (-2°) lemon-fill sticker block (2px ink, 18px radius, 4px ink shadow), reading "No servers needed."

This is the only place all three voices stack. Don't reuse this lockup on inner pages.

## 6. Do's and Don'ts

### Do:
- **Do** use exactly one ink (`#1f1a14`) for every border, divider, and hard shadow. Warm brown-black; never `#000`.
- **Do** reserve tomato (`#ff6a4a`) for emphasis: the focus ring, the CTA halo (`pop-cta`), the second line of the hero, and `destructive` UI. ≤10% of any screen.
- **Do** keep tile fills locked to Pink / Lilac / Mint / Sky / Lemon / bg-2 / bg-3 / ink. Cycle them so adjacent tiles never share a color.
- **Do** render the hero headline as condensed display sans (Bricolage Grotesque 800) with italic `<em>` in `ink-3` for the soft half of a clause.
- **Do** rotate stickers ±2–6° in hero contexts, flat everywhere else.
- **Do** wrap interactive surfaces in 2px ink borders and hard-offset shadows. Hover lifts via `translate(-2px, -2px)` and grows the shadow offset by ~2px.
- **Do** use mono uppercase 11px with 0.12em tracking (`.wb-meta`) for footer column headings, status row labels, and pin chips on tiles.
- **Do** keep body copy in Inter, 65–75ch line length, color `ink-2` on tinted surfaces.

### Don't:
- **Don't** introduce a dark mode. The single light theme is intentional; the `.dark` class hook in `src/index.css` is deliberately inert.
- **Don't** use `#000` or `#fff` anywhere. Even inside SVGs, prefer `ink` and `paper`.
- **Don't** use blurred / `rgba()` shadows. Every shadow is `<x> <y> 0 <solid>`. The blur slot is permanently zero.
- **Don't** apply `border-left` or `border-right` greater than 1px as a colored stripe accent on cards, list items, or alerts. The system already speaks with full borders.
- **Don't** clip type to a gradient (`background-clip: text`). Emphasis is weight, color, or a sticker background.
- **Don't** use glassmorphism. No backdrop blur, no translucent cards, no frosted overlays.
- **Don't** render the SaaS hero-metric template (big number + small label + supporting stats + gradient accent). If you need to lead with numbers, use the feature-block layout (tomato display numeral, ink heading, ink-2 body).
- **Don't** repeat the home hero lockup on inner pages. The three-line ink/tomato/lemon stack is a one-time gesture per session.
- **Don't** tilt cards, panels, or buttons. Only stickers tilt, and only in the hero.
- **Don't** invent new tile flavors. Pink / Lilac / Mint / Sky / Lemon / bg-2 / bg-3 / ink is the complete set.
- **Don't** use Tomato or Grass as a tile fill. Both are reserved — Tomato for voice, Grass for status dots.
- **Don't** override the polka-dot body background per-page. The dots live on `<body>`; cards do not repeat the pattern.
- **Don't** stack a soft drop-shadow under a tile to "soften" it. The hard offset is the system. If a tile feels too loud, change its flavor to `bg-2` or `bg-3`.
