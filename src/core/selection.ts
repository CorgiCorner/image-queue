import type { Rectangle } from "./layout";
export type SelectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function selectionBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
export function selectRectangles(
  rectangles: Rectangle[],
  box: SelectionBox,
  existing: string[] = [],
) {
  const selected = new Set(existing);
  for (const item of rectangles) {
    if (
      item.kind === "image" &&
      item.x <= box.x + box.width &&
      item.x + item.width >= box.x &&
      item.y <= box.y + box.height &&
      item.y + item.height >= box.y
    )
      selected.add(item.id);
  }
  return [...selected];
}
