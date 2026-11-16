"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { isMotionReduced } from "@/lib/motion";

export function ReferenceStrip({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { left: number; top: number; snapshot: HTMLElement }>());
  const active = useRef<Animation[]>([]);
  const signature = JSON.stringify(ids);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    active.current.forEach(animation => animation.cancel());
    element.querySelectorAll('[data-exiting-reference]').forEach(node => node.remove());
    const style = getComputedStyle(document.documentElement);
    const duration = (name: string) => {
      const value = style.getPropertyValue(name).trim();
      return Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
    };
    const reduced = isMotionReduced();
    const next = new Map<string, { left: number; top: number; snapshot: HTMLElement }>();
    const animations: Animation[] = [];
    const play = (node: HTMLElement, frames: Keyframe[], token: string) => {
      if (typeof node.animate !== "function") return undefined;
      const animation = node.animate(frames, {duration:duration(token),easing:style.getPropertyValue("--ease-out").trim()});
      void animation.finished.catch(() => {});
      animations.push(animation);
      return animation;
    };
    for (const node of element.querySelectorAll<HTMLElement>(':scope > [data-reference-id]')) {
      const id = node.dataset.referenceId!;
      const old = previous.current.get(id);
      const left = node.offsetLeft, top = node.offsetTop;
      if (!old) {
        const scale = reduced ? "1" : style.getPropertyValue("--motion-reference-scale").trim() || "1";
        play(node, [{opacity:0,transform:`scale(${scale})`},{opacity:1,transform:"scale(1)"}], "--motion-fast");
      } else if (!reduced && (old.left !== left || old.top !== top)) {
        play(node,[{transform:`translate(${old.left-left}px, ${old.top-top}px)`},{transform:"translate(0, 0)"}],"--motion-fast");
      }
      next.set(id,{left,top,snapshot:node.cloneNode(true) as HTMLElement});
    }
    for (const [id, old] of previous.current) {
      if (next.has(id)) continue;
      const ghost = old.snapshot;
      ghost.removeAttribute("data-reference-id");
      ghost.setAttribute("data-exiting-reference", "");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      Object.assign(ghost.style,{position:"absolute",width:"50px",left:`${old.left}px`,top:`${old.top}px`,pointerEvents:"none"});
      element.append(ghost);
      const animation = play(ghost,[{opacity:1},{opacity:0}],"--motion-instant");
      if (animation) void animation.finished.then(()=>ghost.remove(),()=>ghost.remove());
      else ghost.remove();
    }
    previous.current = next;
    active.current = animations;
  }, [signature]);
  useLayoutEffect(() => () => active.current.forEach(animation => animation.cancel()), []);
  return <div className="reference-strip" ref={root}>{children}</div>;
}
