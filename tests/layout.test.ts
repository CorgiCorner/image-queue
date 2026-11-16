import { describe, expect, it } from "vitest";
import { type LayoutMode, layout, visibleRectangles } from "../src/core/layout";

const items = Array.from({ length: 10000 }, (_, i) => ({
  id: String(i),
  width: [1600, 900, 1000][i % 3],
  height: [900, 1600, 1000][i % 3],
}));
describe("shared rectangle layouts", () => {
  for (const mode of ["justified", "masonry", "grid"] as LayoutMode[]) {
    it(`${mode} handles ten thousand items without overlaps`, () => {
      const result = layout(items, 1200, mode);
      expect(result.rectangles).toHaveLength(10000);
      expect(result.height).toBeGreaterThan(0);
      for (const rect of result.rectangles) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1200.01);
        expect(rect.height).toBeGreaterThan(0);
      }
      const visible = visibleRectangles(result, 50000, 51000);
      expect(visible.length).toBeLessThan(100);
      expect(
        visible.every((r) => r.y + r.height >= 49600 && r.y <= 51400),
      ).toBe(true);
    });
    it(`${mode} supports empty, narrow and grouped content`, () => {
      expect(layout([], 0, mode).height).toBe(0);
      const result = layout(
        [
          { id: "head", width: 1, height: 1, kind: "header", headerHeight: 30 },
          { id: "a", width: 1, height: 0 },
          { id: "b", width: 1000, height: 1 },
        ],
        100,
        mode,
      );
      expect(result.rectangles[0].height).toBe(30);
      expect(result.rectangles[1].y).toBeGreaterThanOrEqual(30);
      expect(visibleRectangles(result, -100, -50, 0)).toEqual([]);
    });
  }
  it("uses default header height and finds near-top rectangles", () => {
    const result = layout(
      [{ id: "h", kind: "header", width: 1, height: 1 }, ...items.slice(0, 3)],
      800,
      "justified",
    );
    expect(result.rectangles[0].height).toBe(40);
    expect(visibleRectangles(result, 0, 800)).toHaveLength(4);
  });
});
it.each<LayoutMode>(["justified","masonry","grid"])("keeps mixed grouped rectangles disjoint in %s", mode => {
  const result=layout([
    ...items.slice(0,15),
    {id:"group",width:1,height:1,kind:"header",headerHeight:35},
    ...items.slice(15,30),
  ],900,mode);
  for (let i=0;i<result.rectangles.length;i++) {
    for (let j=i+1;j<result.rectangles.length;j++) {
      const a=result.rectangles[i],b=result.rectangles[j];
      const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
      const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      expect(overlapX>0.001 && overlapY>0.001).toBe(false);
    }
  }
});
