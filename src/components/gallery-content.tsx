"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Bridges the mounted gallery and its empty state without delaying interactions. */
export function GalleryContent({ empty, children }: { empty: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(empty);
  useLayoutEffect(() => {
    if (previous.current === empty) return;
    previous.current = empty;
    const element = root.current;
    if (!element || typeof element.animate !== "function") return;
    const tokens = getComputedStyle(document.documentElement);
    const value = tokens.getPropertyValue("--motion-base").trim();
    const duration = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration, easing: tokens.getPropertyValue("--ease-out").trim(),
    });
    void animation.finished.catch(() => {});
    return () => animation.cancel();
  }, [empty]);
  return <div ref={root} className="gallery-content">{children}</div>;
}
