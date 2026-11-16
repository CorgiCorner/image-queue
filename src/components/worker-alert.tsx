"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Clock } from "@phosphor-icons/react";
import Link from "next/link";
import { buttonVariants } from "./ui/button";
import { ChangingLabel } from "./changing-label";

export function WorkerAlert({ enabled, unavailable, message, manageHref, instantHeight = false }: {
  enabled: boolean;
  unavailable: boolean;
  message: string;
  instantHeight?: boolean;
  manageHref: string;
}) {
  const [retained, setRetained] = useState(enabled && unavailable);
  const [retainedMessage, setRetainedMessage] = useState(message);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (enabled && unavailable) setRetainedMessage(message);
  }, [enabled, unavailable, message]);
  useLayoutEffect(() => {
    if (!enabled) { setRetained(false); return; }
    if (unavailable) { setRetained(true); return; }
    if (!retained) return;
    const element = root.current;
    if (!element || typeof element.animate !== "function") { setRetained(false); return; }
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue("--motion-base").trim();
    const animation = element.animate([{opacity:1},{opacity:0}], {
      duration:Number.parseFloat(raw)*(raw.endsWith("ms")?1:1000)||0,
      easing:tokens.getPropertyValue("--ease-out").trim(), fill:"forwards",
    });
    let cancelled = false;
    void animation.finished.then(() => { if (!cancelled) setRetained(false); }, () => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [enabled, unavailable, retained]);
  if (!enabled || (!unavailable && !retained)) return null;
  return <div className="worker-alert-region" data-open={unavailable || undefined} data-instant-height={instantHeight || undefined}><div className="worker-alert-clip">
    <div ref={root} className="composer-alert" role="note" aria-hidden={!unavailable} inert={!unavailable}>
    <Clock size={16} /><ChangingLabel value={unavailable ? message : retainedMessage} />
    <Link className={buttonVariants({variant:"secondary",size:"sm"})} href={manageHref} prefetch>Manage workers</Link>
    </div>
  </div></div>;
}
