import { expect, it } from "vitest";
import { annotationSelection } from "../src/core/annotation";
import { noteInput } from "../src/core/notes";

it.each([
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0, w: 1, h: 1 }],
  [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0, w: 1, h: 1 }],
  [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }, { x: 0.2, y: 0.4 }],
  [{ x: 0.2, y: 0.4 }, { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.4 }],
])("creates valid point or area from a drag", (start, end, expected) => {
  const selection = annotationSelection(start, end);
  expect(selection).toEqual(expected);
  expect(noteInput.safeParse({ imageId: "image", text: "Note", ...selection }).success).toBe(true);
});

it("keeps tiny diagonal motion as a point", () => {
  expect(annotationSelection({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.205 }))
    .toEqual({ x: 0.2, y: 0.2 });
});

it("uses the top-left corner for reverse tiny motion", () => {
  expect(annotationSelection({ x: 0.205, y: 0.205 }, { x: 0.2, y: 0.2 }))
    .toEqual({ x: 0.2, y: 0.2 });
});
