// @vitest-environment happy-dom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChangingLabel } from "@/components/changing-label";
const original=HTMLElement.prototype.animate;
afterEach(()=>{cleanup();vi.unstubAllGlobals();HTMLElement.prototype.animate=original;});
it("fades changed text without remounting its sibling spinner",()=>{
 const cancel=vi.fn();
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished:Promise.resolve()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(name:string)=>name==="--motion-fast"?"80ms":"linear"}));
 const view=render(<div><i className="spin"/><ChangingLabel value="Reserved"/></div>);
 const spinner=view.container.querySelector('i');
 expect(animate).not.toHaveBeenCalled();
 view.rerender(<div><i className="spin"/><ChangingLabel value="Generating"/></div>);
 expect(view.container.querySelector('i')).toBe(spinner);
 expect(animate.mock.calls[0][1].duration).toBe(80);
 view.rerender(<div><i className="spin"/><ChangingLabel value="Waiting"/></div>);
 expect(cancel).toHaveBeenCalledOnce();
});
