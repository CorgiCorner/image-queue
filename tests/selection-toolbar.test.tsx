// @vitest-environment happy-dom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SelectionToolbar } from "@/components/selection-toolbar";
const original=HTMLElement.prototype.animate;
beforeEach(()=>vi.stubGlobal("ResizeObserver",class { observe() {} disconnect() {} }));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();HTMLElement.prototype.animate=original;});
it("retains the filter row height and cancels an interrupted transition",()=>{
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({height:96} as DOMRect);
 const cancel=vi.fn();
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished:Promise.resolve()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(name:string)=>name==="--motion-base"?"180ms":name==="--motion-shift"?"8px":"linear"}));
 const view=render(<SelectionToolbar selected={false}>Filters</SelectionToolbar>);
 expect(animate).not.toHaveBeenCalled();
 view.rerender(<SelectionToolbar selected>Actions</SelectionToolbar>);
 expect((view.container.firstChild as HTMLElement).style.minHeight).toBe("96px");
 expect(animate.mock.calls[0][1].duration).toBe(180);
 view.rerender(<SelectionToolbar selected={false}>Filters</SelectionToolbar>);
 expect(cancel).toHaveBeenCalledOnce();
 expect((view.container.firstChild as HTMLElement).style.minHeight).toBe("");
});
it("works without animation support",()=>{
 HTMLElement.prototype.animate=undefined as unknown as typeof HTMLElement.prototype.animate;
 const view=render(<SelectionToolbar selected={false}>Filters</SelectionToolbar>);
 expect(()=>view.rerender(<SelectionToolbar selected>Actions</SelectionToolbar>)).not.toThrow();
});

it("updates the reserved height after resizing before selection",()=>{
 let notify!:()=>void;
 vi.stubGlobal("ResizeObserver",class { constructor(callback:()=>void){notify=callback;} observe(){} disconnect(){} });
 let height=64;
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(()=>({height}) as DOMRect);
 HTMLElement.prototype.animate=undefined as unknown as typeof HTMLElement.prototype.animate;
 const view=render(<SelectionToolbar selected={false}>Filters</SelectionToolbar>);
 height=104;notify();
 view.rerender(<SelectionToolbar selected>Actions</SelectionToolbar>);
 expect((view.container.firstChild as HTMLElement).style.minHeight).toBe("104px");
});
