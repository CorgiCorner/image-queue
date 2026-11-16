// @vitest-environment happy-dom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReferenceStrip } from "@/components/reference-strip";
const original=HTMLElement.prototype.animate;
afterEach(()=>{cleanup();vi.unstubAllGlobals();HTMLElement.prototype.animate=original;});
it("animates references and makes removed ghosts inaccessible",async()=>{
 const cancel=vi.fn();let finish!:()=>void;
 const finished=new Promise<void>(resolve=>{finish=resolve;});
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"1":key.startsWith("--motion-")?"80ms":"linear"}));
 const view=render(<ReferenceStrip ids={["a"]}><div data-reference-id="a"><button>Remove reference</button></div></ReferenceStrip>);
 expect(animate.mock.calls[0][0][0].transform).toBe("scale(1)");
 view.rerender(<ReferenceStrip ids={[]}>{null}</ReferenceStrip>);
 const ghost=view.container.querySelector('[data-exiting-reference]');
 expect(ghost?.getAttribute('aria-hidden')).toBe('true');
 expect((ghost as HTMLElement).inert).toBe(true);
 finish();await finished;await Promise.resolve();
 expect(view.container.querySelector('[data-exiting-reference]')).toBeNull();
});
it("removes ghosts immediately without animation support",()=>{
 HTMLElement.prototype.animate=undefined as unknown as typeof HTMLElement.prototype.animate;
 const view=render(<ReferenceStrip ids={["a"]}><div data-reference-id="a"/></ReferenceStrip>);
 view.rerender(<ReferenceStrip ids={[]}>{null}</ReferenceStrip>);
 expect(view.container.querySelector('[data-exiting-reference]')).toBeNull();
});
