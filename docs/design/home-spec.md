# Deadlock Insight: home page and global style spec

Source of truth for every coder task. Read the section your task names, plus "Global rules".

## Global rules (every task)

- App: Next.js 16 App Router in `apps/web` (read `apps/web/AGENTS.md`; check `node_modules/next/dist/docs/` before using any Next API you are unsure of). React 19, TypeScript strict.
- All UI copy is Russian. Never use em or en dashes in copy (use a comma, colon or full stop). No emoji anywhere.
- Never invent a number. Every figure comes from the API or is absent.
- Colours and fonts ONLY through CSS custom properties from `apps/web/app/hallmark/tokens.css`. No hex, rgb, oklch or font-family literals outside that file (three.js reads colours from CSS variables at runtime with `getComputedStyle`).
- Banned: purple in any shade; any `linear-gradient`, `radial-gradient`, `conic-gradient` (backgrounds, text, borders, masks); `backdrop-filter`; `filter: blur`; glow shadows (`box-shadow` with zero offset and colour); coloured left borders on cards; `transition: all`; animating width, height, top, left, margin, padding.
- Labels, captions, table heads, tags, nav links: body face (Onest), one step smaller, sentence case, `letter-spacing: 0`, never `text-transform: uppercase`. Uppercase is allowed only on display heads (Advent Pro) and the wordmark, with `line-height >= 1.02`.
- Spacing only via `--space-*` tokens. Radii: `--radius-card` (2px) or 0.
- Every interactive element: `:hover`, `:focus-visible` (instant, `outline: 2px solid var(--color-focus); outline-offset: 2px`), `:active`, and `:disabled` where it can be disabled.
- Every transition/animation has a `@media (prefers-reduced-motion: reduce)` fallback. Content is visible without JavaScript (hide-for-reveal only under `html.js`).
- Grid tracks holding images: `minmax(0, 1fr)`. Display heads: `overflow-wrap: break-word; min-width: 0`.
- Figures that compare: `font-variant-numeric: tabular-nums`.
- Easing tokens: `--ease-out` arrivals, `--ease-in` exits, `--ease-in-out` toggles. Durations 150 to 400ms.

## Tokens (task T1 writes these into `apps/web/app/hallmark/tokens.css`, replacing the FILL ME lines)

```
--color-paper: oklch(15.9% 0.006 85);      /* charcoal #0E0D0B, page ground */
--color-paper-2: oklch(21.2% 0.012 67);    /* warm brown #1C1814, wells */
--color-paper-3: oklch(26% 0.016 70);      /* raised brown, cards */
--color-ink: oklch(91.8% 0.032 87);        /* cream paper #EDE3CC, main text */
--color-ink-2: oklch(82% 0.03 85);         /* secondary text on dark */
--color-muted: oklch(70% 0.025 80);        /* captions on charcoal/brown only */
--color-rule: oklch(34% 0.03 78);          /* hairlines */
--color-rule-strong: oklch(50% 0.07 82);   /* engraved brass lines */
--color-accent: oklch(73.1% 0.115 85);     /* brass #C9A24A, key actions */
--color-accent-hi: oklch(80% 0.11 87);     /* brass hover step */
--color-accent-ink: oklch(15.9% 0.006 85); /* text on brass */
--color-focus: oklch(82% 0.16 88);
--color-patina: oklch(58.7% 0.08 180);     /* #3E8C7E fills, positive */
--color-patina-text: oklch(72% 0.09 180);  /* patina as small text on dark */
--color-patina-ink: oklch(15.9% 0.006 85);
--color-oxblood: oklch(47.3% 0.161 24);    /* #A3262A fills, hot/down */
--color-oxblood-text: oklch(66% 0.17 26);  /* oxblood as small text on dark */
--color-oxblood-ink: oklch(91.8% 0.032 87);
--color-cream-card: oklch(91.8% 0.032 87); /* paper tags, tooltips, light cards */
--color-cream-card-ink: oklch(15.9% 0.006 85);
--color-team-amber: oklch(74% 0.15 68);    /* match data only */
--color-team-sapphire: oklch(68% 0.12 255);/* match data only */
--color-error: var(--color-oxblood-text); --color-success: var(--color-patina-text);
--font-display: "Advent Pro", "Arial Narrow", sans-serif;
--font-body: "Onest", ui-sans-serif, system-ui, sans-serif;
--font-outlier: "Poiret One", "Advent Pro", sans-serif;   /* wordmark only */
--radius-card: 2px; --shadow-card: none; --tracking-display: 0;
--text-hero: clamp(3.5rem, 7vw + 1rem, 7.5rem);
--nav-height: 64px;
```
Keep every other existing token line. Fonts load from Google Fonts in `layout.tsx`: `Advent Pro` (wdth 100, wght 500;700), `Onest` (wght 400;600), `Poiret One` (400), `display=swap`.

