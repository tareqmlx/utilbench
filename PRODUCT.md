# Product

## Register

product

## Users

Working developers — frontend, backend, DevOps, and the occasional designer who needs to decode a JWT before a meeting. They reach for Utilbench when a fast, throwaway transform is between them and the next step of their work: pasting a CSV into JSON, decoding a token, comparing two YAML blobs, generating a QR for a staging URL, stripping EXIF from a screenshot before posting it.

The session is short and goal-shaped. Open tab, paste data, eyeball result, copy out, close tab. They do not want an account, a paywall, a "Sign up to keep your history", a cookie banner, or a network request to a third-party tool's backend. Many are sensitive about what they paste — production secrets, customer data, internal IDs — so "runs entirely in your browser" is not a marketing line, it is the entire product moat.

## Product Purpose

Utilbench is a workbench of small, fast, local-only developer utilities. Every tool runs entirely client-side via Web Workers and WASM; no data ever leaves the device after the bundle loads. The current set is 17 tools across **data** (JSON formatter, JWT decoder, Base64, CSV→JSON, JSON Schema, YAML→JSON), **text** (cron parser, diff checker, case converter, markdown preview, lorem ipsum), and **media** (QR generator, image resizer, SVG optimizer, favicon generator, Lottie previewer, image metadata remover).

Success looks like: a developer pastes input, gets the answer, copies it out, closes the tab. They do not remember the tool's chrome. The next time they need it, they type `Cmd+K`, fuzzy-search the tool name, and land directly on it. Over time, the toolbox grows by community pull requests — each new tool drops into `src/tools/<slug>/` and the registry auto-discovers it. The product wins by being the fastest, calmest, most private way to do these tiny tasks, and by feeling pleasant to use even though the user only spends 20 seconds in it.

## Brand Personality

**Friendly, tactile, opinionated.**

The voice is that of a maker who built a workbench in their garage and stuck pastel stickers on every drawer. Copy uses phrases like *"Pick a sticker and get to work."*, *"Make something. Locally."*, *"a friendly little toolbox"*, *"no servers, no tracking, just tools that work."* It is warm without being twee, opinionated without being lecturing. The interface is allowed to be loud in one big gesture per page (the hero, a rotated lemon sticker, a tomato-fill em) and then calm everywhere else. The working surface — input/output panels, forms, results — is hushed; the marketing chrome — home tiles, footer headline, sticky pill nav — is animated by hard color and weight.

The brand explicitly resists every prevailing developer-tool aesthetic of the current decade. It is not a terminal. It is not a dashboard. It is not a SaaS landing page. It is a paper-warm pegboard with hard-offset pop-shadows and a single tomato accent that does all the shouting.

## Anti-references

The existing visual system in `src/index.css` and `DESIGN.md` already takes hard positions; this section commits them in writing so future agents do not drift back toward the defaults they were trained on.

- **No slate-grey terminal / SaaS chrome.** No Linear-grey, no Vercel-mesh-gradient, no Stripe-dashboard pastels-on-white. The developer-tool reflex of "tasteful neutral surface + one purple/indigo accent + soft drop-shadow" is forbidden. Utilbench's neutral is warm cream paper (`#fff7ec`), not slate, not zinc, not Tailwind grey.
- **No dark mode.** The `.dark` class hook in `src/index.css` is deliberately inert; the system does not respond to `prefers-color-scheme`. The single light theme is intentional and is part of the product's character. Do not add dark mode "for completeness".
- **No dark-mode-with-neon-accents.** Cyberpunk, observability, crypto. Neon green on `#0a0a0a` is the most overused developer-tool palette in the world.
- **No glassmorphism.** No backdrop-blur, no translucent cards, no frosted overlays, no iOS-style glass nav. Hard borders and hard offset shadows are the system. Soft visuals dilute the pegboard metaphor instantly.
- **No SaaS-cream landing minimalism.** Tailwind-default `bg-stone-50` + Inter + soft `shadow-sm` + a centered hero with a gradient mesh is exactly what every AI-startup site looks like in 2026. Utilbench rejects this entire family.
- **No gradient text / no `background-clip: text`.** Emphasis is achieved with color (tomato, ink-3), weight (Bricolage 800), or a sticker background. Never with a hue-shift on the type itself.
- **No hero-metric template.** "10×", "99.9%", "Trusted by 1,000+ teams" with a tiny supporting label and a gradient bar underneath. Forbidden. If numbers lead the page, use the feature-block pattern (tomato display numeral over ink heading over ink-2 body).
- **No side-stripe colored borders** greater than 1px on cards, list items, or alerts. The system already speaks with 2px full ink borders; left-stripe-as-accent is the lazy alert pattern and is banned.
- **No identical card grids.** Every tile in the home grid alternates among Pink / Lilac / Mint / Sky / Lemon / bg-2 / bg-3 / ink fills. Same-color rows of cards are visually monotonous and break the pegboard feel.
- **No corporate-clinical sterility.** Utilbench is not a Salesforce admin, not a Notion sidebar, not a clinical EMR. The italic `<em>` in `ink-3`, the rotated `-2°` lemon sticker, the tomato em — these "smiles" are load-bearing personality. Removing them in the name of "professionalism" is a regression.

