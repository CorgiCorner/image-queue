/** Retain the waiting surface until the replacement thumbnail is decoded. */
export function retainPendingImage(stage: HTMLElement, pending: HTMLElement, onComplete?: () => void): () => void {
  const image = stage.querySelector<HTMLImageElement>("img");
  if (!image) return () => {};
  pending.classList.add("pending-image-outgoing");
  pending.setAttribute("aria-hidden", "true");
  pending.inert = true;
  stage.append(pending);
  let animation: Animation | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    image.removeEventListener("load", finish);
    image.removeEventListener("error", fail);
    pending.remove();
    onComplete?.();
  };
  const fail = () => { animation?.cancel(); cleanup(); };
  const finish = () => {
    if (animation) return;
    if (typeof pending.animate !== "function") { cleanup(); return; }
    const tokens = getComputedStyle(document.documentElement);
    const raw = tokens.getPropertyValue("--motion-base").trim();
    animation = pending.animate([{opacity:1},{opacity:0}], {
      duration:Number.parseFloat(raw)*(raw.endsWith("ms")?1:1000)||0,
      easing:tokens.getPropertyValue("--ease-out").trim(), fill:"forwards",
    });
    void animation.finished.then(cleanup,cleanup);
  };
  if (image.complete && image.naturalWidth > 0) finish();
  else {
    image.addEventListener("load",finish,{once:true});
    image.addEventListener("error",fail,{once:true});
  }
  return fail;
}
