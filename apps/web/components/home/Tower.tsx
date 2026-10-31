"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Sprite,
  Vector3,
  WebGLRenderer,
} from "three";
import { useHeroStats } from "@/components/home/useHeroStats";
import "@/app/home/reliquary.css";

type ThreeLib = typeof import("three");
type MergeFn = (geometries: BufferGeometry[]) => BufferGeometry | null;

type PartKey = "meta" | "heroes" | "builds" | "matches" | "profile";
type Part = { key: PartKey; label: string; href: string };
type HeroWindow = { name: string; winRate: number };

type Palette = {
  brass: Color;
  stone: Color;
  stoneHi: Color;
  core: Color;
  window: Color;
  windowOff: Color;
  ink: Color;
  paper: Color;
  paper2: Color;
  paper3: Color;
};

type Ctx = {
  THREE: ThreeLib;
  merge: MergeFn;
  brass: MeshPhysicalMaterial;
  stone: MeshStandardMaterial;
  stoneHi: MeshStandardMaterial;
  iron: MeshStandardMaterial;
  fan: MeshPhysicalMaterial;
  street: MeshPhysicalMaterial;
  ground: MeshBasicMaterial;
  lantern: MeshStandardMaterial;
  portalGlow: MeshStandardMaterial;
  windowLit: MeshBasicMaterial;
  windowDark: MeshStandardMaterial;
  windowHero: MeshBasicMaterial;
};

type Spring = { x: number; v: number };
type ExtendedNavigator = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
type SceneHandle = { dispose: () => void; setHeroes: (rows: HeroWindow[]) => void };

const KEYS: readonly PartKey[] = ["meta", "heroes", "builds", "matches", "profile"];
// Scroll windows per station (progress 0..1).
const STATION_WINDOW: Record<PartKey, [number, number]> = {
  meta: [0, 0.22],
  heroes: [0.18, 0.45],
  builds: [0.4, 0.62],
  matches: [0.58, 0.8],
  profile: [0.76, 1],
};
// Camera keyframes: the camera dwells at each station and eases between them.
// Fixed station heights: [p start, p end, camera y, look y]. The camera holds still inside each window.
const STATIONS: [number, number, number, number][] = [
  [0.05, 0.18, 13.2, 13.3],
  [0.28, 0.4, 8, 8.85],
  [0.5, 0.6, 5.6, 5.6],
  [0.7, 0.8, 4.2, 4.7],
  [0.92, 1, 1.2, 1.5],
];
const ANCHOR_POS: Record<PartKey, [number, number, number]> = {
  meta: [-0.5, 13.3, 0.5],
  heroes: [-0.95, 8.85, 1.25],
  builds: [-1.0, 5.6, 1.5],
  matches: [-0.95, 4.7, 1.25],
  profile: [-0.5, 1.5, 1.7],
};

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const HALF = Math.PI / 2;
const SHAFT_Y0 = 2.4;
const FLOOR_H = 0.4;
const FLOORS = 20;
const FACE_HALF = 1.2;
const HERO_COLS = 11;
const HERO_ROWS = 4;
const HERO_COUNT = HERO_COLS * HERO_ROWS;
const HERO_TOP_FLOOR = 15;
const DIAL_Y = 4.2;
const DIAL_R = 0.5;
const LIT_SHARE = 30;
const WIN_LOW = 0.44;
const WIN_MID = 0.5;
const WIN_HIGH = 0.56;
const GLOW_LOW = 0.15;
const GLOW_MID = 0.7;
const GLOW_HIGH = 1.6;
const LAMP_GLOW = 1.2;
const LAMP_FADE_S = 0.2;
const LAMP_COUNT = 8;
const LANTERN_GLOW = 1.4;
const PORTAL_GLOW = 1.2;
const LAMP_SPOTS: [number, number][] = [
  [-2.2, 2.2],
  [2.2, 2.2],
  [-3.0, 3.0],
  [3.0, 3.0],
];
const TRACK_START = 0.05;
const AZ_START = 35 * DEG;
const AZ_END = 10 * DEG;
const DIST_START = 6.5;
const GROUND_R = 30;
const DIST_END = 7.5;
const HERO_FOV = 34;
const DIST_MAX = 9;
const CROWN_HERO_SHARE = 0.7;
const LABEL_HIDE_P = 0.08;
const WIDE_X = 2.4;
const WIDE_X_TRACK = 1.0;
const CAR_BELOW = 0.8;
const CAR_MIN_Y = 2.75;
const CAR_MAX_Y = 10.1;
const CAR_STIFFNESS = 60;
const CAR_DAMPING = 1;
const CAR_SWAY_MAX = 0.04;
const CAR_SWAY_GAIN = 0.01;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
const CONTAIN_LABEL = 0.92;
const CONTAIN_X = 0.95;
const CONTAIN_Y_MIN = 0.95;
const CONTAIN_Y_MAX = 0.9;
const CONTAIN_STEP = 0.08;
const CONTAIN_MAX_STEPS = 20;
const DOLLY_EASE = 6;
const EXIT_SPAN = 0.35;
const EXIT_SHIFT_PX = 40;
const EXIT_SCALE = 0.03;
const CURSOR_STIFFNESS = 60;
const CURSOR_DAMPING = 0.9;
const POINTER_YAW = 0.18;
const IDLE_DELAY_MS = 2500;
const IDLE_YAW_SPEED = 0.04;
const IDLE_YAW_DECAY = 2;
const SCROLL_STIFFNESS = 160;
const SCROLL_DAMPING = 1;
const MAX_DT = 1 / 30;
const LABEL_RISE_PX = 6;
const LABEL_EDGE_PX = 8;
const MOBILE_BREAKPOINT = 960;
const FOG_DRIFT_S = 40;
const TAG_OFFSET_PX = 14;

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

