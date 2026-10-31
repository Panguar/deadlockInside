"use client";

import { useEffect, useRef } from "react";
import type { Color, Group, Material, Mesh, Object3D, Shape, Sphere, WebGLRenderer } from "three";
import "@/app/home/reliquary.css";

type ThreeLib = typeof import("three");

type PartKey = "crown" | "rays" | "gears" | "dial" | "plinth";
type Part = { key: PartKey; label: string; href: string };

type Palette = { brass: Color; patina: Color; bronze: Color; key: Color; cool: Color };
type Materials = { brass: Material; patina: Material; bronze: Material };

type ExtendedNavigator = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

type Spring = { x: number; v: number };

const PART_ORDER: readonly PartKey[] = ["crown", "rays", "gears", "dial", "plinth"];
const PART_BASE_Y: Record<PartKey, number> = { crown: 1.7, rays: 0.85, gears: 0, dial: -0.85, plinth: -1.7 };
// Explode offsets in world units, relative to each part's assembled position, at full progress.
const PART_EXPLODE: Record<PartKey, [number, number, number]> = {
  crown: [-1.5, 1.3, 0],
  rays: [0, 0.2, 0.3],
  gears: [1.8, 0.3, 0],
  dial: [-1.7, -0.9, 0.4],
  plinth: [1.4, -1.5, 0],
};
const PART_STAGGER = 0.07;
const PART_SPAN = 0.55;
const CAMERA_RADIUS = 10;
const CAMERA_RADIUS_GROWTH = 2.4;
const CAMERA_AZIMUTH = 0.22;
const CAMERA_FIT_LIMIT = 0.92;
const CAMERA_FIT_STEP = 0.3;
const CAMERA_FIT_MAX_STEPS = 6;
const RING_COUNTER_SPIN = 0.8;
const CAMERA_LOOK_Y = 0.2;
const TAU = Math.PI * 2;
const IDLE_DELAY_MS = 2500;
const IDLE_YAW_SPEED = 0.05;
const IDLE_YAW_DECAY = 2;
const CURSOR_STIFFNESS = 70;
const CURSOR_DAMPING = 0.85;
const SCROLL_STIFFNESS = 120;
const SCROLL_DAMPING = 1;
const MAX_DT = 1 / 30;
const LABEL_RISE_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

// Each part has its own slice of the scroll track.
function partProgress(p: number, index: number): number {
  return easeInOutCubic(clamp((p - index * PART_STAGGER) / PART_SPAN, 0, 1));
}

function shouldUseStill(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  const nav = navigator as ExtendedNavigator;
  if (nav.connection?.saveData) return true;
  if ((navigator.hardwareConcurrency ?? 8) <= 4 && (nav.deviceMemory ?? 8) <= 4) return true;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("webgl2");
  ctx?.getExtension("WEBGL_lose_context")?.loseContext();
  return ctx === null;
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

function place(mesh: Mesh, x: number, y: number, z: number): Mesh {
  mesh.position.set(x, y, z);
  return mesh;
}

function buildCrown(THREE: ThreeLib, m: Materials): Group {
  const group = new THREE.Group();
  group.name = "crown";
  for (const [width, y] of [
    [1.2, 0.1],
    [0.88, 0.3],
    [0.56, 0.5],
  ] as const) {
    group.add(place(new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, width), m.brass), 0, y, 0));
  }
  group.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.12, 0.5, 16), m.brass), 0, 0.85, 0));
  return group;
}

function buildRays(THREE: ThreeLib, m: Materials): Group {
  const group = new THREE.Group();
  group.name = "rays";
  group.add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.015, 12, 128), m.brass));
  const rayGeometry = new THREE.BoxGeometry(0.035, 0.45, 0.02);
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * TAU;
    const ray = new THREE.Mesh(rayGeometry, m.brass);
    ray.position.set(Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0);
    ray.rotation.z = angle - Math.PI / 2;
    group.add(ray);
  }
  return group;
}

function gearShape(THREE: ThreeLib, teeth: number, outer: number, inner: number, bore: number): Shape {
  const shape = new THREE.Shape();
  const steps = teeth * 4;
  for (let k = 0; k < steps; k++) {
    const angle = (k / steps) * TAU;
    const radius = k % 4 < 2 ? outer : inner;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, bore, 0, TAU, false);
  shape.holes.push(hole);
  return shape;
}

