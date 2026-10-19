"use client";

import { useState, type ReactNode } from "react";

export function ImageWithFallback({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return <span className={`${className} image-fallback`} role="img" aria-label={alt}>{fallback}</span>;
  }
  return <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />;
}
