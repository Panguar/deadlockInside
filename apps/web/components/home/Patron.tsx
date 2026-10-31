"use client";

import { useEffect, useRef } from "react";
import type {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Vector3,
  WebGLRenderer,
} from "three";
import "@/app/home/reliquary.css";

type ThreeLib = typeof import("three");
type MergeFn = (geometries: BufferGeometry[]) => BufferGeometry | null;

type PartKey = "guardians" | "walkers" | "shrines" | "cage" | "core";
type Part = { key: PartKey; label: string; href: string };

type Palette = {
  brass: Color;
  patina: Color;
  stone: Color;
  stoneHi: Color;
  core: Color;
  soul: Color;
  ink: Color;
  paper: Color;
};

type Ctx = {
  THREE: ThreeLib;
  merge: MergeFn;
  core: Color;
  brass: MeshPhysicalMaterial;
  patina: MeshPhysicalMaterial;
  stone: MeshStandardMaterial;
  stoneHi: MeshStandardMaterial;
  fan: MeshPhysicalMaterial;
};

type Spring = { x: number; v: number };

type ExtendedNavigator = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

type Sentinel = { root: Group; tip: Group; shield: Group; anchor: Object3D };
type Walker = { root: Group; legs: Group; torso: Group; head: Group; visor: MeshStandardMaterial; yaw: Spring };
type Shrine = { root: Group; obelisk: Group; lantern: MeshStandardMaterial; light: PointLight; sphere: Mesh };
type Cage = { bars: InstancedMesh; rings: Mesh; fanLeft: Group; fanRight: Group; anchor: Object3D };
type Core = { root: Group; faces: Mesh; rest: Float32Array; dir: Float32Array; light: PointLight };
type Soul = { radius: number; speed: number; theta: number; euler: { x: number; y: number; z: number } };

const KEYS: readonly PartKey[] = ["guardians", "walkers", "shrines", "cage", "core"];
// Lane push windows on the scroll track (progress 0..1).
const LAYER_WINDOW: Record<PartKey, [number, number]> = {
  guardians: [0, 0.3],
  walkers: [0.15, 0.48],
  shrines: [0.33, 0.66],
  cage: [0.52, 0.84],
  core: [0.7, 1],
};

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const SENTINEL_TILT = 70 * DEG;
const SENTINEL_SINK = 0.4;
const SENTINEL_DROP = 0.6;
const WALKER_PITCH = 25 * DEG;
const WALKER_HEAD_TURN = 12 * DEG;
const WALKER_VISOR_LIT = 2.0;
const WALKER_VISOR_DARK = 0.15;
const SHRINE_DROP = 0.6;
const SHRINE_LANTERN = 1.6;
const SHRINE_LIGHT = 0.6;
const CAGE_RISE = 1.6;
const CAGE_STAGGER = 0.02;
const FAN_OPEN = 40 * DEG;
const CORE_Y = 1.9;
const CORE_RISE = 0.35;
const CORE_OPEN = 0.06;
const CORE_INSET = 0.9;
const CORE_LIGHT_BASE = 3.6;
const SOUL_MIN_Y = 0.3;
const CORE_LIGHT_OPEN = 4.5;
const CORE_BOB = 0.05;
const CORE_BOB_PERIOD = 6;
const GLOW_LIFT = 0.6;
const GLOW_RANGE = 0.18;
const SOUL_ORBITS: [number, number, number][] = [
  [0.35, 0, 0],
  [1.05, 1.05, 0],
  [0.2, 2.1, 0.6],
];
const CAM_DIST_START = 9.5;
const CAM_DIST_WIDE = 11;
const CAM_DIST_END = 6.6;
const CAM_Y_START = 3.2;
const CAM_Y_END = 5.4;
const CAM_LOOK_START = 1.3;
const CAM_LOOK_END = CORE_Y + CORE_RISE;
const WIDE_SCALE = 0.82;
const WIDE_X = 2.3;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
const CAM_ORBIT = 0.35;
const CONTAIN_LIMIT = 0.92;
const CONTAIN_STEP = 0.3;
const CONTAIN_MAX_STEPS = 8;
const CURSOR_STIFFNESS = 60;
const CURSOR_DAMPING = 0.9;
const POINTER_YAW = 0.25;
const POINTER_PITCH = 0.06;
const CORE_TURN_STIFFNESS = 110;
const CORE_TURN_DAMPING = 0.9;
const HEAD_STIFFNESS = 40;
const HEAD_DAMPING = 0.9;
const GLOW_STIFFNESS = 60;
const GLOW_DAMPING = 0.9;
const IDLE_DELAY_MS = 2500;
const IDLE_YAW_SPEED = 0.04;
const IDLE_YAW_DECAY = 2;
const SCROLL_STIFFNESS = 160;
const SCROLL_DAMPING = 1;
const MAX_DT = 1 / 30;
const LABEL_RISE_PX = 6;
const LABEL_EDGE_PX = 8;
const MOBILE_BREAKPOINT = 960;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Linear progress of a layer's window, 0..1.
function linearAt(p: number, key: PartKey): number {
  const [a, b] = LAYER_WINDOW[key];
  return clamp((p - a) / (b - a), 0, 1);
}

