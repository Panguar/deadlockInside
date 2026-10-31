# Patron scene spec (replaces the reliquary)

Idea: the hero object is the Patron's sanctum, the objective a team must reach in a Deadlock match. Scrolling plays a lane push: the defences fall in match order (guardians, walkers, shrines, the cage) until the Patron's core is exposed. Each fallen layer is a link to its section. All shapes are our own stylisation built from primitives; no Valve assets, no character likeness.

Global rules from `home-spec.md` apply (tokens only, no gradients/purple/glow in UI, reduced-motion still image, Russian copy without dashes). Light *inside* the 3D scene (emissive core, point light, fog) is allowed by the brief.

## Tokens to add (`app/hallmark/tokens.css`)

```
--color-stone: oklch(40% 0.018 70);       /* weathered limestone, dark */
--color-stone-hi: oklch(55% 0.02 75);     /* lit stone edges */
--color-core: oklch(86% 0.09 88);         /* the Patron's light: pale brass, never team colours */
--color-soul: oklch(88% 0.05 170);        /* soul orbs: pale patina light */
```

## Composition (world units, y up, ground at y = 0)

Circular stepped plinth: three discs (radius 4.2, 3.6, 3.0; height 0.12 each) in stone, top face engraved with two thin brass rings (TorusGeometry, tube 0.008) and 24 radial brass inlay lines.

Layer 0, `guardians` (outermost, radius 3.7): 4 stone sentinels at 45°, 135°, 225°, 315°. Each: square pedestal (0.35 wide, 0.5 tall), a tapered stone body (CylinderGeometry 4 sides, 0.22→0.32 radius, 0.9 tall, rotated 45° so it reads as a faceted pillar), a brass shield disc (cylinder r 0.22, h 0.04) on its outward face, and a small brass helm cap (cone, 4 sides).

Layer 1, `walkers` (radius 2.9): 3 walker colossi at 90°, 210°, 330°. Abstract armoured giants built from stacked boxes: two leg blocks (0.18×0.7×0.22) with brass knee plates, a torso (0.55×0.6×0.35) with a brass chest plate stepped in three ziggurat steps, two shoulder pauldrons (half spheres flattened, brass), a head block (0.2×0.22×0.2) with a narrow emissive visor slit (box 0.14×0.025, emissive `--color-core` intensity 1.2). Total height ~1.9. They face the centre.

Layer 2, `shrines` (radius 2.0): 2 obelisk shrines at 0° and 180°: stepped stone base, tall 4-sided tapered obelisk (1.4 tall), a brass lantern cage on top (4 thin bars + cap) holding a small emissive sphere (`--color-core`, intensity 1.6) plus a PointLight (warm, intensity 0.6, distance 2.5).

Layer 3, `cage` (centre): the sanctum. Four fluted stone columns (cylinders with 12 shallow flutes via 24-segment geometry and alternating radius) at radius 0.95, height 2.4, brass capitals and bases. Between them a brass cage: 16 vertical bars (r 0.018) on a circle r 0.7, three horizontal rings (torus) at y 1.0, 1.9, 2.8. Crown on top: art deco sunburst fan (12 brass blades in a half circle, facing camera) and a stepped brass ziggurat cap with a spire.

Layer 4, `core`: the Patron. An icosahedron (detail 1, r 0.42) of aged bronze with every face slightly inset (scale 0.94) over an inner emissive sphere (r 0.36, `--color-core`, emissiveIntensity 2.2) so light leaks through the gaps between faces. A PointLight inside (colour `--color-core`, intensity 3, distance 5, castShadow off). Floats at y 1.9 with a slow 6s bob of ±0.05 (the only ambient loop; stops under reduced motion and off-screen).

Souls: 36 instanced small spheres (r 0.03, emissive `--color-soul`) on 3 tilted orbits (radius 1.2–3.4) around the sanctum, angular speed 0.08–0.15 rad/s. On mobile 18.

## Materials

