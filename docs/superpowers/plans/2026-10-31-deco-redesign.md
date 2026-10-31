# Deco Redesign Specification

**Goal:** Replace the whole web visual design with a Deadlock-inspired art-deco
look (occult 1920s New York): bottle-green darkness, brass linework, parchment
text. Approved mockup on 2026-10-31. Behaviour, routes, API calls, text content
and test-visible class names stay unchanged.

## Design tokens (define on `:root` in `apps/web/app/globals.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#0d1310` | page background |
| `--canvas-deep` | `#090e0b` | inputs, wells, table header |
| `--surface` | `#141c17` | cards, panels |
| `--surface-raised` | `#1a241e` | hover, menus |
| `--surface-hover` | `#212d26` | row hover |
| `--line` | `#2b3a30` | default 1px borders |
| `--line-strong` | `#3d4f43` | emphasized borders |
| `--brass` | `#c9a35a` | accents, corner brackets, primary button bg |
| `--brass-bright` | `#e6c983` | hover, highlighted headings |
| `--brass-dim` | `#7d6838` | inactive ornaments |
| `--ink` | `#ece3cf` | main text |
| `--ink-soft` | `#aaa28e` | secondary text |
| `--muted` | `#7b7666` | captions, metadata |
| `--win` | `#79b08c` | wins, success |
| `--loss` | `#c4574a` | losses, errors |
| `--pending` | `#d0a24c` | pending/warning |
| `--team-amber` | `#d9a441` | team 0 (Amber Hand) |
| `--team-sapphire` | `#5d87c6` | team 1 (Sapphire Flame) |
| `--radius` | `2px` | almost-square corners everywhere |
| `--font-display` | `"Forum", "Times New Roman", serif` | headings, big numbers, wordmark |
| `--font-body` | `"Manrope", "Segoe UI", system-ui, sans-serif` | everything else |

Fonts load from Google Fonts in `layout.tsx` (`Forum` 400, `Manrope` 400/500/600/700,
`display=swap`), not at build time.

## Visual rules

- **Background:** `--canvas` plus a very subtle fixed radial vignette
  (lighter green glow top-center, darker edges). No images.
- **Headings (h1–h3, page titles, big stat numbers):** `--font-display`,
  weight 400, slight letter-spacing `.01em–.03em`. h1 on home ~`clamp(40px,6vw,72px)`.
  `em` inside headings = `--brass-bright`, not italic.
- **Eyebrows / labels / table headers / chips:** body font, 11px, uppercase,
  letter-spacing `.2em`, color `--brass`.
- **Body text:** 15px Manrope, line-height 1.6, `--ink`; secondary `--ink-soft`.
- **Numbers:** `font-variant-numeric: tabular-nums` in tables, KDA, durations.
- **Cards / panels / stat cards / section blocks:** `--surface`, 1px `--line`
  border, `--radius`, and art-deco **corner brackets**: `::before` top-left and
  `::after` bottom-right, 10px L-shapes in 1px `--brass`. Only on card-like
  containers, never on rows or buttons. Elements that already use ::before/::after
  for something else keep that and skip brackets.
- **Section headings:** title followed by a thin brass rule; a small rotated
  square (diamond `◆` shape) as an ornament before the eyebrow/heading.
- **Dots → diamonds:** `win-dot`, `loss-dot`, `unknown-dot`, `live-dot`,
  `team-indicator`, timeline points are 7px squares rotated 45°.
- **Buttons:** `button-primary` = `--brass` bg, `#1a140a` text, uppercase,
  letter-spacing `.1em`, 600 weight; hover `--brass-bright`.
  `button-secondary` = transparent, 1px `--brass` border, `--brass-bright` text;
  hover fills with `rgba(201,163,90,.1)`. `text-button`/`text-link` = brass
  text, underline on hover. Focus-visible: 2px `--brass-bright` outline, offset 2px.
- **Inputs / search:** `--canvas-deep` bg, 1px `--brass-dim` border, focus
  border `--brass` plus faint brass glow (`0 0 0 3px rgba(201,163,90,.15)`).
- **Tables / match rows:** no card brackets per row; rows separated by 1px
  `--line`; header row `--canvas-deep` with eyebrow style; hover `--surface-hover`.
  Win/loss text colors `--win` / `--loss`.
- **Teams:** `.team-0` accent `--team-amber`, `.team-1` accent `--team-sapphire`
  (top border 2px + heading color). Team names in the UI are unchanged.
- **Header:** sticky, `--canvas` at 92% opacity with backdrop blur, bottom
  1px `--line` plus a 1px brass line inset below it (double rule). Keep the
  logo image `.brand img`. Nav links `--ink-soft`, hover `--brass-bright`.
  Account menu panel = card style.
- **Footer:** top double rule (line + brass), centered row, wordmark in
  `--font-display` with letter-spacing `.25em`, small muted copy.
- **Home emblem** (replaces the orbital art, new markup below): a 260–320px
  circle with sunburst rays made with `repeating-conic-gradient` of faint brass,
  a 1px `--line` outer ring, an inner brass-ringed circle on `--canvas`, and
  a rotated square with the "DI" monogram in `--font-display` brass-bright.
  Slow 60s rotation of the rays only, disabled under `prefers-reduced-motion`.
  `art-tag` labels stay, styled as eyebrows.
- **Motion:** 150ms ease color/background transitions only.
- **Responsive:** keep every existing breakpoint behaviour; no horizontal page
  scroll at 375px (tests check `scrollWidth`). Tables keep their scroll wrappers.

## Home emblem markup (in `apps/web/app/page.tsx`)

```tsx
<div className="deco-emblem" aria-hidden="true">
  <div className="emblem-rays" />
  <div className="emblem-ring"><div className="emblem-core"><span>DI</span></div></div>
  <span className="art-tag tag-top">MATCH / 01</span>
  <span className="art-tag tag-bottom">STATS LIVE</span>
</div>
```

The old `orbital-art`, `orbit*`, `core-mark` classes are removed.

## Tasks (one commit each)

1. **CSS design system** — rewrite `apps/web/app/globals.css` from scratch
   with the tokens and rules above, covering every class used by components
   (including currently unstyled `favorites-page hero-detail-portrait
   hero-filters hero-portrait hero-table match-page profile-page retry-detail`)
   and the new emblem classes; drop orbit/core-mark rules.
2. **Shell and home markup** — `layout.tsx` (font links in `<head>`, footer
   wordmark `DEADLOCK ◆ INSIDE` with `◆` in a `span.footer-diamond`),
   `page.tsx` (emblem markup). No text, route or behaviour changes elsewhere.

## Verification

Typecheck, production build, Playwright e2e (if browsers are available), and
a visual pass at 1440px and 375px for home, profile, match, heroes, favorites.