// Second-order spring step: weighted, with momentum, no visible overshoot at the damping used here.
function stepSpring(s: Spring, target: number, stiffness: number, damping: number, dt: number): void {
  const c = 2 * damping * Math.sqrt(stiffness);
  s.v += (target - s.x) * stiffness * dt;
  s.v -= s.v * c * dt;
  s.x += s.v * dt;
}

// Win rate (fraction) to window emissive intensity: 44% dim, 50% warm, 56%+ bright.
function winGlow(rate: number): number {
  if (rate <= WIN_MID) return lerp(GLOW_LOW, GLOW_MID, clamp((rate - WIN_LOW) / (WIN_MID - WIN_LOW), 0, 1));
  return lerp(GLOW_MID, GLOW_HIGH, clamp((rate - WIN_MID) / (WIN_HIGH - WIN_MID), 0, 1));
}

// Station label weight on the scroll track: the first and last hold their edge.
function stationWeight(p: number, key: PartKey): number {
  const [a, b] = STATION_WINDOW[key];
  const rise = key === "meta" ? 1 : smoothstep(a, a + 0.05, p);
  const fall = key === "profile" ? 1 : 1 - smoothstep(b - 0.05, b, p);
  return rise * fall;
}

// Camera height and look-at height: hold inside a station window, ease between stations.
function trackHeights(p: number): { camY: number; lookY: number } {
  const first = STATIONS[0];
  const last = STATIONS[STATIONS.length - 1];
  if (!first || !last) return { camY: 0, lookY: 0 };
  if (p <= first[1]) return { camY: first[2], lookY: first[3] };
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i];
    const b = STATIONS[i + 1];
    if (!a || !b) continue;
    if (p <= b[0]) {
      const e = easeInOutCubic(clamp((p - a[1]) / (b[0] - a[1]), 0, 1));
      return { camY: lerp(a[2], b[2], e), lookY: lerp(a[3], b[3], e) };
    }
  }
  return { camY: last[2], lookY: last[3] };
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

// Track = hero + #parts: 0 at the top of the page, 1 at the end of #parts.
// crown is the progress at which the hero has scrolled CROWN_HERO_SHARE away.
function scrollProgress(): { p: number; crown: number } {
  const track = document.getElementById("parts");
  if (!track) return { p: 0, crown: 0.1 };
  const end = track.getBoundingClientRect().bottom + window.scrollY;
  const span = end - window.innerHeight;
  if (span <= 0) return { p: 0, crown: 0.1 };
  const heroH = document.getElementById("top")?.offsetHeight ?? window.innerHeight;
  const crown = clamp((CROWN_HERO_SHARE * heroH) / span, 0.09, 0.5);
  return { p: clamp(window.scrollY / span, 0, 1), crown };
}

function stationProgress(p: number, crown: number): number {
  if (p <= crown) return (p / crown) * TRACK_START;
  return TRACK_START + ((p - crown) / (1 - crown)) * (1 - TRACK_START);
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

// Soft fog puff: white with an alpha of noise times a radial falloff, computed per pixel.
function makeFog(THREE: ThreeLib): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext("2d");
  if (ctx2d) {
    const field = noiseField(4, 99);
    const image = ctx2d.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x / size - 0.5) * 2;
        const dy = (y / size - 0.5) * 2;
        const falloff = Math.pow(clamp(1 - Math.hypot(dx, dy), 0, 1), 1.5);
        const idx = (y * size + x) * 4;
        image.data[idx] = 255;
        image.data[idx + 1] = 255;
        image.data[idx + 2] = 255;
        image.data[idx + 3] = Math.round(255 * falloff * (0.45 + 0.55 * field(x / size, y / size)));
      }
    }
    ctx2d.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
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

// Point on a tower face: az is the face azimuth (0 = front, +z), u along the face, d out from the axis.
function facePoint(az: number, u: number, y: number, d: number): [number, number, number] {
  return [u * Math.cos(az) + d * Math.sin(az), y, -u * Math.sin(az) + d * Math.cos(az)];
}

// Static parts sharing one material are merged into a single draw call.
function bake(ctx: Ctx, geometries: BufferGeometry[], material: Material): Mesh {
  const geometry = ctx.merge(geometries) ?? new ctx.THREE.BufferGeometry();
  return new ctx.THREE.Mesh(geometry, material);
}

// Street block: wet stone plate, kerb and four cast iron lamps with warm lanterns.
function buildStreet(ctx: Ctx, root: Group, lampColor: Color): void {
  const { THREE } = ctx;
  root.add(new THREE.Mesh(at(THREE, new THREE.CircleGeometry(GROUND_R, 64), 0, -0.12, 0, -HALF), ctx.ground));
  root.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(7, 0.1, 7), 0, -0.05, 0), ctx.street));
  const kerb: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    kerb.push(at(THREE, new THREE.BoxGeometry(7.1, 0.12, 0.1), 0, 0.02, s * 3.5));
    kerb.push(at(THREE, new THREE.BoxGeometry(0.1, 0.12, 7.1), s * 3.5, 0.02, 0));
  }
  root.add(bake(ctx, kerb, ctx.stone));

  const iron: BufferGeometry[] = [];
  const brass: BufferGeometry[] = [];
  for (const [x, z] of LAMP_SPOTS) {
    iron.push(at(THREE, new THREE.CylinderGeometry(0.07, 0.09, 0.14, 8), x, 0.07, z));
    iron.push(at(THREE, new THREE.CylinderGeometry(0.025, 0.035, 1.5, 8), x, 0.85, z));
    brass.push(at(THREE, new THREE.BoxGeometry(0.15, 0.03, 0.15), x, 1.66, z));
    brass.push(at(THREE, new THREE.BoxGeometry(0.13, 0.03, 0.13), x, 1.44, z));
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), ctx.lantern);
    lantern.position.set(x, 1.55, z);
    root.add(lantern);
    const light = new THREE.PointLight(lampColor, 0.8, 4);
    light.position.set(x, 1.55, z);
    root.add(light);
  }
  root.add(bake(ctx, iron, ctx.iron), bake(ctx, brass, ctx.brass));
}

