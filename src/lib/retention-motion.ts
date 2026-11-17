import { isMotionReduced } from "./motion";

/** Fades out the cards a retention operation moves; the caller removes them when it resolves. */
export async function animateRetainedCards(ids: readonly string[], root: ParentNode = document): Promise<() => void> {
  const wanted = new Set(ids);
  const cards = [...root.querySelectorAll<HTMLElement>(".virtual-card[data-job-id]")].filter(card => wanted.has(card.dataset.jobId!));
  const tokens = getComputedStyle(document.documentElement);
  const value = tokens.getPropertyValue("--motion-fast").trim();
  const duration = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
  const scale = isMotionReduced() ? "1" : tokens.getPropertyValue("--motion-scale-in").trim() || "1";
  const animations = cards.filter(card => typeof card.animate === "function").map(card => card.animate([
    { opacity: 1, transform: "scale(1)" },
    { opacity: 0, transform: `scale(${scale})` },
  ], {duration, fill: "forwards", easing: tokens.getPropertyValue("--ease-in").trim()}));
  await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  return () => animations.forEach(animation => animation.cancel());
}
