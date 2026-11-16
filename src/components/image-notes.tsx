"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageNote } from "@/core/notes";
import { animateHeightChange } from "@/lib/height-motion";

export function ImageNotes({ notes, activeId }: { notes: ImageNote[]; activeId: string }) {
  const [displayed, setDisplayed] = useState(notes);
  const root = useRef<HTMLElement>(null);
  const previousHeight = useRef(0);
  const signature = JSON.stringify(notes);
  const currentIds = new Set(notes.map(note => note.id));
  useEffect(() => {
    setDisplayed(previous => [...notes, ...previous.filter(note => !notes.some(current => current.id === note.id))]);
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue("--motion-base").trim();
    const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0;
    const timer = setTimeout(() => setDisplayed(notes), duration);
    return () => clearTimeout(timer);
  }, [signature]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const height = element.getBoundingClientRect().height;
    const stop = animateHeightChange(element, previousHeight.current);
    previousHeight.current = height;
    return stop;
  }, [displayed]);
  return <section className="image-notes" ref={root} hidden={displayed.length === 0}>
    <h3>Notes</h3>
    {displayed.map((note, index) => <p key={note.id} id={`note-${note.id}`}
      className={`image-note ${activeId === note.id ? "active-note" : ""}`}
      data-exiting={!currentIds.has(note.id) || undefined} aria-hidden={!currentIds.has(note.id)}>
      {index + 1}. {note.text}
    </p>)}
  </section>;
}