// Base: stone podium with ribs and a stepped brass entrance portal whose panel glows.
function buildBase(ctx: Ctx, root: Group): void {
  const { THREE } = ctx;
  const stone: BufferGeometry[] = [
    at(THREE, new THREE.BoxGeometry(3.2, 2.4, 3.2), 0, 1.2, 0),
    at(THREE, new THREE.BoxGeometry(3.5, 0.12, 3.5), 0, 0.06, 0),
  ];
  const ribs: BufferGeometry[] = [];
  for (let face = 0; face < 4; face++) {
    const az = face * HALF;
    for (let i = 0; i < 8; i++) {
      const u = -1.4 + i * 0.4;
      if (face === 0 && Math.abs(u) < 0.5) continue;
      const [x, y, z] = facePoint(az, u, 1.2, 1.63);
      ribs.push(at(THREE, new THREE.BoxGeometry(0.08, 2.4, 0.06), x, y, z, 0, az, 0));
    }
  }
  root.add(bake(ctx, stone, ctx.stone), bake(ctx, ribs, ctx.stoneHi));

  const brass: BufferGeometry[] = [];
  const frames: [number, number][] = [
    [0.9, 1.4],
    [0.72, 1.2],
    [0.54, 1.0],
  ];
  const bar = 0.06;
  frames.forEach(([w, h], i) => {
    const z = 1.62 + i * 0.04;
    const cy = 0.12 + h / 2;
    brass.push(
      at(THREE, new THREE.BoxGeometry(bar, h, 0.05), -(w / 2 - bar / 2), cy, z),
      at(THREE, new THREE.BoxGeometry(bar, h, 0.05), w / 2 - bar / 2, cy, z),
      at(THREE, new THREE.BoxGeometry(w, bar, 0.05), 0, 0.12 + h - bar / 2, z),
    );
  });
  root.add(bake(ctx, brass, ctx.brass));
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.03), ctx.portalGlow);
  panel.position.set(0, 0.57, 1.62);
  root.add(panel);
}

// Shaft: chamfered square prism with piers and brass spandrel bands. Windows are built separately.
function buildShaft(ctx: Ctx, root: Group): void {
  const { THREE } = ctx;
  const c = 0.3;
  const h = FACE_HALF;
  const shape = new THREE.Shape();
  shape.moveTo(-h + c, -h);
  shape.lineTo(h - c, -h);
  shape.lineTo(h, -h + c);
  shape.lineTo(h, h - c);
  shape.lineTo(h - c, h);
  shape.lineTo(-h + c, h);
  shape.lineTo(-h, h - c);
  shape.lineTo(-h, -h + c);
  shape.closePath();
  const height = FLOORS * FLOOR_H;
  const prism = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  prism.rotateX(-HALF);
  prism.translate(0, SHAFT_Y0, 0);
  root.add(new THREE.Mesh(prism, ctx.stone));

  const piers: BufferGeometry[] = [];
  const bands: BufferGeometry[] = [];
  const midY = SHAFT_Y0 + height / 2;
  for (let face = 0; face < 4; face++) {
    const az = face * HALF;
    const front = face === 0;
    const cols = front ? HERO_COLS : 6;
    const spacing = front ? 0.16 : 0.3;
    for (let i = 0; i <= cols; i++) {
      const u = (i - cols / 2) * spacing;
      const [x, y, z] = facePoint(az, u, midY, FACE_HALF + 0.015);
      piers.push(at(THREE, new THREE.BoxGeometry(0.03, height, 0.04), x, y, z, 0, az, 0));
    }
    for (let f = 0; f <= FLOORS; f++) {
      const [x, y, z] = facePoint(az, 0, SHAFT_Y0 + f * FLOOR_H, FACE_HALF + 0.02);
      bands.push(at(THREE, new THREE.BoxGeometry(1.9, 0.05, 0.06), x, y, z, 0, az, 0));
    }
  }
  root.add(bake(ctx, piers, ctx.stoneHi), bake(ctx, bands, ctx.brass));
}

type WindowSet = { lit: InstancedMesh; dark: InstancedMesh; hero: InstancedMesh };

