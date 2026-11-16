import { expect, it } from "vitest";
import { selectionBox, selectRectangles } from "../src/core/selection";
import type { Rectangle } from "../src/core/layout";
const items: Rectangle[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 100, kind: "image" },
  { id: "b", x: 120, y: 900, width: 100, height: 100, kind: "image" },
  { id: "header", x: 0, y: 0, width: 300, height: 20, kind: "header" },
];
it("normalizes reverse drag coordinates", () => {
  expect(selectionBox({ x: 100, y: 200 }, { x: 10, y: 20 })).toEqual({
    x: 10,
    y: 20,
    width: 90,
    height: 180,
  });
});
it("includes intersecting offscreen rectangles and excludes headers", () => {
  expect(
    selectRectangles(items, { x: 0, y: 0, width: 200, height: 950 }),
  ).toEqual(["a", "b"]);
});
it("adds to existing selection without duplicates", () => {
  expect(
    selectRectangles(items, { x: 0, y: 0, width: 5, height: 5 }, ["a", "b"]),
  ).toEqual(["a", "b"]);
});
it("excludes nonintersecting images", () => {
  expect(
    selectRectangles(items, { x: 300, y: 400, width: 5, height: 5 }),
  ).toEqual([]);
});