// Eased progress of a layer's window, 0..1.
function stageAt(p: number, key: PartKey): number {
  return easeInOutCubic(linearAt(p, key));
}

// Second-order spring step: weighted, with momentum, no visible overshoot at the damping used here.
function stepSpring(s: Spring, target: number, stiffness: number, damping: number, dt: number): void {
  const c = 2 * damping * Math.sqrt(stiffness);
  s.v += (target - s.x) * stiffness * dt;
  s.v -= s.v * c * dt;
  s.x += s.v * dt;
}

function shouldUseStill(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  const nav = navigator as ExtendedNavigator;
  if (nav.connection?.saveData) return true;
  if ((navigator.hardwareConcurrency ?? 8) <= 4 && (nav.deviceMemory ?? 8) <= 4) return true;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("webgl2");
  if (ctx === null) return true;
  const debugInfo = ctx.getExtension("WEBGL_debug_renderer_info");
  const renderer = debugInfo ? String(ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : "";
  ctx.getExtension("WEBGL_lose_context")?.loseContext();
  return SOFTWARE_RENDERER.test(renderer);
}

function scrollProgress(): number {
  const track = document.getElementById("parts");
  if (!track) return 0;
  const trackTop = track.getBoundingClientRect().top + window.scrollY;
  const span = track.offsetHeight - window.innerHeight;
  if (span <= 0) return 0;
  return clamp((window.scrollY - trackTop) / span, 0, 1);
}

function readToken(THREE: ThreeLib, name: string): Color {
  const color = new THREE.Color();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx || value === "") return color;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return color;
}

function disposeTree(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else {
      material?.dispose();
    }
  });
}

// Value noise: a periodic lattice with smooth bilinear interpolation.
function noiseField(cells: number, seed: number): (u: number, v: number) => number {
  const lattice: number[] = [];
  let s = seed;
  for (let i = 0; i < cells * cells; i++) {
    s = (s * 16807) % 2147483647;
    lattice.push((s % 10000) / 10000);
  }
  const cell = (i: number, j: number): number =>
    lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)] ?? 0;
  return (u: number, v: number): number => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(0, 1, x - x0);
    const fy = smoothstep(0, 1, y - y0);
    const top = cell(x0, y0) + (cell(x0 + 1, y0) - cell(x0, y0)) * fx;
    const bottom = cell(x0, y0 + 1) + (cell(x0 + 1, y0 + 1) - cell(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

// Runtime 256px texture: 2 octaves of value noise, used as colour multiplier and roughness map.
function makeNoise(THREE: ThreeLib): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext("2d");
  if (ctx2d) {
    const coarse = noiseField(4, 7);
    const fine = noiseField(8, 4242);
    const image = ctx2d.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 0.6 * coarse(x / size, y / size) + 0.4 * fine(x / size, y / size);
        const shade = Math.round((0.72 + 0.28 * v) * 255);
        const idx = (y * size + x) * 4;
        image.data[idx] = shade;
        image.data[idx + 1] = shade;
        image.data[idx + 2] = shade;
        image.data[idx + 3] = 255;
      }
    }
    ctx2d.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function at(
  THREE: ThreeLib,
  geometry: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  return geometry.applyMatrix4(matrix);
}

// Static parts sharing one material are merged into a single draw call.
function bake(ctx: Ctx, geometries: BufferGeometry[], material: Material): Mesh {
  const geometry = ctx.merge(geometries) ?? new ctx.THREE.BufferGeometry();
  return new ctx.THREE.Mesh(geometry, material);
}

// Cylinder with 12 shallow flutes: 24 segments, alternating radius.
function fluted(THREE: ThreeLib, radius: number, height: number): BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 24, 1);
  const pos = geometry.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const j = Math.round((((Math.atan2(z, x) + TAU) % TAU) / TAU) * 24) % 24;
    const factor = j % 2 === 0 ? 1 : 0.9;
    pos.setXYZ(i, x * factor, pos.getY(i), z * factor);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildPlinth(ctx: Ctx, root: Group): void {
  const { THREE } = ctx;
  const stone: BufferGeometry[] = [
    at(THREE, new THREE.CylinderGeometry(3.6, 3.6, 0.12, 72), 0, 0.18, 0),
    at(THREE, new THREE.CylinderGeometry(3.0, 3.0, 0.12, 72), 0, 0.3, 0),
  ];
  const stoneHi: BufferGeometry[] = [at(THREE, new THREE.CylinderGeometry(4.2, 4.2, 0.12, 72), 0, 0.06, 0)];
  const top = 0.365;
  const brass: BufferGeometry[] = [];
  for (const r of [1.6, 2.6]) {
    brass.push(at(THREE, new THREE.TorusGeometry(r, 0.008, 6, 128), 0, top, 0, Math.PI / 2));
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    brass.push(
      at(THREE, new THREE.BoxGeometry(0.012, 0.01, 2.5), Math.cos(a) * 1.65, top, Math.sin(a) * 1.65, 0, Math.PI / 2 - a, 0),
    );
  }
  root.add(bake(ctx, stoneHi, ctx.stoneHi), bake(ctx, stone, ctx.stone), bake(ctx, brass, ctx.brass));
}

