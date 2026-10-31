"use client";

import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  value: number;
  format: (value: number) => string;
  className?: string;
};

const DURATION_MS = 400;

// Renders the final value on the server and without JS. On first view it rolls
// from 0 to the value once. The accessible text is always the final value.
export function CountUp({ value, format, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    setShown(null);
    const el = ref.current;
    if (!el || !document.documentElement.classList.contains("js")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / DURATION_MS, 1);
        if (t >= 1) {
          setShown(null);
          return;
        }
        setShown(value * (1 - Math.pow(1 - t, 3)));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          run();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  const finalText = format(value);
  return (
    <span ref={ref} className={className ? `count-up ${className}` : "count-up"}>
      <span aria-hidden="true">{shown === null ? finalText : format(shown)}</span>
      <span className="visually-hidden">{finalText}</span>
    </span>
  );
}
