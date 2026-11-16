// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { animateHeightChange } from "@/lib/height-motion";
afterEach(()=>vi.unstubAllGlobals());
it("animates height using shared tokens and can be interrupted",()=>{
 const element=document.createElement('div');
 element.getBoundingClientRect=()=>({height:200}) as DOMRect;
 const cancel=vi.fn(),animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished:Promise.resolve()}));
 Object.assign(element,{animate});
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-base'?'180ms':key==='--motion-reduced'?'0':'linear'}));
 const stop=animateHeightChange(element,100);
 expect(element.style.overflow).toBe("clip");
 stop();
 expect(element.style.overflow).toBe("");
 expect(animate.mock.calls[0][0]).toEqual([{height:'100px'},{height:'200px'}]);
 expect(animate.mock.calls[0][1].duration).toBe(180);expect(cancel).toHaveBeenCalledOnce();
});
it("does not move layout under reduced motion",()=>{
 const element=document.createElement('div');element.getBoundingClientRect=()=>({height:200}) as DOMRect;
 const animate=vi.fn();Object.assign(element,{animate});
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:()=> '1'}));
 const stop=animateHeightChange(element,100);
 expect(element.style.overflow).toBe("");
 stop();
 expect(element.style.overflow).toBe("");animateHeightChange(element,0)();animateHeightChange(element,200)();
 expect(animate).not.toHaveBeenCalled();
});
it("ignores cleanup from a superseded height animation",async()=>{
 const element=document.createElement('div');element.getBoundingClientRect=()=>({height:200}) as DOMRect;
 const finish: (()=>void)[]=[];
 Object.assign(element,{animate:()=>({cancel:vi.fn(),finished:new Promise<void>(resolve=>finish.push(resolve))})});
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key==='--motion-base'?'180ms':'linear'}));
 animateHeightChange(element,100);
 const stop=animateHeightChange(element,150);
 finish[0]();await Promise.resolve();
 expect(element.style.overflow).toBe('clip');
 stop();expect(element.style.overflow).toBe('');
});
