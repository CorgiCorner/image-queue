import type { Rectangle } from "@/core/layout";
import { isMotionReduced } from "./motion";

/** Animate only explicit collection changes; virtualized scrolling never enters here. */
export function animateGalleryChange(root: HTMLElement, previous: readonly Rectangle[], next: readonly Rectangle[], layoutChanged: boolean, insertedOrRestored = false, retained = false): () => void {
  if (typeof root.animate !== "function") return () => {};
  const styles = getComputedStyle(document.documentElement);
  const reduced = isMotionReduced();
  const token = (name: string) => styles.getPropertyValue(name).trim();
  const duration = (name: string) => {
    const value = token(name);
    return Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
  };
  // Computed styles are live. Read every token before animate() invalidates styles.
  const fadeOptions = { duration: duration("--motion-base"), easing: token("--ease-out") };
  const moveOptions = { duration: duration(insertedOrRestored || !layoutChanged ? "--motion-base" : "--motion-slow"), easing: token("--ease-move") };
  const fallbackOptions = { duration: duration("--motion-fast"), easing: fadeOptions.easing };
  const cards = [...root.querySelectorAll<HTMLElement>(".virtual-card")];
  const animations: Animation[] = [];
  const before = new Map(previous.map(rect => [rect.id, rect]));
  const after = new Map(next.map(rect => [rect.id, rect]));
  // Archive, trash or restore out of the current view: the leaving cards already faded out, so neighbours
  // close the gap. Fading the whole gallery in from zero here would blink every card (follow-up 08, 4.3).
  // Only an explicit retention action counts; a narrowing filter keeps its single fade.
  const removedOnly = retained && !layoutChanged && !insertedOrRestored && next.length < previous.length && next.every(rect => before.has(rect.id));
  if (removedOnly && (reduced || cards.length > 60)) return () => {};
  if (!reduced && (layoutChanged || insertedOrRestored || removedOnly) && cards.length <= 60) {
    for (const card of cards) {
      const id = card.dataset.jobId;
      const old = id && before.get(id), current = id && after.get(id);
      if (!current) continue;
      if (!old) {
        if (insertedOrRestored) animations.push(card.animate([{opacity:0},{opacity:1}], fadeOptions));
        continue;
      }
      const dx = old.x - current.x, dy = old.y - current.y;
      if (!dx && !dy) continue;
      const frames = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }];
      animations.push(card.animate(frames, moveOptions));
      const checkbox = card.previousElementSibling;
      if (checkbox instanceof HTMLElement) animations.push(checkbox.animate(frames, moveOptions));
    }
  } else {
    animations.push(root.animate([{ opacity: 0 }, { opacity: 1 }], fallbackOptions));
  }
  animations.forEach(animation => { void animation.finished?.catch(() => {}); });
  return () => animations.forEach(animation => animation.cancel());
}
