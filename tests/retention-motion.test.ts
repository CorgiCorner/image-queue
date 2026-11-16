// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { animateRetainedCards } from "@/lib/retention-motion";
afterEach(()=>{document.body.innerHTML="";vi.unstubAllGlobals();});
it("animates only confirmed ids and awaits the exit",async()=>{
 document.body.innerHTML='<button class="virtual-card" data-job-id="yes"></button><button class="virtual-card" data-job-id="no"></button>';
 let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve;});
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({finished}));
 document.querySelectorAll('button').forEach(card=>Object.assign(card,{animate}));
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-fast"?"120ms":key==="--motion-scale-in"?"0.96":key==="--motion-reduced"?"0":"linear"}));
 let completed=false;const result=animateRetainedCards(["yes"]).then(()=>{completed=true;});
 expect(animate).toHaveBeenCalledOnce();expect(completed).toBe(false);
 expect(animate.mock.calls[0][0][1].transform).toBe("scale(0.96)");
 finish();await result;expect(completed).toBe(true);
});
it("handles an empty or virtualized-away selection",async()=>{
 await expect(animateRetainedCards([])).resolves.toBeTypeOf("function");
});
it("uses opacity without scaling under reduced motion",async()=>{
 document.body.innerHTML='<button class="virtual-card" data-job-id="one"></button>';
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({finished:Promise.resolve()}));
 Object.assign(document.querySelector('button')!,{animate});
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"1":key==="--motion-fast"?"80ms":"linear"}));
 await animateRetainedCards(["one"]);
 expect(animate.mock.calls[0][0][1]).toEqual({opacity:0,transform:"scale(1)"});
 expect(animate.mock.calls[0][1].duration).toBe(80);
});