// Windows: three instanced meshes. Decor windows use a deterministic seed; hero windows are data-driven.
function buildWindows(ctx: Ctx, root: Group, lit: Color, off: Color): WindowSet {
  const { THREE } = ctx;
  const dummy = new THREE.Object3D();
  const decorLit: { matrix: Matrix4; level: number }[] = [];
  const decorDark: Matrix4[] = [];
  const hero: Matrix4[] = [];
  for (let f = 0; f < FLOORS; f++) {
    const y = SHAFT_Y0 + f * FLOOR_H + FLOOR_H / 2;
    for (let face = 0; face < 4; face++) {
      const az = face * HALF;
      const front = face === 0;
      const cols = front ? HERO_COLS : 6;
      const spacing = front ? 0.16 : 0.3;
      const w = front ? 0.1 : 0.15;
      for (let col = 0; col < cols; col++) {
        const u = (col - (cols - 1) / 2) * spacing;
        const [x, py, z] = facePoint(az, u, y, FACE_HALF + 0.01);
        dummy.position.set(x, py, z);
        dummy.rotation.set(0, az, 0);
        dummy.scale.set(w, 0.22, 1);
        dummy.updateMatrix();
        const matrix = dummy.matrix.clone();
        if (front && f > HERO_TOP_FLOOR - HERO_ROWS && f <= HERO_TOP_FLOOR) {
          hero[(HERO_TOP_FLOOR - f) * HERO_COLS + col] = matrix;
          continue;
        }
        if (front && Math.hypot(u, y - DIAL_Y) < DIAL_R + 0.1) continue;
        const hash = Math.imul(f * 73 + col * 37 + face * 101 + 17, 2654435761) >>> 0;
        if ((hash >>> 8) % 100 < LIT_SHARE) {
          decorLit.push({ matrix, level: 0.6 + (0.4 * ((hash >>> 16) % 100)) / 100 });
        } else {
          decorDark.push(matrix);
        }
      }
    }
  }
  const tint = new THREE.Color();
  const litMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), ctx.windowLit, decorLit.length);
  decorLit.forEach((slot, i) => {
    litMesh.setMatrixAt(i, slot.matrix);
    litMesh.setColorAt(i, tint.copy(lit).multiplyScalar(slot.level));
  });
  const darkMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), ctx.windowDark, decorDark.length);
  decorDark.forEach((matrix, i) => darkMesh.setMatrixAt(i, matrix));
  const heroMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), ctx.windowHero, HERO_COUNT);
  for (let i = 0; i < HERO_COUNT; i++) {
    const matrix = hero[i];
    if (matrix) heroMesh.setMatrixAt(i, matrix);
    heroMesh.setColorAt(i, off);
  }
  for (const mesh of [litMesh, darkMesh, heroMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  return { lit: litMesh, dark: darkMesh, hero: heroMesh };
}

type Dial = { hour: Group; minute: Group };

// Clock dial on the front face of floor 4: brass ring, 12 ticks, two hands.
function buildDial(ctx: Ctx, root: Group): Dial {
  const { THREE } = ctx;
  const group = new THREE.Group();
  group.position.set(0, DIAL_Y, FACE_HALF);
  root.add(group);
  group.add(new THREE.Mesh(at(THREE, new THREE.CylinderGeometry(DIAL_R - 0.02, DIAL_R - 0.02, 0.03, 40), 0, 0, 0.015, HALF), ctx.iron));
  const brass: BufferGeometry[] = [at(THREE, new THREE.TorusGeometry(DIAL_R - 0.04, 0.03, 8, 64), 0, 0, 0.03)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    brass.push(at(THREE, new THREE.BoxGeometry(0.02, 0.07, 0.02), Math.sin(a) * 0.37, Math.cos(a) * 0.37, 0.035, 0, 0, -a));
  }
  brass.push(at(THREE, new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), 0, 0, 0.06, HALF));
  group.add(bake(ctx, brass, ctx.brass));
  const hour = new THREE.Group();
  hour.position.z = 0.045;
  hour.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(0.035, 0.22, 0.015), 0, 0.11, 0), ctx.brass));
  const minute = new THREE.Group();
  minute.position.z = 0.055;
  minute.add(new THREE.Mesh(at(THREE, new THREE.BoxGeometry(0.022, 0.33, 0.012), 0, 0.165, 0), ctx.brass));
  group.add(hour, minute);
  return { hour, minute };
}

// Scaffolding on floors 7 and 8 with a hanging sign plate (no text in 3D).
function buildScaffold(ctx: Ctx, root: Group): void {
  const { THREE } = ctx;
  const parts: BufferGeometry[] = [];
  const d = 1.45;
  for (let face = 0; face < 4; face++) {
    const az = face * HALF;
    for (const u of [-1.4, -0.7, 0, 0.7, 1.4]) {
      const [x, y, z] = facePoint(az, u, 5.65, d);
      parts.push(at(THREE, new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6), x, y, z));
    }
    for (const y of [5.2, 5.6, 6.0]) {
      const [x, py, z] = facePoint(az, 0, y, d);
      parts.push(at(THREE, new THREE.BoxGeometry(2.9, 0.025, 0.025), x, py, z, 0, az, 0));
    }
    const [px, py, pz] = facePoint(az, 0, 5.6, d - 0.1);
    parts.push(at(THREE, new THREE.BoxGeometry(2.9, 0.02, 0.2), px, py, pz, 0, az, 0));
  }
  [-1.05, -0.35, 0.35, 1.05].forEach((u, i) => {
    const slope = i % 2 === 0 ? 1 : -1;
    parts.push(at(THREE, new THREE.BoxGeometry(0.81, 0.02, 0.02), u, 5.6, d, 0, 0, slope * Math.atan2(0.4, 0.7)));
  });
  for (const u of [-0.2, 0.2]) {
    parts.push(at(THREE, new THREE.CylinderGeometry(0.006, 0.006, 0.27, 6), u, 5.865, d + 0.02));
  }
  parts.push(at(THREE, new THREE.BoxGeometry(0.6, 0.22, 0.02), 0, 5.62, d + 0.02));
  root.add(bake(ctx, parts, ctx.brass));
}

// Setbacks: three stepped tiers with brass cornices and corner pinnacles.
function buildSetbacks(ctx: Ctx, root: Group): void {
  const { THREE } = ctx;
  const stone: BufferGeometry[] = [];
  const brass: BufferGeometry[] = [];
  const tiers: [number, number, number][] = [
    [10.4, 0.8, 2.0],
    [11.2, 0.7, 1.6],
    [11.9, 0.7, 1.2],
  ];
  for (const [y0, h, s] of tiers) {
    stone.push(at(THREE, new THREE.BoxGeometry(s, h, s), 0, y0 + h / 2, 0));
    brass.push(at(THREE, new THREE.BoxGeometry(s + 0.12, 0.06, s + 0.12), 0, y0 + h + 0.03, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * (s / 2 - 0.05);
        const pz = sz * (s / 2 - 0.05);
        brass.push(
          at(THREE, new THREE.BoxGeometry(0.12, 0.14, 0.12), px, y0 + h + 0.13, pz),
          at(THREE, new THREE.BoxGeometry(0.07, 0.14, 0.07), px, y0 + h + 0.27, pz),
        );
      }
    }
  }
  root.add(bake(ctx, stone, ctx.stone), bake(ctx, brass, ctx.brass));
}

