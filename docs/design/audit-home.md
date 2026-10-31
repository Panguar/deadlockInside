# Impeccable audit: home page (2026-10-31)

Target: `/` at 1280x800, 1440x900 and 375x812 (emulated viewport, Chromium). Detectors: `impeccable detect` (URL + sources), Hallmark `sloplint` (static tier; render tier did not run, no puppeteer). Manual: contrast sweep over every visible text node, touch-target sweep, brief bans grep.

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Contrast passes everywhere (0 pairs under AA); touch targets under 24px tall on mobile |
| 2 | Performance | 3 | 3D paused off-screen and gated; static fallback image `/reliquary-still.png` is missing (404) |
| 3 | Theming | 3 | New code is fully tokenised; legacy `globals.css` still has ~60 raw spacing values |
| 4 | Responsive | 1 | Mobile hero is broken: copy squeezed into a sliver, search input 4px wide |
| 5 | Implementation integrity | 3 | Coherent art deco system; a few copy and state slips |
| **Total** | | **13/20** | **Acceptable** |

## Implementation integrity verdict

Pass. The page reads as one product-specific system: brass and patina tokens throughout, gauges as data instruments, the reliquary disassembly as the table of contents. Brief bans grep (purple, gradients, backdrop-filter, blur, glow, text-shadow, thick left borders) returns zero matches in `app/` and `components/`. No emoji, no blobs, no cyberpunk motifs, no "hero + three identical cards".

## Findings

- **[P0] Mobile hero copy collapses.** `app/home/hero.css`: `.home-hero-copy { grid-column: 1 / span 6 }` (added later in the file) overrides the `<=60rem` full-width rule, so at 375px the copy is ~120px wide, the wordmark breaks mid-word ("DEA / DLO / CK") and the search input renders 4px wide. Text also sits on the 3D object. Fix: full-width copy under 60rem on a solid paper band below the object; wordmark size step for phones. Command: adapt.
- **[P1] Static render missing.** Reduced motion, no WebGL and weak devices show a broken `<img src="/reliquary-still.png">`. Fix: capture a still of the assembled reliquary into `public/reliquary-still.png`. Command: optimize.
- **[P1] Touch targets under 24px** at 375px: reliquary label links (22px), nav "Герои" (20px), meta table hero links (21px). WCAG 2.5.8. Fix: min-height 44px hit area (padding, or `::after` hit expansion) without changing the visual size. Command: adapt.
- **[P1] Hover-only stats tag hidden at rest** (`app/home/heroes.css:209`, sloplint 62, detector "content-hidden-at-rest"). On hover-capable devices the tag is invisible until hover; acceptable as progressive disclosure, but the hidden state must be scoped to `@media (hover: hover) and (pointer: fine)` and `html.js`, and its focus-visible transition removed (sloplint 15). Command: polish.
- **[P2] Reliquary labels clip at the right edge on mobile** ("Билды", "Ваш профиль" cut). Labels need clamping inside the viewport. Command: adapt.
- **[P2] Caption copy bug:** "По 4 019 718 матчей матчам источника" (`MetaSection.tsx:40`, `formatMatches` already appends "матчей"). Command: clarify.
- **[P2] Mobile meta: three gauges stack** into ~900px before the table. Make them a 3-up compact row (or a horizontal snap row) under 40rem. Command: adapt.
- **[P2] Section heading case is inconsistent:** "Кто держит патч" renders in sentence case while the other h2s are uppercase. Pick uppercase for all display h2s. Command: typeset.
- **[P2] Legacy globals.css hygiene** (other pages): ~60 raw spacing values (sloplint 24a), `.button:disabled` by opacity alone and filter inputs focused via border (39a), dark panels without explicit text colour (41 WARN). Command: polish.
- **[P3] Needle overshoot easing** flagged by the detector (`--ease-needle`); it is a deliberate, waived exception for the gauge needle only. No action.

## False positives

- sloplint 54 "eyebrow" on `MetaSection.tsx:94`: it is a real `<thead>` with `<th scope="col">`. Dismissed.
- Detector "51% of text hidden": the reliquary labels (intentionally hidden until the disassembly track) and the 44 hover tags. Real part is covered by the P1 above.

## Positive findings

- Contrast: every visible text pair meets WCAG AA at both sizes tested.
- Reduced motion, `html.js` scoping, and IntersectionObserver gating are in place; three.js disposes cleanly and pauses off-screen.
- Data honesty: every figure comes from the API; empty vitrines say what is missing instead of inventing rows.