// Guardian: stone pillar on a pedestal, brass shield and helm. Its tip pivots on the outer bottom edge.
function buildSentinel(ctx: Ctx, angle: number): Sentinel {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.position.set(Math.cos(angle) * 3.7, 0.12, Math.sin(angle) * 3.7);
  root.rotation.y = Math.PI / 2 - angle;
  const tip = new THREE.Group();
  tip.position.set(0, 0, 0.175);
  const body = new THREE.Group();
  body.position.set(0, 0, -0.175);
  tip.add(body);
  root.add(tip);

  body.add(
    bake(
      ctx,
      [
        at(THREE, new THREE.BoxGeometry(0.35, 0.5, 0.35), 0, 0.25, 0),
        at(THREE, new THREE.CylinderGeometry(0.22, 0.32, 0.9, 4), 0, 0.95, 0, 0, Math.PI / 4, 0),
      ],
      ctx.stone,
    ),
  );
  body.add(new THREE.Mesh(at(THREE, new THREE.ConeGeometry(0.2, 0.25, 4), 0, 1.525, 0, 0, Math.PI / 4, 0), ctx.brass));

  const shield = new THREE.Group();
  shield.position.set(0, 0.95, 0.28);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), ctx.brass);
  disc.rotation.x = Math.PI / 2;
  shield.add(disc);
  body.add(shield);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 1.1, 0);
  body.add(anchor);
  return { root, tip, shield, anchor };
}

// Walker colossus facing the centre. Legs scale to fold, torso pitches, head turns.
function buildWalker(ctx: Ctx, angle: number): Walker {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.position.set(Math.cos(angle) * 2.9, 0.36, Math.sin(angle) * 2.9);
  root.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));

  const legs = new THREE.Group();
  legs.add(
    bake(
      ctx,
      [
        at(THREE, new THREE.BoxGeometry(0.18, 0.7, 0.22), -0.2, 0.35, 0),
        at(THREE, new THREE.BoxGeometry(0.18, 0.7, 0.22), 0.2, 0.35, 0),
      ],
      ctx.stone,
    ),
  );
  legs.add(
    bake(
      ctx,
      [
        at(THREE, new THREE.BoxGeometry(0.2, 0.12, 0.04), -0.2, 0.45, 0.13),
        at(THREE, new THREE.BoxGeometry(0.2, 0.12, 0.04), 0.2, 0.45, 0.13),
      ],
      ctx.patina,
    ),
  );
  root.add(legs);

  const torso = new THREE.Group();
  torso.position.set(0, 0.7, 0);
  torso.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(0.55, 0.6, 0.35), 0, 0.3, 0), ctx.stone));
  torso.add(
    bake(
      ctx,
      [
        at(THREE, new THREE.BoxGeometry(0.46, 0.1, 0.04), 0, 0.22, 0.195),
        at(THREE, new THREE.BoxGeometry(0.34, 0.1, 0.04), 0, 0.34, 0.195),
        at(THREE, new THREE.BoxGeometry(0.22, 0.1, 0.04), 0, 0.46, 0.195),
        at(THREE, new THREE.SphereGeometry(0.182, 16, 8, 0, TAU, 0, Math.PI / 2), -0.33, 0.6, 0, 0, 0, 0, 1, 0.6, 1),
        at(THREE, new THREE.SphereGeometry(0.182, 16, 8, 0, TAU, 0, Math.PI / 2), 0.33, 0.6, 0, 0, 0, 0, 1, 0.6, 1),
        // Brass edge trims framing the torso front.
        at(THREE, new THREE.BoxGeometry(0.02, 0.6, 0.02), -0.275, 0.3, 0.185),
        at(THREE, new THREE.BoxGeometry(0.02, 0.6, 0.02), 0.275, 0.3, 0.185),
        at(THREE, new THREE.BoxGeometry(0.57, 0.02, 0.02), 0, 0.6, 0.185),
        at(THREE, new THREE.BoxGeometry(0.57, 0.02, 0.02), 0, 0, 0.185),
        // Brass edge trims framing the ziggurat chest plate.
        at(THREE, new THREE.BoxGeometry(0.48, 0.02, 0.02), 0, 0.515, 0.22),
        at(THREE, new THREE.BoxGeometry(0.48, 0.02, 0.02), 0, 0.165, 0.22),
        at(THREE, new THREE.BoxGeometry(0.02, 0.37, 0.02), -0.24, 0.34, 0.22),
        at(THREE, new THREE.BoxGeometry(0.02, 0.37, 0.02), 0.24, 0.34, 0.22),
      ],
      ctx.brass,
    ),
  );

  const head = new THREE.Group();
  head.position.set(0, 0.6, 0);
  head.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(0.2, 0.22, 0.2), 0, 0.11, 0), ctx.stone));
  const visor = new THREE.MeshStandardMaterial({ color: ctx.stone.color, emissive: ctx.core, emissiveIntensity: WALKER_VISOR_LIT });
  head.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(0.14, 0.025, 0.02), 0, 0.13, 0.105), visor));
  torso.add(head);
  root.add(torso);

  return { root, legs, torso, head, visor, yaw: { x: 0, v: 0 } };
}