type Crown = { lamps: MeshStandardMaterial[]; lampY: number[] };

// Crown: stepped brass core, four sunburst fans, slim spire and a ring of eight lamps.
function buildCrown(ctx: Ctx, root: Group, coreColor: Color, tracked: Material[]): Crown {
  const { THREE } = ctx;
  const brass: BufferGeometry[] = [
    at(THREE, new THREE.BoxGeometry(0.9, 0.3, 0.9), 0, 12.81, 0),
    at(THREE, new THREE.BoxGeometry(0.62, 0.3, 0.62), 0, 13.11, 0),
    at(THREE, new THREE.BoxGeometry(0.36, 0.3, 0.36), 0, 13.41, 0),
    at(THREE, new THREE.ConeGeometry(0.05, 0.64, 8), 0, 13.88, 0),
  ];
  root.add(bake(ctx, brass, ctx.brass));

  const blades: BufferGeometry[] = [];
  for (let face = 0; face < 4; face++) {
    const az = face * HALF;
    for (let i = 0; i < 9; i++) {
      const a = (-75 + i * 18.75) * DEG;
      const [x, y, z] = facePoint(az, Math.sin(a) * 0.3, 12.72 + Math.cos(a) * 0.3, 0.5);
      blades.push(at(THREE, new THREE.BoxGeometry(0.05, 0.5, 0.012), x, y, z, 0, az, -a));
    }
  }
  root.add(bake(ctx, blades, ctx.fan));

  const lamps: MeshStandardMaterial[] = [];
  const lampY: number[] = [];
  const lampGeometry = new THREE.SphereGeometry(0.035, 10, 8);
  for (let i = 0; i < LAMP_COUNT; i++) {
    const y = 12.85 + i * 0.15;
    const radius = y < 12.96 ? 0.47 : y < 13.26 ? 0.33 : y < 13.56 ? 0.2 : 0.08;
    const a = i * 2.4;
    const material = new THREE.MeshStandardMaterial({ color: coreColor, emissive: coreColor, emissiveIntensity: 0 });
    tracked.push(material);
    const lamp = new THREE.Mesh(lampGeometry, material);
    lamp.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
    root.add(lamp);
    lamps.push(material);
    lampY.push(y);
  }
  return { lamps, lampY };
}

type Elevator = { car: Group };

// Exterior elevator: two rails on the front-right corner and an open brass cage car.
function buildElevator(ctx: Ctx, root: Group): Elevator {
  const { THREE } = ctx;
  const rails: BufferGeometry[] = [];
  for (const [x, z] of [
    [1.18, 1.46],
    [1.46, 1.18],
  ] as const) {
    rails.push(at(THREE, new THREE.CylinderGeometry(0.02, 0.02, 8, 8), x, 6.4, z));
  }
  root.add(bake(ctx, rails, ctx.brass));

  const car = new THREE.Group();
  car.rotation.y = Math.PI / 4;
  const bars: BufferGeometry[] = [];
  for (const y of [-0.3, 0.3]) {
    bars.push(at(THREE, new THREE.BoxGeometry(0.5, 0.03, 0.03), 0, y, 0.25));
    bars.push(at(THREE, new THREE.BoxGeometry(0.5, 0.03, 0.03), 0, y, -0.25));
    bars.push(at(THREE, new THREE.BoxGeometry(0.03, 0.03, 0.5), 0.25, y, 0));
    bars.push(at(THREE, new THREE.BoxGeometry(0.03, 0.03, 0.5), -0.25, y, 0));
  }
  for (const [x, z] of [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
    [0, 0.25],
    [0, -0.25],
    [0.25, 0],
    [-0.25, 0],
  ] as const) {
    bars.push(at(THREE, new THREE.BoxGeometry(0.02, 0.6, 0.02), x, 0, z));
  }
  bars.push(at(THREE, new THREE.BoxGeometry(0.5, 0.02, 0.5), 0, -0.3, 0));
  car.add(bake(ctx, bars, ctx.brass));
  root.add(car);
  return { car };
}

// How far a projected point sits outside its allowed NDC box: <= 1 means inside.
function overshoot(v: Vector3, xLimit: number, yMax: number, yMin: number): number {
  return Math.max(Math.abs(v.x) / xLimit, v.y >= 0 ? v.y / yMax : -v.y / yMin);
}

