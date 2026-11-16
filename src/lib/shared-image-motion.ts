import { isMotionReduced } from "./motion";

const activeFlights = new WeakMap<Document, () => void>();

/**
 * A temporary, non-interactive image connects a visible tile to its preview. The preview stage stays
 * hidden while the copy flies, so the picture is never drawn twice; after an opening flight the copy
 * fades out over the full file, which then shows in place (follow-up 08, 4.5).
 */
export function openSharedImage(target: HTMLElement, source: HTMLImageElement, closing = false): () => void {
  const owner = target.ownerDocument;
  activeFlights.get(owner)?.();
  if (isMotionReduced() || typeof target.animate !== "function") return () => {};
  const from = source.getBoundingClientRect(), bounds = target.getBoundingClientRect();
  const to = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  const dialog = target.closest<HTMLElement>("[data-slot=dialog-content]");
  if (dialog && typeof DOMMatrixReadOnly !== "undefined") {
    const dialogStyle = getComputedStyle(dialog);
    const transform = dialogStyle.transform;
    const matrix = transform === "none" ? null : new DOMMatrixReadOnly(transform);
    const individualScale = Number.parseFloat(dialogStyle.scale) || 1;
    const scaleX = (matrix?.a ?? 1) * individualScale;
    const scaleY = (matrix?.d ?? 1) * individualScale;
    if (scaleX > 0 && scaleY > 0) {
      const box = dialog.getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      to.left = cx + (bounds.left - cx) / scaleX;
      to.top = cy + (bounds.top - cy) / scaleY;
      to.width /= scaleX;
      to.height /= scaleY;
    }
  }
  if (!from.width || !from.height || !to.width || !to.height || from.bottom <= 0 || from.top >= innerHeight || from.right <= 0 || from.left >= innerWidth) return () => {};
  const tokens = getComputedStyle(document.documentElement);
  const ms = (name: string) => { const raw = tokens.getPropertyValue(name).trim(); return Number.parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000) || 0; };
  const duration = ms(closing ? "--motion-base" : "--motion-slow");
  const reveal = ms("--motion-fast");
  const easing = tokens.getPropertyValue("--ease-out").trim();
  const image = document.createElement("img");
  image.src = source.currentSrc || source.src;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.className = "shared-image-flight";
  Object.assign(image.style, {
    left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
  });
  document.body.append(image);
  const frames = [
    { transform: `translate(${from.left-to.left}px, ${from.top-to.top}px) scale(${from.width/to.width}, ${from.height/to.height})`, opacity: 1 },
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
  ];
  const hidden = target.style.visibility;
  target.style.visibility = "hidden";
  const show = () => { target.style.visibility = hidden; };
  const animation = image.animate(closing ? frames.reverse() : frames, { duration, easing });
  let fade: Animation | undefined, done = false;
  // Runs once: a cancelled flight settles later and must not reveal a stage a newer flight has hidden.
  const clean = () => {
    if (done) return;
    done = true;
    show();
    image.remove();
    if (activeFlights.get(owner) === stop) activeFlights.delete(owner);
  };
  const stop = () => { animation.cancel(); fade?.cancel(); clean(); };
  activeFlights.set(owner, stop);
  const landed = () => {
    if (done) return;
    if (closing || !reveal) { clean(); return; }
    show();
    fade = image.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reveal, easing });
    void fade.finished.then(clean, clean);
  };
  void animation.finished.then(landed, clean);
  return stop;
}
