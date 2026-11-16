"use client";

import { useLayoutEffect, useRef } from "react";
import { animateHeightChange } from "@/lib/height-motion";

export function ExpandablePrompt({ text, expanded }: { text: string; expanded: boolean }) {
  const root = useRef<HTMLParagraphElement>(null);
  const previous = useRef<{ text: string; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const before = previous.current;
    previous.current = { text, height: element.getBoundingClientRect().height };
    if (!before || before.text !== text) return;
    return animateHeightChange(element, before.height);
  }, [text, expanded]);
  return <p ref={root} className={expanded ? "" : "prompt-clamped"}>{text}</p>;
}
