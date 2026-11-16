// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SavedStatus } from "@/components/saved-status";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("keeps its slot, announces a save for two seconds, and restarts for another save", () => {
  vi.useFakeTimers();
  const view = render(<SavedStatus revision={0} />);
  expect(screen.queryByRole("status")).toBeNull();
  const slot = view.container.firstChild;
  view.rerender(<SavedStatus revision={1} />);
  expect(screen.getByRole("status").textContent).toBe("Saved");
  act(() => vi.advanceTimersByTime(1500));
  view.rerender(<SavedStatus revision={2} />);
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole("status")).toBeTruthy();
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("status")).toBeNull();
  expect(view.container.firstChild).toBe(slot);
});
