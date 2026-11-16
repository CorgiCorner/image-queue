import { isMotionReduced } from "./motion";

type Box = { left: number; top: number; width: number; height: number };
/** The picture of the given aspect ratio drawn inside the box (object-fit: contain), centred. */
function contain(box: Box, aspect: number): Box {
  const wide = box.width / box.height > aspect;
  const width = wide ? box.height * aspect : box.width;
  const height = wide ? box.height : box.width / aspect;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * The layout changes immediately; only the image's visual transform catches up. The stage box and the
 * picture drawn in it can have different proportions, so the transform maps the drawn picture with one
 * uniform scale; scaling the box on each axis separately would stretch the picture (follow-up 08, 4.5).
 */
export function animateImageZoom(image: HTMLElement, before: DOMRect, aspect?: number): () => void {
  const after = image.getBoundingClientRect();
  if (isMotionReduced() || !before.width || !before.height || !after.width || !after.height || typeof image.animate !== "function") return () => {};
  const ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : after.width / after.height;
  const from = contain(before, ratio), to = contain(after, ratio);
  const scale = from.width / to.width;
  const x = from.left - after.left - scale * (to.left - after.left);
  const y = from.top - after.top - scale * (to.top - after.top);
  const tokens = getComputedStyle(document.documentElement);
  const value = tokens.getPropertyValue("--motion-base").trim();
  const animation = image.animate([
    { transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${scale})` },
    { transformOrigin: "0 0", transform: "none" },
  ], {
    duration: Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0,
    easing: tokens.getPropertyValue("--ease-move").trim(),
  });
  return () => animation.cancel();
}
