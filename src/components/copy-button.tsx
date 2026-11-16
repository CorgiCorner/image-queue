"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { Button } from "./ui/button";

export function CopyButton({ value, label, children, copiedChildren, onSuccess, onError, disabled, variant = "ghost", size = "icon", className }: {
  value: string;
  label: string;
  children?: React.ReactNode;
  /** Visible text while the check mark shows; the accessible name stays `label`. */
  copiedChildren?: React.ReactNode;
  onSuccess: () => void;
  onError: () => void;
  variant?: "ghost" | "outline";
  size?: "icon" | "sm" | "default";
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setCopied(false);
    return () => { revision.current++; clearTimeout(timer.current); };
  }, [value]);
  return <Button variant={variant} size={size} className={className} disabled={disabled} aria-label={label} onClick={async () => {
    const current = ++revision.current;
    try {
      await navigator.clipboard.writeText(value);
      if (current !== revision.current) return;
      clearTimeout(timer.current);
      setCopied(true);
      onSuccess();
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      if (current !== revision.current) return;
      clearTimeout(timer.current);
      setCopied(false);
      onError();
    }
  }}>
    <span className="copy-button-icon" data-copied={copied || undefined} aria-hidden="true">
      <Copy size={16} /><Check size={16} />
    </span>
    {children && <span className="copy-button-label">{copied && copiedChildren ? copiedChildren : children}</span>}
  </Button>;
}
