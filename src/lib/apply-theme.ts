/** Resolve the new palette while CSS transitions are disabled, then restore them. */
export function applyTheme(theme: "dark" | "light", root = document.documentElement): () => void {
  root.setAttribute("data-changing-theme", "");
  root.dataset.theme = theme;
  // Force palette resolution before removing the guard on the next frame.
  getComputedStyle(root).backgroundColor;
  const frame = requestAnimationFrame(() => root.removeAttribute("data-changing-theme"));
  return () => {
    cancelAnimationFrame(frame);
    root.removeAttribute("data-changing-theme");
  };
}
