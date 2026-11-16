export type Point = { x: number; y: number };

export function annotationSelection(start: Point, end: Point) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  return w > 0.01 && h > 0.01 ? { x, y, w, h } : { x, y };
}
