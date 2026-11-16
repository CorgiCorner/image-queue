/** Keeps the previous pixels during a change, without copying controls or note markers. */
export function crossfadePreview(container: HTMLElement, previousSource: string, incoming?: HTMLImageElement | null): () => void {
  if (typeof container.animate !== "function") return () => {};
  const overlay = document.createElement("img");
  overlay.src = previousSource;
  overlay.alt = "";
  overlay.className = "preview-outgoing";
  overlay.setAttribute("aria-hidden", "true");
  container.append(overlay);
  const style = getComputedStyle(document.documentElement);
  const value = style.getPropertyValue("--motion-fast").trim();
  const duration = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000) || 0;
  let animation: Animation | undefined;
  const cleanup = () => {
    incoming?.removeEventListener("load", fade);
    incoming?.removeEventListener("error", fade);
    overlay.remove();
  };
  const fade = () => {
    if (animation) return;
    animation = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration, easing: style.getPropertyValue("--ease-out").trim(), fill: "forwards",
    });
    void animation.finished.then(cleanup, cleanup);
  };
  if (!incoming || (incoming.complete && incoming.naturalWidth > 0)) fade();
  else {
    incoming.addEventListener("load", fade, { once: true });
    incoming.addEventListener("error", fade, { once: true });
  }
  return () => { animation?.cancel(); cleanup(); };
}