function buildGears(THREE: ThreeLib, m: Materials): Group {
  const group = new THREE.Group();
  group.name = "gears";
  const geometry = new THREE.ExtrudeGeometry(gearShape(THREE, 10, 0.5, 0.4, 0.12), {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -0.06);
  const left = place(new THREE.Mesh(geometry, m.patina), -0.41, 0, 0);
  const right = place(new THREE.Mesh(geometry, m.patina), 0.41, 0, 0);
  right.rotation.z = Math.PI / 10;
  group.add(left, right);
  return group;
}

function buildDial(THREE: ThreeLib, m: Materials): Group {
  const group = new THREE.Group();
  group.name = "dial";
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 64), m.patina);
  face.rotation.x = Math.PI / 2;
  group.add(face);
  group.add(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.03, 12, 96), m.brass));

  const majorTick = new THREE.BoxGeometry(0.015, 0.12, 0.02);
  const minorTick = new THREE.BoxGeometry(0.015, 0.06, 0.02);
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * TAU;
    const tick = new THREE.Mesh(i % 5 === 0 ? majorTick : minorTick, m.brass);
    tick.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0.035);
    tick.rotation.z = angle - Math.PI / 2;
    group.add(tick);
  }

  const needleGeometry = new THREE.BoxGeometry(0.03, 0.6, 0.02);
  needleGeometry.translate(0, 0.3, 0);
  const needle = place(new THREE.Mesh(needleGeometry, m.brass), 0, 0, 0.05);
  needle.rotation.z = -0.9;
  group.add(needle);
  return group;
}

function buildPlinth(THREE: ThreeLib, m: Materials): Group {
  const group = new THREE.Group();
  group.name = "plinth";
  for (const [width, y] of [
    [0.9, 0.18],
    [1.2, 0],
    [1.5, -0.18],
  ] as const) {
    group.add(place(new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, width), m.bronze), 0, y, 0));
  }
  return group;
}