// Shrine: stepped base, obelisk and brass lantern holding an emissive sphere and a warm light.
function buildShrine(ctx: Ctx, x: number): Shrine {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.position.set(x, 0.36, 0);
  root.add(
    bake(
      ctx,
      [
        at(THREE, new THREE.BoxGeometry(0.7, 0.12, 0.7), 0, 0.06, 0),
        at(THREE, new THREE.BoxGeometry(0.5, 0.12, 0.5), 0, 0.18, 0),
      ],
      ctx.stone,
    ),
  );

  const obelisk = new THREE.Group();
  obelisk.position.set(0, 0.24, 0);
  root.add(obelisk);
  obelisk.add(new THREE.Mesh(at(THREE, new THREE.CylinderGeometry(0.05, 0.2, 1.4, 4), 0, 0.7, 0, 0, Math.PI / 4, 0), ctx.stone));

  const lanternParts: BufferGeometry[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    lanternParts.push(at(THREE, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), sx * 0.09, 1.55, sz * 0.09));
  }
  lanternParts.push(at(THREE, new THREE.BoxGeometry(0.24, 0.04, 0.24), 0, 1.72, 0));
  obelisk.add(bake(ctx, lanternParts, ctx.brass));

  const lantern = new THREE.MeshStandardMaterial({ color: ctx.core, emissive: ctx.core, emissiveIntensity: SHRINE_LANTERN });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), lantern);
  sphere.position.set(0, 1.55, 0);
  obelisk.add(sphere);

  const light = new THREE.PointLight(ctx.core, SHRINE_LIGHT, 2.5);
  light.position.set(0, 1.55, 0);
  obelisk.add(light);

  return { root, obelisk, lantern, light, sphere };
}

// Cage: four fluted columns, a bar cage on rings, and a sunburst crown in two halves over a ziggurat cap.
function buildCage(ctx: Ctx, root: Group): Cage {
  const { THREE } = ctx;
  const shafts: BufferGeometry[] = [];
  const bases: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.cos(a) * 0.95;
    const z = Math.sin(a) * 0.95;
    shafts.push(at(THREE, fluted(THREE, 0.13, 2.4), x, 1.66, z));
    bases.push(at(THREE, new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24), x, 0.41, z));
    metal.push(at(THREE, new THREE.CylinderGeometry(0.2, 0.16, 0.1, 24), x, 2.91, z));
  }
  metal.push(
    at(THREE, new THREE.BoxGeometry(1.2, 0.12, 0.6), 0, 3.02, 0),
    at(THREE, new THREE.BoxGeometry(0.9, 0.12, 0.45), 0, 3.14, 0),
    at(THREE, new THREE.BoxGeometry(0.6, 0.12, 0.3), 0, 3.26, 0),
    at(THREE, new THREE.ConeGeometry(0.05, 0.5, 8), 0, 3.57, 0),
  );
  root.add(bake(ctx, shafts, ctx.stone), bake(ctx, bases, ctx.patina), bake(ctx, metal, ctx.brass));

  const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 2.4, 6), ctx.brass, 16);
  bars.frustumCulled = false;
  root.add(bars);

  const rings = bake(
    ctx,
    [1.0, 1.9, 2.8].map((y) => at(THREE, new THREE.TorusGeometry(0.7, 0.018, 8, 64), 0, y, 0, Math.PI / 2)),
    ctx.brass,
  );
  root.add(rings);

  const fanLeft = new THREE.Group();
  const fanRight = new THREE.Group();
  fanLeft.position.set(0, 3.32, 0);
  fanRight.position.set(0, 3.32, 0);
  const leftBlades: BufferGeometry[] = [];
  const rightBlades: BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const t = ((i + 0.5) / 12) * Math.PI;
    const blade = at(THREE, new THREE.BoxGeometry(0.06, 0.4, 0.02), Math.cos(t) * 0.7, Math.sin(t) * 0.7, 0, 0, 0, t - Math.PI / 2);
    if (i < 6) rightBlades.push(blade);
    else leftBlades.push(blade);
  }
  fanRight.add(bake(ctx, rightBlades, ctx.fan));
  fanLeft.add(bake(ctx, leftBlades, ctx.fan));
  root.add(fanLeft, fanRight);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 3.7, 0);
  root.add(anchor);

  return { bars, rings, fanLeft, fanRight, anchor };
}

