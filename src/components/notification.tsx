"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "./ui/button";

/** A single replaceable notification; replacement preserves hover/focus and resets its lifetime. */
export function Notification({ message, action, onDismiss }: {
  message: string;
  action?: ReactNode;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [closing, setClosing] = useState(false);
  const remaining = useRef(action ? 8000 : 4000);
  const dismiss = useRef(onDismiss);
  const element = useRef<HTMLDivElement>(null);
  dismiss.current = onDismiss;
  const previousMessage = useRef(message);
  const timedMessage = useRef(message);
  useLayoutEffect(() => {
    if (previousMessage.current === message) return;
    previousMessage.current = message;
    setClosing(false);
    const label = element.current?.querySelector<HTMLElement>(".toast-message");
    if (!label || typeof label.animate !== "function") return;
    const style = getComputedStyle(document.documentElement);
    const raw = style.getPropertyValue("--motion-fast").trim();
    const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0;
    const animation = label.animate([{opacity:0},{opacity:1}], {duration,easing:style.getPropertyValue("--ease-out").trim()});
    void animation.finished.catch(() => {});
    return () => animation.cancel();
  }, [message]);

  useEffect(() => {
    if (timedMessage.current !== message) {
      timedMessage.current = message;
      remaining.current = action ? 8000 : 4000;
    }
    if (hovered || focused || closing) return;
    const started = Date.now();
    const timer = setTimeout(() => setClosing(true), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [hovered, focused, closing, message, Boolean(action)]);

  useEffect(() => {
    if (!closing || timedMessage.current !== message) return;
    // Use the computed token duration, including the reduced-motion override.
    const duration = element.current ? getComputedStyle(element.current).transitionDuration.split(",")[0] : "0s";
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    const timer = setTimeout(() => dismiss.current(), Number.isFinite(milliseconds) ? milliseconds : 0);
    return () => clearTimeout(timer);
  }, [closing, message]);

  return <div ref={element} className="toast" role="status" data-closing={closing || undefined}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <span className="toast-message">{message}</span>
    {action}
    <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setClosing(true)}><X size={14} /></Button>
  </div>;
}
