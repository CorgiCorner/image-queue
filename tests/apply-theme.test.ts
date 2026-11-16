// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { applyTheme } from "@/lib/apply-theme";

afterEach(() => vi.unstubAllGlobals());
it("applies the palette under a transition guard and removes the guard next frame", () => {
  const root = document.createElement("div");
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { callback = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  applyTheme("light", root);
  expect(root.dataset.theme).toBe("light");
  expect(root.hasAttribute("data-changing-theme")).toBe(true);
  callback(0);
  expect(root.hasAttribute("data-changing-theme")).toBe(false);
});
it("cancels a pending guard cleanup before another theme change", () => {
  const root = document.createElement("div");
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", () => 7);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  applyTheme("dark", root)();
  expect(cancel).toHaveBeenCalledWith(7);
  expect(root.hasAttribute("data-changing-theme")).toBe(false);
  applyTheme("light", root)();
  expect(root.dataset.theme).toBe("light");
});