async function mountScene(
  stage: HTMLDivElement,
  getLabels: () => (HTMLLIElement | null)[],
  getParts: () => Part[],
): Promise<() => void> {
  const noop = (): void => undefined;
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");

  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return noop;
  }

  const palette: Palette = {
    brass: readToken(THREE, "--color-accent"),
    patina: readToken(THREE, "--color-patina"),
    bronze: readToken(THREE, "--color-paper-3"),
    key: readToken(THREE, "--color-ink"),
    cool: readToken(THREE, "--color-patina-text"),
  };
  const brassMaterial = new THREE.MeshPhysicalMaterial({
    color: palette.brass,
    metalness: 1,
    roughness: 0.28,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
  });
  const patinaMaterial = new THREE.MeshPhysicalMaterial({ color: palette.patina, metalness: 0.55, roughness: 0.62 });
  patinaMaterial.color.multiplyScalar(0.55);
  const bronzeMaterial = new THREE.MeshPhysicalMaterial({ color: palette.bronze, metalness: 1, roughness: 0.4 });
  bronzeMaterial.color.multiplyScalar(1.4);
  const materials: Materials = {
    brass: brassMaterial,
    patina: patinaMaterial,
    bronze: bronzeMaterial,
  };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.classList.add("reliquary-canvas");
  canvas.setAttribute("aria-hidden", "true");
  stage.insertBefore(canvas, stage.querySelector(".reliquary-labels"));

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnvironment, 0.04);
  disposeTree(roomEnvironment);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.75;

  const keyLight = new THREE.DirectionalLight(palette.key, 2.8);
  keyLight.position.set(-3, 4, 5);
  const fillLight = new THREE.DirectionalLight(palette.cool, 0.35);
  fillLight.position.set(4, -1, 3);
  const rimLight = new THREE.DirectionalLight(palette.key, 1.6);
  rimLight.position.set(0, 2, -5);
  scene.add(keyLight, fillLight, rimLight);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.6, CAMERA_RADIUS);

  const root = new THREE.Group();
  scene.add(root);
  const groups: Record<PartKey, Group> = {
    crown: buildCrown(THREE, materials),
    rays: buildRays(THREE, materials),
    gears: buildGears(THREE, materials),
    dial: buildDial(THREE, materials),
    plinth: buildPlinth(THREE, materials),
  };
  for (const key of PART_ORDER) root.add(groups[key]);

  // Bounding spheres in each group's local space (groups sit at identity here).
  const bounds = {} as Record<PartKey, Sphere>;
  for (const key of PART_ORDER) {
    bounds[key] = new THREE.Box3().setFromObject(groups[key]).getBoundingSphere(new THREE.Sphere());
  }

  // True when every part's sphere centre and centre +- radius (camera right/up) projects inside the frame.
  const fitsViewport = (): boolean => {
    const scale = root.scale.x;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    for (const key of PART_ORDER) {
      const sphere = bounds[key];
      const r = sphere.radius * scale;
      const centre = sphere.center.clone().applyMatrix4(groups[key].matrixWorld);
      const probes = [
        centre,
        centre.clone().addScaledVector(right, r),
        centre.clone().addScaledVector(right, -r),
        centre.clone().addScaledVector(up, r),
        centre.clone().addScaledVector(up, -r),
      ];
      for (const probe of probes) {
        probe.project(camera);
        if (Math.abs(probe.x) > CAMERA_FIT_LIMIT || Math.abs(probe.y) > CAMERA_FIT_LIMIT) return false;
      }
    }
    return true;
  };

  const worldPosition = new THREE.Vector3();
  let width = 0;
  let height = 0;
  let rafId = 0;
  let lastTime = 0;
  let visible = false;
  let disposed = false;
  let pointerX = 0;
  let pointerY = 0;
  const yawSpring: Spring = { x: 0, v: 0 };
  const pitchSpring: Spring = { x: 0, v: 0 };
  const progressSpring: Spring = { x: 0, v: 0 };
  let idleYaw = 0;
  let lastMove = performance.now();
  let baseX = 0;
  let baseY = 0;
  let baseScale = 1;

  const shouldRun = (): boolean => !disposed && visible && document.visibilityState === "visible";

  function schedule(): void {
    if (rafId === 0 && shouldRun()) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function updateLabels(p: number): void {
    const labels = getLabels();
    getParts().forEach((part, i) => {
      const item = labels[i];
      if (!item) return;
      const s = smoothstep(0.35, 0.7, partProgress(p, i));
      groups[part.key].getWorldPosition(worldPosition);
      worldPosition.project(camera);
      const x = (worldPosition.x * 0.5 + 0.5) * width;
      const y = (-worldPosition.y * 0.5 + 0.5) * height + (1 - s) * LABEL_RISE_PX;
      item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      item.style.opacity = s.toFixed(3);
      item.style.pointerEvents = s > 0.05 ? "auto" : "none";
      item.style.visibility = s < 0.05 ? "hidden" : "visible";
    });
  }

  function frame(now: number): void {
    rafId = 0;
    if (!shouldRun()) return;
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;

    // Idle yaw never snaps: it decays while the pointer is active and only grows after idle.
    if (now - lastMove > IDLE_DELAY_MS) idleYaw += IDLE_YAW_SPEED * dt;
    else idleYaw *= Math.exp(-dt * IDLE_YAW_DECAY);

    stepSpring(yawSpring, pointerX * 0.35 + idleYaw, CURSOR_STIFFNESS, CURSOR_DAMPING, dt);
    stepSpring(pitchSpring, pointerY * 0.12, CURSOR_STIFFNESS, CURSOR_DAMPING, dt);
    root.rotation.set(pitchSpring.x, yawSpring.x, 0);

    const raw = scrollProgress();
    stepSpring(progressSpring, raw, SCROLL_STIFFNESS, SCROLL_DAMPING, dt);
    const p = clamp(progressSpring.x, 0, 1);

    root.position.set(baseX, baseY + (raw <= 0 ? window.scrollY * 0.0012 : 0), 0);
    root.scale.setScalar(baseScale);

    PART_ORDER.forEach((key, i) => {
      const local = partProgress(p, i);
      const [dx, dy, dz] = PART_EXPLODE[key];
      groups[key].position.set(dx * local, PART_BASE_Y[key] + dy * local, dz * local);
    });

    const eased = easeInOutCubic(p);
    const azimuth = CAMERA_AZIMUTH * eased;
    // Ring and dial counter the camera orbit so their faces keep pointing at the viewer.
    groups.rays.rotation.y = -azimuth * RING_COUNTER_SPIN;
    groups.dial.rotation.y = -azimuth * RING_COUNTER_SPIN;
    root.updateMatrixWorld(true);

    let radius = CAMERA_RADIUS + CAMERA_RADIUS_GROWTH * eased;
    const aimCamera = (): void => {
      camera.position.set(Math.sin(azimuth) * radius, 0.6, Math.cos(azimuth) * radius);
      camera.lookAt(0, CAMERA_LOOK_Y * eased, 0);
      camera.updateMatrixWorld();
    };
    aimCamera();
    // Pull back until every part stays inside the viewport (bounded retries).
    for (let step = 0; step < CAMERA_FIT_MAX_STEPS && !fitsViewport(); step++) {
      radius += CAMERA_FIT_STEP;
      aimCamera();
    }

    renderer.render(scene, camera);
    updateLabels(p);
    if (stage.dataset.live !== "true") stage.dataset.live = "true";
    rafId = requestAnimationFrame(frame);
  }

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    width = w;
    height = h;
    const wide = w >= 960;
    baseX = wide ? 1.35 : 0;
    baseY = wide ? 0 : 0.4;
    baseScale = wide ? 1 : 0.8;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = -((event.clientY / window.innerHeight) * 2 - 1);
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
    envTarget.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    stage.dataset.live = "false";
  };
}

export function Reliquary({ parts }: { parts: Part[] }) {
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
      <img
        className="reliquary-still"
        src="/reliquary-still.png"
        alt="Латунный реликварий в стиле ар-деко"
      />
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