## Design Principles

1. **The working surface is calm. The chrome is loud.** Tool panels (input/output, results) keep one tone and one fill. The home tiles, the sticky pill header, and the footer headline are where the system's color and weight live. Polish work on a tool route should make the panel quieter, not louder; polish work on the home page can lean harder into the sticker character.
2. **Practice what you preach.** "Local from byte one" is not a marketing line — it is a constraint that shapes every architectural choice (Web Worker pool, WASM loader, no analytics, no cookies, no third-party fonts loaded from CDN). The privacy promise on the home page must remain verifiable from a network-tab inspection.
3. **One ink, one voice, one moment of loud per page.** A single ink (`#1f1a14`), a single emphasis color (tomato `#ff6a4a`), and a single big gesture per page. New features inherit this discipline by default. If a polish PR introduces a second emphasis color or a second loud gesture, one of them is wrong.
4. **Keyboard-first.** `Cmd+K` opens fuzzy search. Tools that benefit from shortcuts register them via `useKeyboardShortcut`. Every interactive surface has a visible focus state with the tomato `--ring`. Adding mouse-only affordances without a keyboard equivalent is a regression.
5. **Tools as plugins.** Every tool is a self-contained directory under `src/tools/<slug>/` with `tool.ts` + `Route.tsx`, auto-discovered by `import.meta.glob`. Page chrome (breadcrumbs, hero, feature cards, sibling tools) lives in `src/pages/ToolPage.tsx` and is not duplicated per tool. Adding a tool should never require touching the router, the search index, or the sitemap.
6. **Polish, not redesign.** The visual system is already committed (see `DESIGN.md`). Future work iterates within that system — adjusting copy, tightening spacing, adding tools, improving a11y, fixing edge cases. It does not re-evaluate the color strategy, font stack, or shadow vocabulary unless the user explicitly opens that conversation.

## Accessibility & Inclusion

**Target: WCAG 2.2 AA.**

- **Contrast.** Body copy on cream (`ink` on `bg`) and on ink (`paper` on `ink`) clear AA. Avoid the muted `ink-3` (`#786b5b`) for body text on any tile fill darker than `bg-2`; it dips under 4.5:1 on Lemon and Lilac. Limit `ink-3` to captions and metadata labels (per `.wb-meta` usage).
- **Focus.** Every interactive surface gets a visible focus indicator. The 2px tomato `--ring` at 2px offset is the system standard; `focus-visible:` (not `focus:`) is the default so mouse-clicks do not flash rings. The skip link in `Layout.tsx` lands at `#main-content`.
- **Motion.** The `@media (prefers-reduced-motion: reduce)` block in `src/index.css` is the source of truth. Tile and button hover transforms are stripped; only the shadow transition remains. Page transitions, scroll reveals, and item-enter animations are disabled. Any new animation must include a reduced-motion fallback in the same stylesheet.
- **Keyboard.** Every tool must be operable without a mouse. The shadcn Radix primitives provide this for dialog, popover, dropdown, select, switch, and tabs. Custom interactive surfaces (tiles as `<Link>`, chips as `<button>`) use real anchors and buttons — never `<div onClick>`.
- **Semantics.** One `<main id="main-content">` per page (in `Layout.tsx`), one `<h1>` per route (in `ToolPage.tsx` and `Home.tsx`), labeled landmarks (`<nav aria-label>`, `<section>`). Tool `Route.tsx` files render `<section>` from `ToolShell`, not a second `<main>`.
- **Color blindness.** Status is never carried by color alone. The Grass dot on the "private by default" sticker is paired with text. Tomato-as-emphasis always co-occurs with weight or position cues (second hero line, focus ring, feature numeral).
- **Touch targets.** Buttons, chips, and tile arrows meet the 44×44 minimum on mobile via padding. The `.wb-btn--sm` size is desktop-only; do not promote it into a primary mobile CTA.

Known gaps to fix during polish, not redesign:
- Dialog/popover focus trap on certain Radix surfaces flickers under specific reduced-motion settings — confirm before next release.
- `wb-tile--ink` (ink-fill tile) has a paper-on-ink contrast that clears AA but the muted `arrow` text (also paper) on hover transform may briefly fall under the 4.5:1 threshold on low-end displays. Audit at next polish pass.
