const activeHeightAnimations = new WeakMap<HTMLElement, { marker: symbol; overflow: string }>();

/** Expand a surface to its already-rendered height; never delay input or submission. */
export function animateHeightChange(element: HTMLElement, previousHeight: number): () => void {
  const height = element.getBoundingClientRect().height;
  if (!previousHeight || !height || previousHeight === height || typeof element.animate !== "function") return () => {};
  const tokens = getComputedStyle(document.documentElement);
  if (tokens.getPropertyValue("--motion-reduced").trim() === "1") return () => {};
  const raw = tokens.getPropertyValue("--motion-base").trim();
  const duration = Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0;
  const marker = Symbol();
  const previousOverflow = activeHeightAnimations.get(element)?.overflow ?? element.style.overflow;
  activeHeightAnimations.set(element, { marker, overflow: previousOverflow });
  element.style.overflow = "clip";
  const restoreOverflow = () => {
    if (activeHeightAnimations.get(element)?.marker !== marker) return;
    activeHeightAnimations.delete(element);
    element.style.overflow = previousOverflow;
  };
  const animation = element.animate([{ height: `${previousHeight}px` }, { height: `${height}px` }], {
    duration, easing: tokens.getPropertyValue("--ease-move").trim(),
  });
  void animation.finished.then(restoreOverflow, restoreOverflow);
  return () => { animation.cancel(); restoreOverflow(); };
}