- Aged bronze/brass: `MeshPhysicalMaterial` metalness 1, roughness 0.38, clearcoat 0.2, colour `--color-accent`, plus a 256×256 `CanvasTexture` generated at runtime as a roughness map and a colour multiplier: low-frequency value noise (2 octaves) so the brass is uneven, darker in noise valleys. No image files.
- Patina accents: knee plates, shield rims and column bases get a second material, colour `--color-patina` × 0.6, metalness 0.5, roughness 0.7, same noise map.
- Stone: `MeshStandardMaterial` colour `--color-stone`, roughness 0.92, metalness 0, the noise map as a subtle colour multiplier.
- Fog: `scene.fog = new FogExp2(paperColor, 0.06)` so the outer ring sinks into the dark like a foggy street. Renderer clear colour stays transparent; fog colour equals the page paper so edges melt into the page.
- Lights: weak cool hemisphere (sky `--color-ink` 0.25, ground `--color-paper` 0.1), warm key directional from upper left (2.0), the core point light, the shrine lights. Environment: RoomEnvironment PMREM at environmentIntensity 0.45 (less studio, more night).

## Camera and framing

Perspective fov 32. Hero (p = 0): three quarter view from slightly above, camera at (0, 3.2, 9.5) looking at (0, 1.3, 0), whole sanctum and outer ring visible; on wide screens the scene's root is offset to the right half as now (x +1.6), on narrow screens centred, scaled 0.78, raised.

## Scroll: the lane push (`#parts` track, progress p via the existing spring)

Five stages, each eases over its own window with `easeInOutCubic`, windows overlap slightly: guardians [0.00, 0.30], walkers [0.15, 0.48], shrines [0.33, 0.66], cage [0.52, 0.84], core [0.70, 1.00].

- Guardians fall: each sentinel tips outward 70° around its base edge (rotation about a pivot at the outer bottom edge) and sinks 0.4 into the plinth; its brass shield disc drops and rolls a quarter turn.
- Walkers kneel: each colossus drops onto one knee (legs fold: lower 0.35, torso pitches forward 25°), visor light dims from 1.2 to 0.15. Physical, slow, heavy.
- Shrines go dark: lantern emissive and point light fall to 0, the obelisk slides 0.6 down into its base.
- Cage opens: vertical bars slide up 1.6 in a stagger around the circle (bar i delay i × 0.02 of the window), rings rise with them, the sunburst crown splits into two halves rotating ±40° outward.
- Core exposed: the core rises 0.35, its inset faces separate outward 0.06 (an opening flower), the core light intensity goes 3 → 4.5.
- Camera: dollies in from distance 9.5 to 5.8 and down from y 3.2 to 2.2 while orbiting 0 → 0.35 rad; look-at moves to the core. Containment check stays (every visible label anchor inside NDC ±0.92).

Labels (existing `<ol>` links, same component API): anchor each to its layer's representative point (guardians: the sentinel nearest the camera; walkers: the nearest head; shrines: nearest lantern; cage: crown; core: the core). Label opacity follows its own stage progress `smoothstep(0.25, 0.6, stage)`; text: Мета патча, Герои, Билды, Матчи и лидерборд, Ваш профиль (keys `guardians`, `walkers`, `shrines`, `cage`, `core`).

## Cursor (emil-design-eng: decorative, so springs, never direct mapping)

- Root yaw follows pointer x ±0.25 rad, pitch ±0.06, second-order spring (stiffness 60, damping ratio 0.9).
- The core turns toward the pointer independently and faster (stiffness 110) so it feels like the Patron watches you; its light rises +0.6 when the pointer is within 18% of the core's screen position (spring on intensity).
- Walker visors (before they kneel) turn their heads ±12° toward the pointer with a lagged spring (stiffness 40): the defenders track the intruder.
- Idle: after 2.5s without pointer movement the root yaws slowly (0.04 rad/s); decays smoothly when the pointer moves.

## Performance and fallback

Merge static stone geometry per layer (`BufferGeometryUtils.mergeGeometries`) to keep draw calls under ~60. Souls via `InstancedMesh`. Pixel ratio min(dpr, 1.75) desktop, 1.25 mobile. Render loop only while visible. Same still-image fallback; regenerate `/reliquary-still.png` from the new scene (file name kept).

## Stamp (Hallmark)

Update the globals.css stamp lines: `idea: "the Patron's sanctum from a Deadlock lane, its defences falling in match order as you scroll, each fallen layer a vitrine of match data"` and `signature: the lane push, guardians to Patron, each layer a section link`.
