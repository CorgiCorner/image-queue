import { isMotionReduced } from "./motion";

export function navigationPositions(root: ParentNode = document): Map<string, DOMRect> {
  return new Map([...root.querySelectorAll<HTMLElement>("[data-navigation-id]")]
    .map(row => [row.dataset.navigationId!, row.getBoundingClientRect()]));
}

export function animateNavigation(before: Map<string, DOMRect>, root: ParentNode = document): () => void {
  if (isMotionReduced()) return () => {};
  const style = getComputedStyle(document.documentElement);
  const raw = style.getPropertyValue("--motion-base").trim();
  const animations: Animation[] = [];
  for (const row of root.querySelectorAll<HTMLElement>("[data-navigation-id]")) {
    const old = before.get(row.dataset.navigationId!);
    if (!old || typeof row.animate !== "function") continue;
    const next = row.getBoundingClientRect();
    if (!next.width || next.bottom < 0 || next.top > innerHeight) continue;
    const x = old.left - next.left, y = old.top - next.top;
    if (!x && !y) continue;
    const animation = row.animate([{transform:`translate(${x}px, ${y}px)`},{transform:"none"}], {
      duration: Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0,
      easing: style.getPropertyValue("--ease-out").trim(),
    });
    void animation.finished.catch(() => {});
    animations.push(animation);
  }
  return () => animations.forEach(animation => animation.cancel());
}
