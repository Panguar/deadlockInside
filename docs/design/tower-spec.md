# Stat tower scene spec (replaces the Patron scene)

Idea: an original art deco skyscraper standing in the fog of a 1930s night city. Its floors are the site's sections; the windows of one floor are lit by real hero data. Scrolling rides an exterior elevator from the crown down to the street. No characters, no game maps, no copies of real buildings (the silhouette is our own: no Chrysler arches, no Empire State mast).

Global rules from `home-spec.md` apply: tokens only, no gradients/purple/glow in the UI, Russian copy without dashes, still-image fallback. Light inside 3D (emissive windows, lamps, fog) is allowed.

## Reuse from Patron.tsx

Build `apps/web/components/home/Tower.tsx` from `Patron.tsx`'s infrastructure, then delete `Patron.tsx` and `apps/web/lib/scene-models.ts`: sticky stage markup and the `reliquary-*` CSS classes, dynamic three import, `readToken` colours, still fallback with software-renderer detection and probe release, pointer and scroll springs, fixed label anchors with clamping, hover/focus freeze, `cursorInfluence`, idle-yaw decay, containment loop, exit fade when the sticky layer is released, IntersectionObserver/visibility gating, try/catch teardown, full disposal. Remove `--color-amber-core` from tokens.css.

## Tokens

Keep `--color-stone`, `--color-stone-hi`, `--color-core`, `--color-soul`. Add `--color-window: oklch(80% 0.09 82)` (warm lit window) and `--color-window-off: oklch(24% 0.012 70)` (dark glass).

## The tower (world units, y up, street at y = 0, total height ~14)

- **Street block:** a dark stone ground plate 9 × 9, wet look (MeshPhysicalMaterial roughness 0.25, clearcoat 0.6, colour `--color-paper-3`), a kerb ring, 4 cast iron street lamps (thin column, brass lantern with emissive `--color-window` 1.4 and a PointLight 0.8, distance 4) at the tower's front corners.
- **Base (floors 0 to 2, y 0 to 2.4):** wide stone podium 3.2 × 3.2, a brass entrance portal on the front face (stepped arch made of 3 nested rectangular frames), vertical stone ribs every 0.4.
- **Shaft (y 2.4 to 10.4):** 2.4 × 2.4 square tower with chamfered corners (8-sided prism), continuous vertical piers (thin boxes, `--color-stone-hi`) between window columns, horizontal spandrel bands in brass every floor (floor height 0.4 → 20 floors).
- **Setbacks (y 10.4 to 12.6):** three stepped tiers shrinking 2.0 → 1.6 → 1.2, each topped with a brass cornice and four corner pinnacles (small stepped prisms).
- **Crown (y 12.6 to 14.2):** an original stepped brass crown: four layered sunburst fans (one per face, 9 blades each, `side: DoubleSide`) rising to a slim spire with a ring of 8 small lamps (emissive `--color-core`).
- **Exterior elevator:** a brass cage car (0.5 × 0.6 × 0.5, open bars) on two rails running down the front-right corner of the shaft; it moves with the camera (it is the visual reason the camera travels).

## Windows: decor vs data

- Every face has a grid of windows (6 per face per floor). Decorative floors: about 30% of windows lit at fixed seeded positions (deterministic seed, no flicker, no animation); colour `--color-window` at intensity 0.6–1.0.
- **Hero floor block (floors 12 to 15 on the front face, 4 floors × 11 windows = 44 windows):** one window per hero, sorted by win rate (top-left = highest). Emissive intensity maps win rate: 44% → 0.15, 50% → 0.7, 56%+ → 1.6 (linear between, clamped). Data from `useHeroStats()`; while loading or on error these 44 windows are dark (`--color-window-off`), never fake-lit. A caption is not in 3D; the "Герои" label explains via its section.
- Hovering a hero window on desktop (raycast against the 44 instance ids, pointer fine only) shows a cream paper tag (existing label style) with the hero name and win rate; keyboard users get the same data in the hero section below, so the tag is `aria-hidden`.
- Use `InstancedMesh` for all windows (one for lit, one for dark, per-instance colour) and merged geometry for stone per material.

## Floors as sections (stations)

Five stations from top to bottom, each a label anchored to a fixed point on the front face:
1. `meta` "Мета патча": the crown (p window 0.00–0.22). The crown lamps light one by one as the camera passes.
2. `heroes` "Герои": the hero window block (0.18–0.45).
3. `builds` "Билды": floors 7–8 wrapped in brass scaffolding with a hanging sign plate (no text in 3D) — an honest "under construction" floor (0.40–0.62).
4. `matches` "Матчи и лидерборд": floor 4 with a large clock dial on the front face (brass ring + 12 ticks + two hands showing the real local time, updated once a minute) (0.58–0.80).
5. `profile` "Ваш профиль": the entrance portal at street level; the portal's inner panel glows `--color-window` 1.2 (0.76–1.00).

PARTS in page.tsx: meta #meta, heroes #heroes, builds #workshop, matches #workshop, profile #profile.

## Camera

- Hero (p = 0): three-quarter view from the street corner looking up at the whole tower, fov 34, camera at (5.5, 2.2, 9.5), look-at (0, 7, 0); on wide screens the tower's root sits on the right (x +2.4), on narrow screens centred and scaled 0.8. The full tower and the street must be in frame.
- Track: the camera rides the elevator corner from the crown down: at p = 0.05 it is level with the crown (y 13, distance 6.5 from the tower axis, azimuth 35°), then descends to y 1.4 at p = 1 while the azimuth swings 35° → 10° and distance 6.5 → 7.5; look-at = the current station's anchor height. The elevator car stays 0.8 below the camera on its rail.
- Containment applies to the current station's anchor and its label only (the tower is taller than the frame by design).

## Motion (emil-design-eng)

- Scroll progress through the existing spring (stiffness 160, damping 1) → camera height; a second, softer spring (stiffness 60) on the elevator car so it lags and settles with a slight sway at each station (max 0.04 units, no bounce past that).
- Stations ease: between stations the camera moves on easeInOutCubic segments so it slows at each floor like an elevator arriving.
- Pointer: before the track, the root yaws ±0.18 rad with the pointer (spring stiffness 60, damping 0.9); during the track cursorInfluence fades it to 0 so labels stay still.
- Crown lamps: each lamp's emissive goes 0 → 1.2 over 200ms when the camera passes its height (state, not loop).
- Window hover tag: appears 120ms ease-out, no delay on subsequent windows.
- Fog: `FogExp2(paper, 0.035)`; the only ambient motion is a 40s slow drift of 3 large flat fog sprites near the street (stops under reduced motion and off-screen).

## Fallback and still

Same rules as before (reduced motion, no WebGL2, software renderer, weak device, save-data → still image). Still alt: "Ар-деко небоскрёб статистики в ночном тумане". The still image file will be recaptured after the build.

## Stamp (Hallmark)

Update the globals.css stamp: `idea: "an art deco stat tower in the night fog, its floors are the site's sections and the hero floor is lit by real win rates"`, `signature: the elevator ride down the tower, hero windows lit by data`.
