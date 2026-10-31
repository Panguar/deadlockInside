# Motion spec (emil-design-eng pass)

Principles: every motion has a purpose (feedback, state, spatial link, explanation). UI 120 to 300ms; scroll-scrubbed scene is physics, not duration. Only transform, opacity, clip-path, stroke-dashoffset. Exits faster than entries. Hover motion only under `@media (hover: hover) and (pointer: fine)`. No blur (banned by the brief). Reduced motion keeps opacity/colour, removes movement.

## Tokens (`apps/web/app/hallmark/tokens.css`)

```
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* arrivals, feedback */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* on-screen moves */
--ease-in: cubic-bezier(0.23, 1, 0.32, 1);         /* exits use ease-out too, just shorter */
--ease-needle: cubic-bezier(0.34, 1.25, 0.64, 1);  /* gauge needle only: a small physical overshoot */
--dur-press: 100ms; --dur-release: 160ms;
--dur-micro: 120ms; --dur-short: 200ms; --dur-long: 360ms;
```

## 3D reliquary (`components/home/Reliquary.tsx`)

1. Cursor: replace first-order damping with a second-order spring per axis (stiffness 70, damping ratio 0.85, so `c = 2 * 0.85 * sqrt(70)`): `v += (target - x) * k * dt; v -= v * c * dt; x += v * dt` with `dt` clamped to 1/30. Feels like a weighted brass object with momentum, no overshoot visible.
2. Idle yaw must never snap: instead of resetting `idleYaw = 0` on pointer move, let it decay: `idleYaw *= Math.exp(-dt * 2)` while the pointer is active, grow at 0.05 rad/s only after 2.5s idle.
3. Scroll progress `p` goes through the same spring (stiffness 120, damping ratio 1.0) before driving explode and camera, so a fast wheel flick lands with weight instead of jumping.
4. Explode per part: own progress `pi = clamp((p - i * 0.07) / 0.55)`, eased with `easeInOutCubic` (parts accelerate apart and settle). Distances: 0.9 to 1.3 units (smaller than now) so all five parts stay in frame at 1280x800.
5. Camera: azimuth 0 → 0.5 rad and radius base → base + 3.2 with `easeInOutCubic(p)`; look-at target lerps from object centre to centre + (0, 0.2, 0). Every part must stay inside the viewport at 1280x800 and 375x812 during the whole track (verify by projecting part bounds; if any leaves, increase radius).
6. Labels: each label's opacity and a 6px rise follow its own part progress: `smoothstep(0.35, 0.7, pi)`; written directly to `el.style.transform/opacity` (not CSS variables).
7. Hero parallax: object translateY `-scrollY * 0.0012` until the track starts (keep).
8. On first WebGL frame, crossfade the still image to the canvas over 300ms ease-out (no pop).

## Counters (`components/home/CountUp.tsx`, new)

`<CountUp value={number} format={(n) => string} />`: renders the final formatted value in SSR/no-JS; when it first enters the viewport (IntersectionObserver, threshold 0.6, once) it rolls from 0 to value over 400ms with ease-out (`1 - (1 - t)^3`) via requestAnimationFrame; tabular-nums so width stays stable; `aria-live` off, the accessible text is always the final value (render the animated number in an `aria-hidden` span and the final value in a visually-hidden span). Reduced motion: final value at once. Use it for: meta gauge win rate figures, meta caption sample size, workshop online figure, profile gauge figures.

## Gauges (`components/home/Gauge.tsx`)

- Arc and major ticks "engrave" on first view: SVG `pathLength="1"`, `stroke-dasharray: 1; stroke-dashoffset: 1 → 0`, 360ms `--ease-out`, ticks staggered 20ms by group.
- Needle sweeps from `min` angle to value 120ms after the arc starts, 400ms `--ease-needle` (the only overshoot on the page; waived as a physical instrument).
- Triggered by one shared IntersectionObserver class `is-in` on the figure; under `html.js` only; visible end state without JS and under reduced motion.

## Art deco frames draw in (lines, not fades)

- Hero cards `::before` frame: `clip-path: inset(0 100% 100% 0)` → `inset(0)` 380ms `--ease-out`, stagger `--i * 35ms` (max 8 steps). Remove the current scale/opacity frame animation.
- Workshop wells and the footer plaque get the same inner-frame clip-path draw once on enter.
- Section h2: one shared reveal, `clip-path: inset(0 0 100% 0)` → `inset(0)` plus `translateY(0.15em)` → 0, 360ms `--ease-out`, under `html.js` only, using a small `useReveal` hook or one global observer in `SmoothScroll.tsx` that adds `is-in` to `[data-reveal]`.

## Tactile controls

- `.btn-brass` and every button-like control (search submit, retry buttons, `.button` in globals, sign-in link): lever press. `:active { transform: translateY(2px) scale(0.985); box-shadow: inset 0 2px 0 var(--color-rule-strong); transition-duration: var(--dur-press); }`, release `transition: transform var(--dur-release) var(--ease-out), background-color var(--dur-micro) var(--ease-out)`.
- Hero card: `:active { transform: scale(0.985) }` 100ms; hover frame colour 150ms `--ease-out` (not linear), hover-gated.
- Reliquary label links: hover lifts the tag 2px (`translateY(-2px)`) 160ms; press `scale(0.97)`.
- Nav links: colour change only, 120ms; no motion (seen tens of times per day).
- Hero stats tag on cards: enter 200ms ease-out from `translateY(6px) scale(0.98)`, exit 120ms.

## Page transitions

In `app/layout.tsx` wrap `{children}` in React 19.3 `<ViewTransition default="page">` (`import { ViewTransition } from "react"`). In globals.css: `::view-transition-old(.page) { animation: page-out 140ms var(--ease-out) both; }` (opacity 1→0, translateY 0→-6px) and `::view-transition-new(.page) { animation: page-in 260ms var(--ease-out) 40ms both; }` (opacity 0→1, translateY 8px→0). Reduced motion: both `animation: none`.

## Smooth scroll

Lenis `lerp: 0.085`, `wheelMultiplier: 0.9`, `touchMultiplier: 1` (native touch scroll stays native: `syncTouch: false`). Anchor jumps use `lenis.scrollTo(target, { offset: -nav, duration: 1.1, easing: t => 1 - Math.pow(1 - t, 4) })`. Keyboard scrolling (space, arrows, PageDown) stays native.
