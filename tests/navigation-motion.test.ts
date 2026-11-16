// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { animateNavigation, navigationPositions } from "@/lib/navigation-motion";
afterEach(()=>vi.unstubAllGlobals());
it("moves reordered visible rows and cancels on interruption",()=>{
 const root=document.createElement("div"),row=document.createElement("button");row.dataset.navigationId="projects:a";root.append(row);
 let top=40;row.getBoundingClientRect=()=>({left:0,top,bottom:top+40,width:200}) as DOMRect;
 const before=navigationPositions(root);top=80;
 const cancel=vi.fn(),animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished:Promise.resolve()}));Object.assign(row,{animate});
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"0":key==="--motion-base"?"180ms":"linear"}));
 animateNavigation(before,root)();
 expect(animate.mock.calls[0][0]).toEqual([{transform:"translate(0px, -40px)"},{transform:"none"}]);
 expect(cancel).toHaveBeenCalledOnce();
});
it("does not move rows with reduced motion",()=>{
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"1"}));
 expect(()=>animateNavigation(new Map(),document.createElement("div"))()).not.toThrow();
});
