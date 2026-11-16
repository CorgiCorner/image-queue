/**
 * Motion mode as decided by the reduced-motion block in src/app/globals.css.
 * Scripts that measure and move elements read it here; no component queries
 * the reduced-motion media feature on its own.
 */
export function isMotionReduced(root: Element | null = typeof document === "undefined" ? null : document.documentElement): boolean {
  if (!root) return false;
  return getComputedStyle(root).getPropertyValue("--motion-reduced").trim() === "1";
}
