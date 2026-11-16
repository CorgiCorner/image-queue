// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { animateImageZoom } from "@/lib/zoom-motion";

afterEach(() => vi.unstubAllGlobals());
it("maps the old image rectangle to its new layout and can stop for direct panning", () => {
  const image = document.createElement("div");
  image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 800 }) as DOMRect;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.assign(image, { animate });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => name === "--motion-base" ? "180ms" : name === "--motion-reduced" ? "0" : "linear" }));
  animateImageZoom(image, { left: 30, top: 60, width: 500, height: 400 } as DOMRect)();
  expect(animate).toHaveBeenCalledWith([
    { transformOrigin: "0 0", transform: "translate(20px, 40px) scale(0.5)" },
    { transformOrigin: "0 0", transform: "none" },
  ], { duration: 180, easing: "linear" });
  expect(cancel).toHaveBeenCalledOnce();
});
it("leaves reduced motion and unmeasurable images instant", () => {
  const image = document.createElement("div");
  const animate = vi.fn();
  Object.assign(image, { animate });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "1" }));
  animateImageZoom(image, { width: 500, height: 400 } as DOMRect)();
  expect(animate).not.toHaveBeenCalled();
});
it("scales the drawn picture uniformly when the stage box and the picture differ in proportion", () => {
  const image = document.createElement("div");
  // 100%: the stage is the square picture itself; fit: a wide stage box with the picture centred in it.
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 720 }) as DOMRect;
  const animate = vi.fn((_frames: Keyframe[]) => ({ cancel: vi.fn() }));
  Object.assign(image, { animate });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => name === "--motion-base" ? "180ms" : name === "--motion-reduced" ? "0" : "linear" }));
  animateImageZoom(image, { left: 0, top: 0, width: 600, height: 400 } as DOMRect, 1);
  const transform = String(animate.mock.calls[0][0][0].transform);
  expect(transform).toMatch(/^translate\(100px, 0px\) scale\(0\.5555/);
  expect(transform.slice(transform.indexOf("scale("))).not.toContain(",");
});