// Core: aged bronze icosahedron with inset faces over an emissive inner sphere.
function buildCore(ctx: Ctx, root: Group): Core {
  const { THREE } = ctx;
  const geometry = new THREE.IcosahedronGeometry(0.42, 1);
  const pos = geometry.attributes.position as BufferAttribute;
  const arr = pos.array as Float32Array;
  const count = pos.count;
  const rest = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  for (let f = 0; f < count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    const len = Math.hypot(cx, cy, cz) || 1;
    const nx = cx / len;
    const ny = cy / len;
    const nz = cz / len;
    for (let k = 0; k < 3; k++) {
      const idx = (f + k) * 3;
      rest[idx] = cx + (pos.getX(f + k) - cx) * CORE_INSET;
      rest[idx + 1] = cy + (pos.getY(f + k) - cy) * CORE_INSET;
      rest[idx + 2] = cz + (pos.getZ(f + k) - cz) * CORE_INSET;
      dir[idx] = nx;
      dir[idx + 1] = ny;
      dir[idx + 2] = nz;
    }
  }
  arr.set(rest);
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  const faceMaterial = ctx.brass.clone();
  faceMaterial.flatShading = true;
  const faces = new THREE.Mesh(geometry, faceMaterial);
  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 24, 16),
    new THREE.MeshStandardMaterial({ color: ctx.core, emissive: ctx.core, emissiveIntensity: 3.2 }),
  );
  const light = new THREE.PointLight(ctx.core, CORE_LIGHT_BASE, 5);

  const core = new THREE.Group();
  core.position.set(0, CORE_Y, 0);
  core.add(faces, inner, light);
  root.add(core);
  return { root: core, faces, rest, dir, light };
}

function fitsUnit(v: Vector3): boolean {
  return Math.abs(v.x) <= CONTAIN_LIMIT && Math.abs(v.y) <= CONTAIN_LIMIT;
}

