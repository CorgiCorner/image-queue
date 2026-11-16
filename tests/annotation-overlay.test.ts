import { expect, it } from "vitest";
import { annotationOverlay } from "../src/core/annotation-overlay";
import type { ImageNote } from "../src/core/notes";
const note = { id: "note", imageId: "image", text: "<script>unsafe</script>", createdAt: "now", x: 0.25, y: 0.5 };
it("renders normalized points and regions without embedding note text", () => {
  const svg = annotationOverlay(1000, 500, [note, { ...note, w: 0.2, h: 0.3 }]);
  expect(svg).toContain('cx="250" cy="250"');
  expect(svg).toContain('width="200" height="150"');
  expect(svg).not.toContain("unsafe");
  expect(svg).toContain(">2</text>");
});
it("omits unpositioned notes and rejects invalid geometry", () => {
  expect(annotationOverlay(100, 100, [{ ...note, x: undefined, y: undefined }])).not.toContain("circle");
  expect(() => annotationOverlay(0, 100, [])).toThrow();
  expect(() => annotationOverlay(100, 100, [{ ...note, w: 1, h: 1 } as ImageNote])).toThrow();
});
