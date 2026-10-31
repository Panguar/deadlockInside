"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

function readNavHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--nav-height");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 64;
}

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    let frame = 0;

    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!anchor) return;
      let id: string;
      try {
        id = decodeURIComponent(anchor.getAttribute("href")!.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const element = document.getElementById(id);
      if (!element) return;
      event.preventDefault();
      lenis.scrollTo(element, { offset: -readNavHeight() });
      window.history.replaceState(null, "", `#${id}`);
    };

    document.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick);
      lenis.destroy();
    };
  }, []);

  return null;
}
