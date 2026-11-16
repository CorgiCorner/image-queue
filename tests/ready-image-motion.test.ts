// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { retainPendingImage } from "@/lib/ready-image-motion";
afterEach(()=>vi.unstubAllGlobals());
it("keeps pending content until load, then fades and removes it",async()=>{
 const stage=document.createElement("div"),pending=document.createElement("div");
 const image=document.createElement("img");stage.append(image);
 let complete!:()=>void;
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel:vi.fn(),finished:new Promise<void>(resolve=>{complete=resolve;})}));
 Object.assign(pending,{animate});
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-base"?"180ms":"linear"}));
 retainPendingImage(stage,pending);
 expect(pending.parentElement).toBe(stage);expect(animate).not.toHaveBeenCalled();
 image.dispatchEvent(new Event("load"));
 expect(animate).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][1].duration).toBe(180);
 complete();await Promise.resolve();expect(pending.parentElement).toBeNull();
});
it("removes stale placeholders on failure or cancellation without a delayed fade",()=>{
 const stage=document.createElement("div"),pending=document.createElement("div"),image=document.createElement("img");stage.append(image);
 const done=vi.fn();
 const stop=retainPendingImage(stage,pending,done);image.dispatchEvent(new Event("error"));expect(pending.parentElement).toBeNull();stop();
 expect(done).toHaveBeenCalledOnce();
});
