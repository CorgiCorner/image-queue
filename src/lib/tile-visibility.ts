/** The part of the viewport where gallery tiles can be seen, in client coordinates. */
export type VisibleArea = { top: number; bottom: number; left: number; right: number };

/**
 * The viewport minus what covers the gallery: a sticky top bar above and the prompt editor below.
 * Reads layout once; call it after the refreshed gallery has rendered.
 */
export function galleryVisibleArea(scope: ParentNode, view: Pick<Window, "innerWidth" | "innerHeight"> = window): VisibleArea {
  const topbar = scope.querySelector<HTMLElement>(".topbar");
  const wrap = scope.querySelector<HTMLElement>(".composer-wrap");
  const editor = wrap && !wrap.hidden ? wrap.querySelector<HTMLElement>(".composer") : null;
  const editorRect = editor?.getBoundingClientRect();
  return {
    top: Math.max(0, topbar?.getBoundingClientRect().bottom ?? 0),
    bottom: editorRect && editorRect.height > 0 ? Math.min(view.innerHeight, editorRect.top) : view.innerHeight,
    left: 0,
    right: view.innerWidth,
  };
}

/** Whether at least half of one of these gallery tiles, or half the visible area, is on screen. */
export function anyTileVisible(scope: ParentNode, ids: readonly string[], area: VisibleArea) {
  if (!ids.length) return false;
  const wanted = new Set(ids);
  const height = Math.max(0, area.bottom - area.top);
  for (const card of scope.querySelectorAll<HTMLElement>("[data-job-id]")) {
    if (!wanted.has(card.dataset.jobId!)) continue;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= area.left || rect.left >= area.right) continue;
    const shown = Math.min(rect.bottom, area.bottom) - Math.max(rect.top, area.top);
    if (shown > 0 && shown >= Math.min(rect.height, height) / 2) return true;
  }
  return false;
}
