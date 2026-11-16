"use client";

import { useLayoutEffect, useRef } from "react";

/** Fades only the label; sibling progress indicators keep their animation phase. */
export function ChangingLabel({ value }: { value: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const element = root.current;
    if (!element || typeof element.animate !== "function") return;
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue("--motion-fast").trim();
    const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration, easing: tokens.getPropertyValue("--ease-out").trim(),
    });
    void animation.finished.catch(() => {});
    return () => animation.cancel();
  }, [value]);
  return <span ref={root}>{value}</span>;
}