## Page structure (home, `/`)

1. **Hero** `#top`. Left column: `h1` "Deadlock Insight" in `--font-outlier` at `--text-hero` (wordmark-scale, uppercase allowed, line-height 1.02); one sentence lede (<=12 words): "Герои, матчи и игроки Deadlock по живым данным матчей."; the existing `<PlayerSearch />` as the primary action. Right/back: the 3D reliquary canvas (T2). Headline, lede and search visible at 1280x800 without scrolling. Hero height `100svh` minus nav, never `vh`.
2. **Разбор механизма** `#parts`: a scroll track (desktop 220svh, mobile 160svh) where the canvas stays sticky and the reliquary separates into five parts. Each part gets an HTML label link positioned over it: "Мета патча" → `#meta`, "Герои" → `#heroes`, "Билды" → `#workshop`, "Матчи и лидерборд" → `#workshop`, "Ваш профиль" → `#profile`. Labels are real `<a>` in an `<ol>` (also usable without JS as a plain list).
3. **Мета сейчас** `#meta`: h2 "Кто держит патч". Three brass gauge dials (SVG, semicircle 40% to 60% win rate scale, engraved ticks every 1%, labelled every 5%, needle at the hero's win rate, hero portrait + name + big win rate figure under it) for the top 3 heroes by win rate with matches >= 0.5% of all hero matches. Beside them a ledger table (top 10 by win rate): hero, win rate, pick rate, KDA, matches. Pick rate = hero.matches / (sum of all hero.matches / 12) (12 heroes per match, 6v6). Win rate >= 52% styled patina-text, <= 48% oxblood-text. A third block "Кто растёт и кто падает": empty state (text: "Сравнение патчей появится, когда источник начнёт отдавать историю по версиям."), no fake rows.
4. **Герои** `#heroes`: h2 "Все герои по винрейту" (+ count from data in a caption). Asymmetric grid of portrait cards in art deco frames (stepped corners drawn with thin `--color-rule-strong` lines via CSS borders/pseudo elements, no images for frames). Sizes cycle in a pattern so it is never a uniform grid: on desktop a 6-col grid, cards span 2x2 (top 2 heroes), then mix of 2x1 tall and 1x1. Hover/focus reveals win rate, KDA, pick rate, matches on a cream paper tag. Each card links to `/heroes/{hero_id}`.
5. **Мастерская** `#workshop`: h2 "Билды, живые матчи, лидерборд". Two empty vitrines side by side with an honest state each ("Источник билдов ещё не подключён" / "Живые матчи и лидерборд ждут источника"), one line each on what will appear, and the real Steam news list + online status from `/api/v1/community/online` and `/api/v1/community/news` (reuse logic from `components/CommunityPanel.tsx`).
6. **Ваш профиль** `#profile`: signed out (useAccount().account === null): h2 "Ваш профиль", one line, primary button "Войти через Steam" (`<a href="/api/v1/auth/login">`) and a secondary text link to `#top` search. Signed in: player stats from `/api/v1/players/{account_id}/stats` shown as two gauges (win rate vs global average win rate = sum(wins)/sum(matches) over hero stats; KDA vs global average KDA weighted by matches), top 3 heroes by matches, link "Открыть полный профиль" → `/players/{account_id}`.
7. **Footer**: engraved brass plaque (layout-level, every page): a plate with a double hairline frame and stepped corners, the wordmark in `--font-outlier`, nav links (Герои `/heroes`, Избранное `/account/favorites`), data source line "Данные: deadlock-api.com и Steam", and "Неофициальный фан-проект. Не связан с Valve." Flat fills only.

## 3D reliquary (task T2)

- File `apps/web/components/home/Reliquary.tsx` ("use client") + `apps/web/app/home/reliquary.css`. `three` 0.180 is installed. Import three dynamically inside `useEffect` (`await import("three")`, `three/examples/jsm/environments/RoomEnvironment.js`).
- Procedural art deco reliquary built from five named `THREE.Group`s, stacked vertically, total height about 4 units:
  1. `crown` (top): three stacked boxes stepping inward (ziggurat) + slim spire (cylinder tapering to 0.02). Brass.
  2. `rays`: sunburst fan, 18 thin boxes radiating from a torus ring (radius 1.1). Polished brass.
  3. `gears`: two interlocking gears from `THREE.Shape` with teeth + `ExtrudeGeometry` (depth 0.12, bevel small). Patina bronze.
  4. `dial`: disc (cylinder) with 60 tick boxes around the rim and one needle box. Face patina, rim brass.
  5. `plinth` (bottom): three stepped boxes widening downward. Dark bronze.
- Materials: `MeshPhysicalMaterial`. Brass: color from `--color-accent`, metalness 1, roughness 0.3, clearcoat 0.25. Patina: color `--color-patina`, metalness 0.3, roughness 0.78. Dark bronze: color `--color-paper-3`, metalness 1, roughness 0.45. Read CSS colours with `getComputedStyle(document.documentElement).getPropertyValue(...)` and `new THREE.Color().setStyle(value)` (convert oklch first by assigning it to a hidden element's `color` and reading the computed `rgb(...)`).
- Reflections: `PMREMGenerator` + `RoomEnvironment` as `scene.environment`. Lights: warm key `DirectionalLight` (cream, intensity 2.2) from upper left, cool weak fill, one rim light behind. `renderer.toneMapping = ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, `alpha: true`, transparent clear so the CSS paper shows. No fog, no post effects, no glow.
- Cursor: pointer position normalized to -1..1 over the window. Target `rotation.y = x * 0.35`, `rotation.x = y * 0.12`. Each frame `current += (target - current) * (1 - Math.exp(-dt * 6))` (frame-rate independent damping). Slow idle yaw of 0.05 rad/s only while the pointer is idle for >2s.
- Scroll: compute progress `p` 0..1 of the `#parts` track (`(scrollY - track.top) / (track.height - innerHeight)`, clamped). Explode: each group moves along its own direction (crown up-right, rays left, gears right, dial front-left, plinth down) by `dist * easeOutCubic(clamp((p - stagger_i) / 0.6))`, stagger_i = i * 0.06. Camera orbits from azimuth 0 to 0.55 rad and dolly back 1.2 units as p goes 0..1. Before the track (in the hero), translate the object up by `scrollY * 0.0015` units (soft parallax).
- Labels: the `<ol class="reliquary-labels">` of section links is rendered by the component from a prop `parts: {key, label, href}[]`. Each frame project each group's world centre (`Vector3.project(camera)`) and set the matching `<li>` `transform: translate3d(x px, y px, 0)`; their opacity follows `smoothstep(0.2, 0.4, p)`. Labels are small cream paper tags (`--color-cream-card` fill, `--color-cream-card-ink` text, Onest 14px) with a 1px brass leader line.
- Layout: the component renders `<div class="reliquary-stage">` that is `position: sticky; top: var(--nav-height); height: calc(100svh - var(--nav-height))`, placed by the page so it spans the hero and the `#parts` track.
- Performance: `setPixelRatio(Math.min(devicePixelRatio, 1.75))`; render loop runs only while the stage intersects the viewport and `document.visibilityState === "visible"`; resize via `ResizeObserver`; full dispose (geometries, materials, renderer, pmrem) on unmount.
- Static fallback: if `matchMedia("(prefers-reduced-motion: reduce)")` matches, or WebGL2 is unavailable, or `(navigator.hardwareConcurrency ?? 8) <= 4 && ((navigator as any).deviceMemory ?? 8) <= 4`, or `(navigator as any).connection?.saveData`, do not start three; show `<img src="/reliquary-still.png" alt="Латунный реликварий в стиле ар-деко">` (file will be supplied later; render the img in the markup by default and hide it only after the first WebGL frame is drawn). Labels then sit as a static list beside the image.

## Smooth scroll (task T4)

`apps/web/components/home/SmoothScroll.tsx` ("use client"): Lenis 1.3 (`import Lenis from "lenis"`, import `lenis/dist/lenis.css`), `{ lerp: 0.1, smoothWheel: true }`, skipped under reduced motion. Own RAF loop; intercept clicks on `a[href^="#"]` and call `lenis.scrollTo(target, { offset: -navHeight })`; destroy on unmount. Mounted only on the home page.

Loading states: skeleton rows in `--color-paper-2` blocks (no shimmer gradients; opacity pulse 1.2s allowed, stops under reduced motion). Error states: what failed and a retry button.
