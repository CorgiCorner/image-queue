// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkerAlert } from "@/components/worker-alert";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("retains an inert alert while fading and cancels removal when workers go offline again",async()=>{
 let finish!:()=>void;
 const cancel=vi.fn();
 const original=HTMLElement.prototype.animate;
 Object.assign(HTMLElement.prototype,{animate:()=>({cancel,finished:new Promise<void>(resolve=>{finish=resolve;})})});
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"80ms"}));
 try {
  const props={enabled:true,message:"Workers offline",manageHref:"/settings#worker-pool"};
  const view=render(<WorkerAlert {...props} unavailable/>);
  expect(view.container.querySelector(".worker-alert-region")?.hasAttribute("data-open")).toBe(true);
  view.rerender(<WorkerAlert {...props} unavailable={false} message="Workers online"/>);
  expect(screen.getByText("Workers offline")).toBeTruthy();
  expect(screen.queryByRole("note")).toBeNull();
  expect(view.container.querySelector("[inert]")).toBeTruthy();
  expect(view.container.querySelector(".worker-alert-region")?.hasAttribute("data-open")).toBe(false);
  view.rerender(<WorkerAlert {...props} unavailable/>);
  await act(async()=>finish());
  expect(screen.getByRole("note")).toBeTruthy();
  expect(view.container.querySelector(".worker-alert-region")?.hasAttribute("data-open")).toBe(true);
  expect(cancel).toHaveBeenCalled();
  view.rerender(<WorkerAlert {...props} enabled={false} unavailable/>);
  expect(view.container.children).toHaveLength(0);
 } finally {HTMLElement.prototype.animate=original;}
});