async function mountScene(
  stage: HTMLDivElement,
  getLabels: () => (HTMLLIElement | null)[],
  getParts: () => Part[],
): Promise<SceneHandle> {
  const noop = (): void => undefined;
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return { dispose: noop, setHeroes: noop };
  }

  const created: { dispose: () => void }[] = [];
  let built: Object3D | null = null;
  try {
    const mobile = window.innerWidth < MOBILE_BREAKPOINT;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    const palette: Palette = {
      brass: readToken(THREE, "--color-accent"),
      stone: readToken(THREE, "--color-stone"),
      stoneHi: readToken(THREE, "--color-stone-hi"),
      core: readToken(THREE, "--color-core"),
      window: readToken(THREE, "--color-window"),
      windowOff: readToken(THREE, "--color-window-off"),
      ink: readToken(THREE, "--color-ink"),
      paper: readToken(THREE, "--color-paper"),
      paper2: readToken(THREE, "--color-paper-2"),
      paper3: readToken(THREE, "--color-paper-3"),
    };

    const noise = makeNoise(THREE);
    const fogTexture = makeFog(THREE);
    created.push(noise, fogTexture);
    const white = new THREE.Color(1, 1, 1);
    const brass = new THREE.MeshPhysicalMaterial({
      color: palette.brass,
      metalness: 1,
      roughness: 0.38,
      clearcoat: 0.2,
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
    const iron = new THREE.MeshStandardMaterial({ color: palette.paper2, roughness: 0.5, metalness: 0.6 });
    const street = new THREE.MeshPhysicalMaterial({ color: palette.paper3, roughness: 0.25, metalness: 0, clearcoat: 0.6 });
    const ground = new THREE.MeshBasicMaterial({ color: palette.paper, toneMapped: false });
    const lantern = new THREE.MeshStandardMaterial({ color: palette.window, emissive: palette.window, emissiveIntensity: LANTERN_GLOW });
    const portalGlow = new THREE.MeshStandardMaterial({ color: palette.window, emissive: palette.window, emissiveIntensity: PORTAL_GLOW });
    const windowLit = new THREE.MeshBasicMaterial({ color: white });
    const windowDark = new THREE.MeshStandardMaterial({ color: palette.windowOff, roughness: 0.3, metalness: 0.2 });
    const windowHero = new THREE.MeshBasicMaterial({ color: white });
    const fogMaterial = new THREE.SpriteMaterial({
      map: fogTexture,
      color: palette.ink,
      opacity: 0.12,
      transparent: true,
      depthWrite: false,
    });
    const tracked: Material[] = [brass, fan, stone, stoneHi, iron, street, ground, lantern, portalGlow, windowLit, windowDark, windowHero, fogMaterial];
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
    scene.fog = new THREE.FogExp2(palette.paper, 0.035);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnvironment, 0.04);
    disposeTree(roomEnvironment);
    created.push(pmrem, envTarget);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.35;

    const hemisphere = new THREE.HemisphereLight(palette.ink, palette.paper, 0.3);
    const key = new THREE.DirectionalLight(palette.ink, 1.6);
    key.position.set(-3, 6, 6);
    scene.add(hemisphere, key);

    const camera = new THREE.PerspectiveCamera(HERO_FOV, 1, 0.1, 80);

    const ctx: Ctx = {
      THREE,
      merge: mergeGeometries,
      brass,
      stone,
      stoneHi,
      iron,
      fan,
      street,
      ground,
      lantern,
      portalGlow,
      windowLit,
      windowDark,
      windowHero,
    };

    const root = new THREE.Group();
    scene.add(root);
    buildStreet(ctx, root, palette.window);
    buildBase(ctx, root);
    buildShaft(ctx, root);
    const windows = buildWindows(ctx, root, palette.window, palette.windowOff);
    const dial = buildDial(ctx, root);
    buildScaffold(ctx, root);
    buildSetbacks(ctx, root);
    const crown = buildCrown(ctx, root, palette.core, tracked);
    created.push(...crown.lamps);
    const elevator = buildElevator(ctx, root);

    const fogSprites: Sprite[] = [];
    const fogSpots: [number, number, number][] = [
      [-1.5, 0.9, 3.5],
      [1.8, 1.2, 2.2],
      [0.2, 0.7, 4.2],
    ];
    for (const [x, y, z] of fogSpots) {
      const sprite = new THREE.Sprite(fogMaterial);
      sprite.scale.set(6, 2.2, 1);
      sprite.position.set(x, y, z);
      root.add(sprite);
      fogSprites.push(sprite);
    }

    // Label anchors: one fixed object per station on the front face, chosen at build time so labels never jump.
    const anchors = {} as Record<PartKey, Object3D>;
    for (const k of KEYS) {
      const anchor = new THREE.Object3D();
      const [ax, ay, az] = ANCHOR_POS[k];
      anchor.position.set(ax, ay, az);
      root.add(anchor);
      anchors[k] = anchor;
    }
    const anchorFor = (k: PartKey, out: Vector3): void => {
      anchors[k].getWorldPosition(out);
    };

    const worldPosition = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const heroPos = new THREE.Vector3(14, 5, 25);
    const heroLook = new THREE.Vector3(0, 7, 0);
    const trackPos = new THREE.Vector3();
    const trackLook = new THREE.Vector3();
    const basePos = new THREE.Vector3();
    const baseLook = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const stageWeights: Record<PartKey, number> = { meta: 0, heroes: 0, builds: 0, matches: 0, profile: 0 };
    let width = 0;
    let height = 0;
    const labelSizes: { w: number; h: number }[] = [];
    let rafId = 0;
    let lastTime = 0;
    let visible = false;
    let disposed = false;
    let elapsed = 0;
    let pointerX = 0;
    let pointerClientX = 0;
    let pointerClientY = 0;
    let hasPointer = false;
    const yawSpring: Spring = { x: 0, v: 0 };
    const progressSpring: Spring = { x: 0, v: 0 };
    const carSpring: Spring = { x: CAR_MAX_Y, v: 0 };
    let idleYaw = 0;
    let yawTarget = 0;
    const labelList = stage.querySelector<HTMLElement>(".reliquary-labels");
    const tag = stage.querySelector<HTMLElement>(".reliquary-tag");
    // True while a label link is hovered or has focus: aim targets are held.
    const labelHeld = (): boolean => labelList !== null && (labelList.matches(":hover") || labelList.matches(":focus-within"));
    let lastMove = performance.now();
    let wideLayout = false;
    let dolly = 1;
    const exitState = { fade: 1 };
    const lampLevel: number[] = crown.lamps.map(() => 0);
    const lampReached: boolean[] = crown.lamps.map(() => false);
    let heroData: HeroWindow[] = [];
    let tagIndex = -1;
    let labelGate = 0;
    let clockMinute = -1;

    const tint = new THREE.Color();
    function setHeroes(rows: HeroWindow[]): void {
      heroData = rows.slice(0, HERO_COUNT);
      for (let i = 0; i < HERO_COUNT; i++) {
        const row = heroData[i];
        // No data means a dark window, never a fake-lit one.
        if (row) tint.copy(palette.window).multiplyScalar(winGlow(row.winRate));
        else tint.copy(palette.windowOff);
        windows.hero.setColorAt(i, tint);
      }
      if (windows.hero.instanceColor) windows.hero.instanceColor.needsUpdate = true;
    }

    function updateClock(): void {
      const now = new Date();
      const stamp = now.getHours() * 60 + now.getMinutes();
      if (stamp === clockMinute) return;
      clockMinute = stamp;
      const m = now.getMinutes();
      dial.minute.rotation.z = -(m / 60) * TAU;
      dial.hour.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * TAU;
    }
    updateClock();

    function setTag(index: number, rect: DOMRect): void {
      if (!tag) return;
      const row = index >= 0 ? heroData[index] : undefined;
      if (!row) {
        if (tag.dataset.show !== "false") tag.dataset.show = "false";
        tagIndex = -1;
        return;
      }
      if (index !== tagIndex) {
        tagIndex = index;
        tag.textContent = `${row.name}, ${(row.winRate * 100).toFixed(1).replace(".", ",")}% побед`;
      }
      tag.style.transform = `translate3d(${(pointerClientX - rect.left + TAG_OFFSET_PX).toFixed(1)}px, ${(pointerClientY - rect.top + TAG_OFFSET_PX).toFixed(1)}px, 0)`;
      if (tag.dataset.show !== "true") tag.dataset.show = "true";
    }

    function pickHeroWindow(): void {
      if (!finePointer || !tag) return;
      const rect = stage.getBoundingClientRect();
      const inside =
        hasPointer &&
        !labelHeld() &&
        heroData.length > 0 &&
        pointerClientX >= rect.left &&
        pointerClientX <= rect.right &&
        pointerClientY >= rect.top &&
        pointerClientY <= rect.bottom;
      if (!inside) {
        setTag(-1, rect);
        return;
      }
      ndc.set(((pointerClientX - rect.left) / rect.width) * 2 - 1, -(((pointerClientY - rect.top) / rect.height) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const id = raycaster.intersectObject(windows.hero, false)[0]?.instanceId;
      setTag(id !== undefined && heroData[id] !== undefined ? id : -1, rect);
    }

    const shouldRun = (): boolean => !disposed && visible && document.visibilityState === "visible";

    function schedule(): void {
      if (rafId === 0 && shouldRun()) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    }

    function applyLamps(camY: number, p: number, dt: number): void {
      crown.lamps.forEach((material, i) => {
        if (p < 0.003) lampReached[i] = false;
        else if (camY >= (crown.lampY[i] ?? 0) - 1) lampReached[i] = true;
        const target = lampReached[i] ? 1 : 0;
        const current = lampLevel[i] ?? 0;
        const next = target > current ? Math.min(target, current + dt / LAMP_FADE_S) : Math.max(target, current - dt / LAMP_FADE_S);
        lampLevel[i] = next;
        material.emissiveIntensity = LAMP_GLOW * next;
      });
    }

    function applyFog(): void {
      if (reduced) return;
      fogSprites.forEach((sprite, i) => {
        const base = fogSpots[i]?.[0] ?? 0;
        sprite.position.x = base + Math.sin((elapsed / FOG_DRIFT_S + i / fogSprites.length) * TAU) * 1.4;
      });
    }

    // Worst overshoot over the visible station anchors.
    function worstOvershoot(): number {
      let worst = 0;
      for (const part of getParts()) {
        const s = smoothstep(0.25, 0.6, stageWeights[part.key]);
        if (s <= 0.05) continue;
        anchorFor(part.key, probe);
        probe.project(camera);
        worst = Math.max(worst, overshoot(probe, CONTAIN_LABEL, CONTAIN_LABEL, CONTAIN_LABEL));
      }
      return worst;
    }

    function updateLabels(): void {
      const labels = getLabels();
      getParts().forEach((part, i) => {
        const item = labels[i];
        if (!item) return;
        const s = smoothstep(0.25, 0.6, stageWeights[part.key]) * labelGate;
        anchorFor(part.key, worldPosition);
        worldPosition.project(camera);
        const size = labelSizes[i] ?? { w: 0, h: 0 };
        const rawX = (worldPosition.x * 0.5 + 0.5) * width;
        const rawY = (-worldPosition.y * 0.5 + 0.5) * height;
        const x = clamp(rawX - size.w - LABEL_EDGE_PX, LABEL_EDGE_PX, Math.max(LABEL_EDGE_PX, width - size.w - LABEL_EDGE_PX));
        item.style.setProperty("--lead", `${Math.max(0, rawX - (x + size.w)).toFixed(1)}px`);
        const minY = LABEL_EDGE_PX;
        // Never hide or disable a label that is hovered or focused, so it cannot flicker out of reach.
        const keep = labelGate > 0 && item.matches(":hover, :focus-within");
        const rise = keep ? 0 : (1 - s) * LABEL_RISE_PX;
        const y = clamp(rawY - size.h / 2, minY, Math.max(minY, height - size.h - LABEL_EDGE_PX)) + rise;
        item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        item.style.opacity = (keep ? Math.max(s, 0.6) : s * exitState.fade).toFixed(3);
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

      const scroll = scrollProgress();
      stepSpring(progressSpring, scroll.p, SCROLL_STIFFNESS, SCROLL_DAMPING, dt);
      const pagePos = clamp(progressSpring.x, 0, 1);
      const p = stationProgress(pagePos, scroll.crown);
      // Labels stay hidden until the hero copy has fully scrolled above the header.
      const heroCopy = document.querySelector(".home-hero-copy");
      const headerEl = document.querySelector(".site-header");
      const heroCleared =
        heroCopy && headerEl
          ? heroCopy.getBoundingClientRect().bottom < headerEl.getBoundingClientRect().bottom
          : true;
      labelGate = pagePos < LABEL_HIDE_P || !heroCleared ? 0 : 1;
      // Pointer steering fades out once the track starts so labels stay put.
      const cursorInfluence = 1 - smoothstep(0.02, LABEL_HIDE_P, pagePos);

      // While a label link is hovered or focused, hold the aim target so nothing moves under the cursor.
      if (!labelHeld()) {
        if (!reduced) {
          if (now - lastMove > IDLE_DELAY_MS && cursorInfluence >= 1) idleYaw += IDLE_YAW_SPEED * dt;
          else idleYaw *= Math.exp(-dt * IDLE_YAW_DECAY);
        }
        yawTarget = pointerX * POINTER_YAW * cursorInfluence + (cursorInfluence >= 1 ? idleYaw : 0);
      }
      stepSpring(yawSpring, yawTarget, CURSOR_STIFFNESS, CURSOR_DAMPING, dt);
      root.rotation.set(0, yawSpring.x, 0);
      root.position.set(wideLayout ? lerp(WIDE_X, WIDE_X_TRACK, smoothstep(0, TRACK_START, p)) : 0, 0, 0);

      for (const k of KEYS) stageWeights[k] = stationWeight(p, k);

      // Camera: hero three-quarter view blends into the elevator track.
      const { camY, lookY } = trackHeights(p);
      const tt = clamp((p - TRACK_START) / (1 - TRACK_START), 0, 1);
      const az = lerp(AZ_START, AZ_END, tt);
      const dist = lerp(DIST_START, DIST_END, tt);
      trackPos.set(Math.sin(az) * dist, camY, Math.cos(az) * dist);
      trackLook.set(0, lookY, 0);
      const blend = easeInOutCubic(clamp(p / TRACK_START, 0, 1));
      basePos.copy(heroPos).lerp(trackPos, blend);
      baseLook.copy(heroLook).lerp(trackLook, blend);
      // Containment may only change the horizontal camera distance, never the height.
      const aim = (k: number): void => {
        camera.position.set(basePos.x * k, basePos.y, basePos.z * k);
        camera.lookAt(baseLook);
        camera.updateMatrixWorld();
      };

      // Elevator car: softer spring so it lags the camera and settles with a small sway.
      stepSpring(carSpring, clamp(basePos.y - CAR_BELOW, CAR_MIN_Y, CAR_MAX_Y), CAR_STIFFNESS, CAR_DAMPING, dt);
      const sway = reduced ? 0 : clamp(-carSpring.v * CAR_SWAY_GAIN, -CAR_SWAY_MAX, CAR_SWAY_MAX);
      elevator.car.position.set(1.32 + sway * Math.SQRT1_2, carSpring.x, 1.32 - sway * Math.SQRT1_2);

      applyLamps(basePos.y, p, dt);
      applyFog();
      updateClock();
      root.updateMatrixWorld(true);

      let scale = 1;
      if (p >= TRACK_START) {
        const maxScale = DIST_MAX / dist;
        aim(1);
        const first = worstOvershoot();
        if (first > 1) {
          scale = Math.min(first, maxScale);
          aim(scale);
        }
        for (let step = 0; step < CONTAIN_MAX_STEPS && scale < maxScale && worstOvershoot() > 1; step++) {
          scale = Math.min(scale + CONTAIN_STEP, maxScale);
          aim(scale);
        }
        dolly = Math.min(maxScale, Math.max(scale, dolly + (scale - dolly) * (1 - Math.exp(-dt * DOLLY_EASE))));
      } else {
        dolly = 1;
      }
      aim(dolly);

      pickHeroWindow();

      // Exit transition: while the sticky stage is released, the canvas fades into the dark.
      const layerBottom = stage.getBoundingClientRect().bottom;
      const out = clamp((window.innerHeight - layerBottom) / (window.innerHeight * EXIT_SPAN), 0, 1);
      const eased = out * out * out;
      exitState.fade = 1 - eased;
      canvas.style.opacity = eased === 0 ? "" : exitState.fade.toFixed(3);
      canvas.style.transform =
        eased === 0 || reduced ? "" : `translateY(${(-eased * EXIT_SHIFT_PX).toFixed(2)}px) scale(${(1 - eased * EXIT_SCALE).toFixed(4)})`;

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
      wideLayout = wide;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function onPointerMove(event: PointerEvent): void {
      pointerX = (event.clientX / window.innerWidth) * 2 - 1;
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

    const dispose = (): void => {
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
      fogTexture.dispose();
      windows.lit.dispose();
      windows.dark.dispose();
      windows.hero.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (tag) tag.dataset.show = "false";
      stage.dataset.live = "false";
    };
    return { dispose, setHeroes };
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

export function Tower({ parts }: { parts: Part[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLLIElement | null)[]>([]);
  const partsRef = useRef<Part[]>(parts);
  const handleRef = useRef<SceneHandle | null>(null);
  const stats = useHeroStats();

  // Real data only: while loading or on error the hero windows stay dark.
  const rows = useMemo<HeroWindow[]>(() => {
    if (stats.status !== "ready") return [];
    return [...stats.heroes]
      .sort((a, b) => b.win_rate - a.win_rate)
      .slice(0, HERO_COUNT)
      .map((hero) => ({ name: hero.name, winRate: hero.win_rate }));
  }, [stats.status, stats.heroes]);
  const rowsRef = useRef<HeroWindow[]>(rows);

  useEffect(() => {
    rowsRef.current = rows;
    handleRef.current?.setHeroes(rows);
  }, [rows]);

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
      .then((handle) => {
        if (cancelled) handle.dispose();
        else {
          teardown = handle.dispose;
          handleRef.current = handle;
          handle.setHeroes(rowsRef.current);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      handleRef.current = null;
      teardown?.();
    };
  }, []);

  return (
    <div className="reliquary-stage" ref={stageRef} data-live="false">
      <img className="reliquary-still" src="/reliquary-still.png" alt="Ар-деко небоскрёб статистики в ночном тумане" />
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
      <div className="reliquary-tag" aria-hidden="true" data-show="false" />
    </div>
  );
}
