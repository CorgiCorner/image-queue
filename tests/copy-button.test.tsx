// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/copy-button";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("confirms successful copies for 1500ms and resets the timer on another copy", async () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}});
  const onSuccess=vi.fn();
  const view=render(<CopyButton value="hello" label="Copy" onSuccess={onSuccess} onError={vi.fn()}/>);
  await act(async()=>fireEvent.click(screen.getByRole("button")));
  expect(onSuccess).toHaveBeenCalledOnce();
  expect(view.container.querySelector("[data-copied]")).toBeTruthy();
  act(()=>vi.advanceTimersByTime(1000));
  await act(async()=>fireEvent.click(screen.getByRole("button")));
  act(()=>vi.advanceTimersByTime(1000));
  expect(view.container.querySelector("[data-copied]")).toBeTruthy();
  act(()=>vi.advanceTimersByTime(500));
  expect(view.container.querySelector("[data-copied]")).toBeNull();
});
it("does not confirm a failed copy or a stale clipboard completion after changing content", async () => {
  const onError=vi.fn(),onSuccess=vi.fn();
  const writeText=vi.fn().mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const view=render(<CopyButton value="old" label="Copy" onSuccess={onSuccess} onError={onError}/>);
  await act(async()=>fireEvent.click(screen.getByRole("button")));
  expect(onError).toHaveBeenCalledOnce();
  expect(view.container.querySelector("[data-copied]")).toBeNull();
  let finish!:()=>void;
  writeText.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole("button"));
  view.rerender(<CopyButton value="new" label="Copy" onSuccess={onSuccess} onError={onError}/>);
  await act(async()=>finish());
  expect(onSuccess).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-copied]")).toBeNull();
});
