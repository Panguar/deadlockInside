"use client";

import { useCallback, useRef } from "react";

// One shared observer for every reveal target on the page. Adds `is-in` once.
//
// Targets are clipped (`clip-path: inset(0 0 100%)`) until revealed, which makes
// IntersectionObserver report zero intersection for the target itself. So we
// observe an unclipped proxy (the target's parent) and reveal the targets mapped
// to it. A proxy may map to several targets.
let shared: IntersectionObserver | null = null;
const proxyToTargets = new WeakMap<Element, Set<Element>>();
const targetToProxy = new WeakMap<Element, Element>();

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!shared) {
    shared = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const proxy = entry.target;
          const targets = proxyToTargets.get(proxy);
          if (targets) {
            for (const target of targets) {
              target.classList.add("is-in");
              targetToProxy.delete(target);
            }
            proxyToTargets.delete(proxy);
          }
          shared?.unobserve(proxy);
        }
      },
      { threshold: 0.15 },
    );
  }
  return shared;
}

function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

function detach(el: Element) {
  const proxy = targetToProxy.get(el);
  if (!proxy) return;
  targetToProxy.delete(el);
  const targets = proxyToTargets.get(proxy);
  if (!targets) return;
  targets.delete(el);
  if (targets.size === 0) {
    proxyToTargets.delete(proxy);
    shared?.unobserve(proxy);
  }
}

// Callback ref: works when the element mounts late, is swapped, or is removed.
export function useReveal<T extends Element>() {
  const elRef = useRef<T | null>(null);

  const ref = useCallback((el: T | null) => {
    const prev = elRef.current;
    const observer = getObserver();
    if (prev && prev !== el) detach(prev);
    elRef.current = el;
    if (!el) return;

    if (!observer || reducedMotion()) {
      el.classList.add("is-in");
      return;
    }

    // Safety net: already on screen at observe time, so reveal on the next frame.
    if (inViewport(el)) {
      requestAnimationFrame(() => el.classList.add("is-in"));
    }

    // Observe an unclipped proxy; the target is revealed when the proxy intersects.
    const proxy = el.parentElement ?? el;
    let targets = proxyToTargets.get(proxy);
    if (!targets) {
      targets = new Set();
      proxyToTargets.set(proxy, targets);
    }
    targets.add(el);
    targetToProxy.set(el, proxy);
    observer.observe(proxy);
  }, []);

  return ref;
}
