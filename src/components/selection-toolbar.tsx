"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Replaces filters with actions without pulling the gallery up under the pointer. */
export function SelectionToolbar({ selected, children }: { selected: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const normalHeight = useRef(0);
  const previous = useRef(selected);
  useLayoutEffect(() => {
    if (selected || !root.current) return;
    const element = root.current;
    const measure = () => { normalHeight.current = element.getBoundingClientRect().height; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (selected && normalHeight.current) element.style.minHeight = `${normalHeight.current}px`;
    else {
      element.style.removeProperty("min-height");
      normalHeight.current = element.getBoundingClientRect().height;
    }
    if (previous.current === selected) return;
    previous.current = selected;
    if (typeof element.animate !== "function") return;
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue("--motion-base").trim();
    const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0;
    const shift = tokens.getPropertyValue("--motion-shift").trim() || "0px";
    const animation = element.animate([
      { opacity: 0, transform: `translateY(${shift})` },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration, easing: tokens.getPropertyValue("--ease-out").trim() });
    void animation.finished.catch(() => {});
    return () => animation.cancel();
  }, [selected]);
  return <div ref={root} className={`toolbar ${selected ? "selection-toolbar" : ""}`}>{children}</div>;
}
