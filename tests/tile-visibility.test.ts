// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { anyTileVisible, galleryVisibleArea } from "@/lib/tile-visibility";

const box = (top: number, height: number, left = 40, width = 200) =>
  ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON() {} }) as DOMRect;

function scene(tiles: Record<string, DOMRect>, { editor, topbar }: { editor?: DOMRect | "hidden"; topbar?: DOMRect } = {}) {
  const root = document.createElement("main");
  if (topbar) {
    const bar = document.createElement("header");
    bar.className = "topbar";
    bar.getBoundingClientRect = () => topbar;
    root.append(bar);
  }
  for (const [id, rect] of Object.entries(tiles)) {
    const tile = document.createElement("button");
    tile.dataset.jobId = id;
    tile.getBoundingClientRect = () => rect;
    root.append(tile);
  }
  if (editor) {
    const wrap = document.createElement("div");
    wrap.className = "composer-wrap";
    wrap.hidden = editor === "hidden";
    const form = document.createElement("form");
    form.className = "composer";
    form.getBoundingClientRect = () => (editor === "hidden" ? box(0, 0) : editor);
    wrap.append(form);
    root.append(wrap);
  }
  document.body.append(root);
  return root;
}
const view = { innerWidth: 1200, innerHeight: 800 };

afterEach(() => { document.body.innerHTML = ""; });

describe("new tile visibility", () => {
  it("counts a tile inside the viewport as visible", () => {
    const root = scene({ new: box(100, 200) });
    expect(anyTileVisible(root, ["new"], galleryVisibleArea(root, view))).toBe(true);
  });

  it("treats a missing tile (filtered out, other project, no gallery) as not visible", () => {
    const root = scene({ other: box(100, 200) });
    expect(anyTileVisible(root, ["new"], galleryVisibleArea(root, view))).toBe(false);
    expect(anyTileVisible(root, [], galleryVisibleArea(root, view))).toBe(false);
  });

  it("treats a tile scrolled above or below the viewport as not visible", () => {
    const root = scene({ above: box(-400, 200), below: box(900, 200) });
    const area = galleryVisibleArea(root, view);
    expect(anyTileVisible(root, ["above"], area)).toBe(false);
    expect(anyTileVisible(root, ["below"], area)).toBe(false);
  });

  it("subtracts the visible prompt editor and the top bar from the viewport", () => {
    const root = scene({ under: box(560, 200), top: box(20, 80) }, { editor: box(580, 200), topbar: box(0, 56) });
    const area = galleryVisibleArea(root, view);
    expect(area).toEqual({ top: 56, bottom: 580, left: 0, right: 1200 });
    expect(anyTileVisible(root, ["under"], area)).toBe(false);
    expect(anyTileVisible(root, ["top"], area)).toBe(true);
  });

  it("ignores a hidden prompt editor", () => {
    const root = scene({ low: box(560, 200) }, { editor: "hidden" });
    expect(galleryVisibleArea(root, view).bottom).toBe(800);
    expect(anyTileVisible(root, ["low"], galleryVisibleArea(root, view))).toBe(true);
  });

  it("is satisfied by any one of several new variants", () => {
    const root = scene({ a: box(-600, 200), b: box(200, 200) });
    expect(anyTileVisible(root, ["a", "b"], galleryVisibleArea(root, view))).toBe(true);
  });

  it("requires half a tile, or half the area for a taller tile, to be on screen", () => {
    const root = scene({ sliver: box(760, 200), tall: box(-300, 2000) });
    const area = galleryVisibleArea(root, view);
    expect(anyTileVisible(root, ["sliver"], area)).toBe(false);
    expect(anyTileVisible(root, ["tall"], area)).toBe(true);
  });
});