async function mountScene(
  stage: HTMLDivElement,
  getLabels: () => (HTMLLIElement | null)[],
  getParts: () => Part[],
): Promise<() => void> {
  const noop = (): void => undefined;
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return noop;
  }

  const created: { dispose: () => void }[] = [];
  let built: Object3D | null = null;
  try {
  const mobile = window.innerWidth < MOBILE_BREAKPOINT;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const palette: Palette = {
    brass: readToken(THREE, "--color-accent"),
    patina: readToken(THREE, "--color-patina"),
    stone: readToken(THREE, "--color-stone"),
    stoneHi: readToken(THREE, "--color-stone-hi"),
    core: readToken(THREE, "--color-core"),
    soul: readToken(THREE, "--color-soul"),
    ink: readToken(THREE, "--color-ink"),
    paper: readToken(THREE, "--color-paper"),
  };

  const noise = makeNoise(THREE);
  created.push(noise);
  const brass = new THREE.MeshPhysicalMaterial({
    color: palette.brass,
    metalness: 1,
    roughness: 0.38,
    clearcoat: 0.2,
    map: noise,
    roughnessMap: noise,
  });
  const patina = new THREE.MeshPhysicalMaterial({
    color: palette.patina.clone().multiplyScalar(0.6),
    metalness: 0.5,
    roughness: 0.7,
    map: noise,
    roughnessMap: noise,
  });
  const fan = new THREE.MeshPhysicalMaterial({
    color: palette.brass.clone().multiplyScalar(1.15),
    metalness: 1,
    roughness: 0.25,
    clearcoat: 0.2,
    map: noise,
    roughnessMap: noise,
    side: THREE.DoubleSide,
  });
  const stone = new THREE.MeshStandardMaterial({ color: palette.stone, roughness: 0.92, metalness: 0, map: noise });
  const stoneHi = new THREE.MeshStandardMaterial({ color: palette.stoneHi, roughness: 0.92, metalness: 0, map: noise });
  const tracked: Material[] = [brass, patina, fan, stone, stoneHi];
  created.push(...tracked);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.classList.add("reliquary-canvas");
  canvas.setAttribute("aria-hidden", "true");
  stage.insertBefore(canvas, stage.querySelector(".reliquary-labels"));

  const scene = new THREE.Scene();
  built = scene;
  scene.fog = new THREE.FogExp2(palette.paper, 0.06);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnvironment, 0.04);
  disposeTree(roomEnvironment);
  created.push(pmrem, envTarget);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;

  const hemisphere = new THREE.HemisphereLight(palette.ink, palette.paper, 0.25);
  const key = new THREE.DirectionalLight(palette.ink, 2);
  key.position.set(-3, 4, 5);
  scene.add(hemisphere, key);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, CAM_Y_START, CAM_DIST_START);
  camera.lookAt(0, CAM_LOOK_START, 0);

  const ctx: Ctx = { THREE, merge: mergeGeometries, core: palette.core, brass, patina, stone, stoneHi, fan };

  const root = new THREE.Group();
  scene.add(root);
  buildPlinth(ctx, root);
  const sentinels = [45, 135, 225, 315].map((deg) => buildSentinel(ctx, deg * DEG));
  for (const s of sentinels) root.add(s.root);
  const walkers = [90, 210, 330].map((deg) => buildWalker(ctx, deg * DEG));
  for (const w of walkers) root.add(w.root);
  const shrines = [2, -2].map((x) => buildShrine(ctx, x));
  for (const s of shrines) root.add(s.root);
  const cage = buildCage(ctx, root);
  const core = buildCore(ctx, root);

  // Souls: instanced, three tilted orbits.
  const soulCount = mobile ? 18 : 36;
  const soulMaterial = new THREE.MeshStandardMaterial({ color: palette.soul, emissive: palette.soul, emissiveIntensity: 2 });
  tracked.push(soulMaterial);
  created.push(soulMaterial);
  const souls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), soulMaterial, soulCount);
  souls.frustumCulled = false;
  root.add(souls);
  const orbitEulers = SOUL_ORBITS.map(([x, y, z]) => ({ x, y, z }));
  const soulList: Soul[] = Array.from({ length: soulCount }, (_, i) => {
    const frac = (n: number): number => n - Math.floor(n);
    return {
      radius: 1.2 + 2.2 * frac(i * 0.618),
      speed: 0.08 + 0.07 * frac(i * 0.382),
      theta: i * 2.399,
      euler: orbitEulers[i % 3] ?? { x: 0, y: 0, z: 0 },
    };
  });
  const dummy = new THREE.Object3D();
  const scratch = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const soulPos = new THREE.Vector3();
  const placeSouls = (): void => {
    soulList.forEach((soul, i) => {
      soulPos.set(Math.cos(soul.theta) * soul.radius, 0, Math.sin(soul.theta) * soul.radius);
      soulPos.applyEuler(new THREE.Euler(soul.euler.x, soul.euler.y, soul.euler.z));
      soulPos.y = Math.max(SOUL_MIN_Y, soulPos.y);
      dummy.position.copy(soulPos);
      dummy.updateMatrix();
      souls.setMatrixAt(i, dummy.matrix);
    });
    souls.instanceMatrix.needsUpdate = true;
  };
  placeSouls();

  // Label anchors: one fixed object per layer, chosen at build time so labels never jump.
  const pick = <T,>(list: readonly T[], index: number): T => {
    const item = list[index];
    if (item === undefined) throw new Error(`Patron: missing scene object at ${index}`);
    return item;
  };
  // Guardian anchor: the sentinel with the largest world z (nearest the hero camera), fixed at build time.
  root.updateMatrixWorld(true);
  let frontIndex = 0;
  let frontZ = -Infinity;
  sentinels.forEach((s, i) => {
    s.anchor.getWorldPosition(scratch);
    if (scratch.z > frontZ + 1e-6) {
      frontZ = scratch.z;
      frontIndex = i;
    }
  });
  const anchors: Record<PartKey, Object3D> = {
    guardians: pick(sentinels, frontIndex).anchor,
    walkers: pick(walkers, 1).head, // 210 deg
    shrines: pick(shrines, 0).sphere, // first shrine, x = +2
    cage: cage.anchor,
    core: core.root,
  };
  const anchorFor = (key: PartKey, out: Vector3): void => {
    anchors[key].getWorldPosition(out);
  };

  const stageValues: Record<PartKey, number> = { guardians: 0, walkers: 0, shrines: 0, cage: 0, core: 0 };
  const worldPosition = new THREE.Vector3();
  let width = 0;
  let height = 0;
  const labelSizes: { w: number; h: number }[] = [];
  let rafId = 0;
  let lastTime = 0;
  let visible = false;
  let disposed = false;
  let elapsed = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerClientX = 0;
  let pointerClientY = 0;
  let hasPointer = false;
  const yawSpring: Spring = { x: 0, v: 0 };
  const pitchSpring: Spring = { x: 0, v: 0 };
  const progressSpring: Spring = { x: 0, v: 0 };
  const coreYaw: Spring = { x: 0, v: 0 };
  const coreTilt: Spring = { x: 0, v: 0 };
  const glow: Spring = { x: 0, v: 0 };
  let idleYaw = 0;
  let aimX = 0;
  let aimY = 0;
  let yawTarget = 0;
  let pitchTarget = 0;
  const labelList = stage.querySelector<HTMLElement>(".reliquary-labels");
  // True while a label link is hovered or has focus: aim targets are held.
  const labelHeld = (): boolean => labelList !== null && (labelList.matches(":hover") || labelList.matches(":focus-within"));
  let lastMove = performance.now();
  let baseX = 0;
  let baseY = 0;
  let baseScale = 1;
  let camDistStart = CAM_DIST_START;

  const shouldRun = (): boolean => !disposed && visible && document.visibilityState === "visible";

  function schedule(): void {
    if (rafId === 0 && shouldRun()) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function applyGuardians(g: number): void {
    for (const s of sentinels) {
      s.tip.rotation.x = SENTINEL_TILT * g;
      s.root.position.y = 0.12 - SENTINEL_SINK * g;
      s.shield.position.y = 0.95 - SENTINEL_DROP * g;
      s.shield.rotation.z = (Math.PI / 2) * g;
    }
  }

  function applyWalkers(dt: number): void {
    const k = stageValues.walkers;
    const legScale = 1 - 0.5 * k;
    for (const w of walkers) {
      w.legs.scale.y = legScale;
      w.torso.position.y = 0.7 * legScale;
      w.torso.rotation.x = WALKER_PITCH * k;
      w.visor.emissiveIntensity = lerp(WALKER_VISOR_LIT, WALKER_VISOR_DARK, k);
      stepSpring(w.yaw, aimX * WALKER_HEAD_TURN * (1 - k), HEAD_STIFFNESS, HEAD_DAMPING, dt);
      w.head.rotation.y = w.yaw.x;
    }
  }

  function applyShrines(): void {
    const s = stageValues.shrines;
    for (const shrine of shrines) {
      shrine.obelisk.position.y = 0.24 - SHRINE_DROP * s;
      shrine.lantern.emissiveIntensity = SHRINE_LANTERN * (1 - s);
      shrine.light.intensity = SHRINE_LIGHT * (1 - s);
    }
  }

  function applyCage(p: number): void {
    const lin = linearAt(p, "cage");
    const eased = easeInOutCubic(lin);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const local = easeInOutCubic(clamp((lin - i * CAGE_STAGGER) / (1 - 15 * CAGE_STAGGER), 0, 1));
      dummy.position.set(Math.cos(a) * 0.7, 1.66 + CAGE_RISE * local, Math.sin(a) * 0.7);
      dummy.updateMatrix();
      cage.bars.setMatrixAt(i, dummy.matrix);
    }
    cage.bars.instanceMatrix.needsUpdate = true;
    cage.rings.position.y = CAGE_RISE * eased;
    cage.fanRight.rotation.z = -FAN_OPEN * eased;
    cage.fanLeft.rotation.z = FAN_OPEN * eased;
  }

  function applyCore(dt: number): void {
    const ce = stageValues.core;
    const bob = reduced ? 0 : CORE_BOB * Math.sin((elapsed * TAU) / CORE_BOB_PERIOD);
    core.root.position.y = CORE_Y + bob + CORE_RISE * ce;

    stepSpring(coreYaw, pointerX * 0.5, CORE_TURN_STIFFNESS, CORE_TURN_DAMPING, dt);
    stepSpring(coreTilt, pointerY * 0.3, CORE_TURN_STIFFNESS, CORE_TURN_DAMPING, dt);
    core.root.rotation.set(coreTilt.x, coreYaw.x, 0);

    const open = CORE_OPEN * ce;
    const facePos = core.faces.geometry.attributes.position as BufferAttribute;
    const arr = facePos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = (core.rest[i] ?? 0) + (core.dir[i] ?? 0) * open;
    }
    facePos.needsUpdate = true;

    let near = false;
    if (hasPointer) {
      const rect = stage.getBoundingClientRect();
      core.root.getWorldPosition(scratch);
      scratch.project(camera);
      const sx = rect.left + (scratch.x * 0.5 + 0.5) * width;
      const sy = rect.top + (-scratch.y * 0.5 + 0.5) * height;
      near = Math.hypot(pointerClientX - sx, pointerClientY - sy) < GLOW_RANGE * Math.min(window.innerWidth, window.innerHeight);
    }
    stepSpring(glow, near ? GLOW_LIFT : 0, GLOW_STIFFNESS, GLOW_DAMPING, dt);
    core.light.intensity = lerp(CORE_LIGHT_BASE, CORE_LIGHT_OPEN, ce) + Math.max(0, glow.x);
  }

  function applySouls(dt: number): void {
    if (reduced) return;
    for (const soul of soulList) soul.theta += soul.speed * dt;
    placeSouls();
  }

  function labelsContained(): boolean {
    for (const part of getParts()) {
      const s = smoothstep(0.25, 0.6, stageValues[part.key]);
      if (s <= 0.05) continue;
      anchorFor(part.key, probe);
      probe.project(camera);
      if (!fitsUnit(probe)) return false;
    }
    return true;
  }

  function updateLabels(): void {
    const labels = getLabels();
    getParts().forEach((part, i) => {
      const item = labels[i];
      if (!item) return;
      const s = smoothstep(0.25, 0.6, stageValues[part.key]);
      anchorFor(part.key, worldPosition);
      worldPosition.project(camera);
      const size = labelSizes[i] ?? { w: 0, h: 0 };
      const rawX = (worldPosition.x * 0.5 + 0.5) * width;
      const rawY = (-worldPosition.y * 0.5 + 0.5) * height;
      const x = clamp(rawX, LABEL_EDGE_PX, Math.max(LABEL_EDGE_PX, width - size.w - LABEL_EDGE_PX));
      const minY = LABEL_EDGE_PX;
      // Never hide or disable a label that is hovered or focused, so it cannot flicker out of reach.
      const keep = item.matches(":hover, :focus-within");
      const rise = keep ? 0 : (1 - s) * LABEL_RISE_PX;
      const y = clamp(rawY, minY, Math.max(minY, height - size.h - LABEL_EDGE_PX)) + rise;
      item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      item.style.opacity = (keep ? Math.max(s, 0.6) : s).toFixed(3);
      item.style.pointerEvents = s > 0.05 || keep ? "auto" : "none";
      item.style.visibility = s < 0.05 && !keep ? "hidden" : "visible";
    });
  }

  function frame(now: number): void {
    rafId = 0;
    if (!shouldRun()) return;
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;
    elapsed += dt;

    const raw = scrollProgress();
    stepSpring(progressSpring, raw, SCROLL_STIFFNESS, SCROLL_DAMPING, dt);
    const p = clamp(progressSpring.x, 0, 1);
    // Pointer steering fades out during the lane push so labels stay put.
    const cursorInfluence = 1 - smoothstep(0.1, 0.25, p);

    // While a label link is hovered or focused, hold the aim targets so nothing moves under the cursor.
    if (!labelHeld()) {
      if (!reduced) {
        if (now - lastMove > IDLE_DELAY_MS && cursorInfluence >= 1) idleYaw += IDLE_YAW_SPEED * dt;
        else idleYaw *= Math.exp(-dt * IDLE_YAW_DECAY);
      }
      aimX = pointerX;
      aimY = pointerY;
      yawTarget = aimX * POINTER_YAW * cursorInfluence + (cursorInfluence >= 1 ? idleYaw : 0);
      pitchTarget = aimY * POINTER_PITCH * cursorInfluence;
    }
    stepSpring(yawSpring, yawTarget, CURSOR_STIFFNESS, CURSOR_DAMPING, dt);
    stepSpring(pitchSpring, pitchTarget, CURSOR_STIFFNESS, CURSOR_DAMPING, dt);
    root.rotation.set(pitchSpring.x, yawSpring.x, 0);
    root.position.set(baseX, baseY + (raw <= 0 ? window.scrollY * 0.0012 : 0), 0);
    root.scale.setScalar(baseScale);

    for (const key of KEYS) stageValues[key] = stageAt(p, key);
    applyGuardians(stageValues.guardians);
    applyWalkers(dt);
    applyShrines();
    applyCage(p);
    applyCore(dt);
    applySouls(dt);
    root.updateMatrixWorld(true);

    const e = easeInOutCubic(p);
    const azimuth = CAM_ORBIT * e;
    const height3 = lerp(CAM_Y_START, CAM_Y_END, e);
    const lookY = lerp(CAM_LOOK_START, CAM_LOOK_END, e);
    let dist = lerp(camDistStart, CAM_DIST_END, e);
    const aim = (): void => {
      camera.position.set(Math.sin(azimuth) * dist, height3, Math.cos(azimuth) * dist);
      camera.lookAt(0, lookY, 0);
      camera.updateMatrixWorld();
    };
    aim();
    for (let step = 0; step < CONTAIN_MAX_STEPS && !labelsContained(); step++) {
      dist += CONTAIN_STEP;
      aim();
    }

    renderer.render(scene, camera);
    updateLabels();
    if (stage.dataset.live !== "true") stage.dataset.live = "true";
    rafId = requestAnimationFrame(frame);
  }

  function measureLabels(): void {
    const labels = getLabels();
    labelSizes.length = 0;
    getParts().forEach((_, i) => {
      const item = labels[i];
      labelSizes[i] = { w: item?.offsetWidth ?? 0, h: item?.offsetHeight ?? 0 };
    });
  }

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    width = w;
    height = h;
    measureLabels();
    const wide = w >= MOBILE_BREAKPOINT;
    baseX = wide ? WIDE_X : 0;
    baseY = wide ? 0 : 0.4;
    baseScale = wide ? WIDE_SCALE : 0.78;
    camDistStart = wide ? CAM_DIST_WIDE : CAM_DIST_START;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = -((event.clientY / window.innerHeight) * 2 - 1);
    pointerClientX = event.clientX;
    pointerClientY = event.clientY;
    hasPointer = true;
    lastMove = performance.now();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const intersectionObserver = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    visible = entry?.isIntersecting === true;
    schedule();
  });
  intersectionObserver.observe(stage);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", schedule);
  resize();
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    rafId = 0;
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("visibilitychange", schedule);
    disposeTree(scene);
    for (const material of tracked) material.dispose();
    noise.dispose();
    souls.dispose();
    cage.bars.dispose();
    envTarget.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    stage.dataset.live = "false";
  };
  } catch (error) {
    for (const item of created) item.dispose();
    if (built) disposeTree(built);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    stage.dataset.live = "false";
    throw error;
  }
}

export function Patron({ parts }: { parts: Part[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLLIElement | null)[]>([]);
  const partsRef = useRef<Part[]>(parts);

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || shouldUseStill()) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;
    mountScene(
      stage,
      () => labelRefs.current,
      () => partsRef.current,
    )
      .then((dispose) => {
        if (cancelled) dispose();
        else teardown = dispose;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return (
    <div className="reliquary-stage" ref={stageRef} data-live="false">
      <img className="reliquary-still" src="/reliquary-still.png" alt="Святилище Патрона в стиле ар-деко" />
      <ol className="reliquary-labels">
        {parts.map((part, i) => (
          <li
            key={part.key}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
          >
            <a href={part.href}>{part.label}</a>
          </li>
        ))}
      </ol>
    </div>
  );
}
