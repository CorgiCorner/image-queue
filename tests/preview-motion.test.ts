// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { crossfadePreview } from "@/lib/preview-motion";
const originalAnimate=HTMLElement.prototype.animate;
afterEach(()=>{document.body.innerHTML="";HTMLElement.prototype.animate=originalAnimate;vi.unstubAllGlobals();});
it("holds only the previous pixels and removes them after the tokened fade",async()=>{
  const stage=document.createElement("div"); document.body.append(stage);
  const cancel=vi.fn(); let finish!:()=>void;
  const finished=new Promise<void>(resolve=>{finish=resolve;});
  vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-fast"?"80ms":"linear"}));
  const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({finished,cancel}));
  Object.assign(HTMLElement.prototype,{animate});
  const cleanup=crossfadePreview(stage,"/old.png");
  expect(stage.querySelector("img")?.getAttribute("src")).toBe("/old.png");
  expect(stage.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
  expect(animate.mock.calls[0][1].duration).toBe(80);
  finish();await finished;await Promise.resolve();
  expect(stage.children).toHaveLength(0);
  cleanup();expect(cancel).toHaveBeenCalledOnce();
});
it("falls back without the animation API",()=>{
 const stage=document.createElement("div"); Object.assign(stage,{animate:undefined});
 expect(()=>crossfadePreview(stage,"/old.png")()).not.toThrow();
 expect(stage.children).toHaveLength(0);
});

it("waits for incoming pixels and cancels that listener on interruption",()=>{
 const stage=document.createElement("div"), incoming=document.createElement("img");
 stage.append(incoming);document.body.append(stage);
 const animate=vi.fn(()=>({finished:new Promise(()=>{}),cancel:vi.fn()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"120ms"}));
 const stop=crossfadePreview(stage,"/old.png",incoming);
 expect(animate).not.toHaveBeenCalled();
 stop();incoming.dispatchEvent(new Event("load"));
 expect(animate).not.toHaveBeenCalled();
 crossfadePreview(stage,"/old.png",incoming);
 incoming.dispatchEvent(new Event("load"));
 expect(animate).toHaveBeenCalledOnce();
});

it("releases the previous pixels if the incoming thumbnail fails",async()=>{
 const stage=document.createElement("div"), incoming=document.createElement("img");
 stage.append(incoming);document.body.append(stage);
 const finished=Promise.resolve();
 const animate=vi.fn(()=>({finished,cancel:vi.fn()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"120ms"}));
 crossfadePreview(stage,"/old.png",incoming);
 incoming.dispatchEvent(new Event("error"));
 await finished;await Promise.resolve();
 expect(stage.querySelector(".preview-outgoing")).toBeNull();
});
