// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { animateGalleryChange } from "@/lib/gallery-motion";
import type { Rectangle } from "@/core/layout";
const rect = (x: number): Rectangle => ({id:"a",x,y:0,width:100,height:100,kind:"image"});
function setup(count=1) {
  const root=document.createElement("section");
  root.innerHTML=Array.from({length:count},()=>'<input><button class="virtual-card" data-job-id="a"></button>').join("");
  document.body.append(root);
  const cancel=vi.fn(), animate=vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions)=>({cancel}));
  vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"0":key.startsWith("--ease")?"linear":"240ms"}));
  for(const element of [root,...root.children]) Object.assign(element,{animate});
  return {root,animate,cancel};
}
afterEach(()=>{document.body.innerHTML="";vi.unstubAllGlobals();});
it("moves cards and their checkboxes together, with cancellable animations",()=>{
  const {root,animate,cancel}=setup();
  const stop=animateGalleryChange(root,[rect(0)],[rect(100)],true);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[0][0]).toEqual([{transform:"translate(-100px, 0px)"},{transform:"translate(0, 0)"}]);
  stop();expect(cancel).toHaveBeenCalledTimes(2);
});
it("fades filters and large collections instead of moving every card",()=>{
  const {root,animate}=setup(61);
  animateGalleryChange(root,[rect(0)],[rect(100)],true);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.calls[0][0]).toEqual([{opacity:0},{opacity:1}]);
});
it("honors reduced motion and skips unsupported animation APIs",()=>{
  const {root,animate}=setup();
  vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"1":key.startsWith("--ease")?"linear":"80ms"}));
  animateGalleryChange(root,[rect(0)],[rect(100)],true);
  expect(animate.mock.calls[0][0]).toEqual([{opacity:0},{opacity:1}]);
  expect(animate.mock.calls[0][1].duration).toBe(80);
  Object.assign(root,{animate:undefined});
  expect(()=>animateGalleryChange(root,[],[],false)()).not.toThrow();
});
it("fades restored cards and moves neighbors only for an explicit restore",()=>{
 const {root,animate}=setup();
 animateGalleryChange(root,[],[rect(0)],false,true);
 expect(animate).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][0]).toEqual([{opacity:0},{opacity:1}]);
});
it("uses the base duration when restore moves existing neighbors",()=>{
 const {root,animate}=setup();
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"0":key==="--motion-base"?"180ms":key==="--motion-slow"?"240ms":"linear"}));
 animateGalleryChange(root,[rect(0)],[rect(100)],false,true);
 expect(animate.mock.calls[0][1].duration).toBe(180);
});
it("keeps filter changes a single fade even when they reveal new cards",()=>{
 const {root,animate}=setup();
 animateGalleryChange(root,[],[rect(0)],false,false);
 expect(animate).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][0]).toEqual([{opacity:0},{opacity:1}]);
});
it("reads live motion tokens before starting any card animation",()=>{
 const {root,animate}=setup(4);
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>{
  expect(animate).not.toHaveBeenCalled();
  return key==="--motion-reduced"?"0":key.startsWith("--ease")?"linear":"240ms";
 }}));
 animateGalleryChange(root,[rect(0)],[rect(100)],true);
 expect(animate).toHaveBeenCalledTimes(8);
});
it("closes the gap after archive or trash without fading the whole gallery",()=>{
 const {root,animate}=setup();
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"0":key==="--motion-base"?"180ms":key==="--motion-slow"?"240ms":"linear"}));
 const gone:Rectangle={id:"gone",x:0,y:0,width:100,height:100,kind:"image"};
 animateGalleryChange(root,[gone,rect(100)],[rect(0)],false,false,true);
 expect(animate).toHaveBeenCalledTimes(2);
 expect(animate.mock.calls.every(call=>!JSON.stringify(call[0]).includes("opacity"))).toBe(true);
 expect(animate.mock.calls[0][0]).toEqual([{transform:"translate(100px, 0px)"},{transform:"translate(0, 0)"}]);
 expect(animate.mock.calls[0][1].duration).toBe(180);
});
it("lets neighbours take their places at once after a removal in reduced motion or large galleries",()=>{
 const gone:Rectangle={id:"gone",x:0,y:0,width:100,height:100,kind:"image"};
 const reduced=setup();
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-reduced"?"1":key.startsWith("--ease")?"linear":"80ms"}));
 animateGalleryChange(reduced.root,[gone,rect(100)],[rect(0)],false,false,true);
 expect(reduced.animate).not.toHaveBeenCalled();
 document.body.innerHTML="";vi.unstubAllGlobals();
 const large=setup(61);
 animateGalleryChange(large.root,[gone,rect(100)],[rect(0)],false,false,true);
 expect(large.animate).not.toHaveBeenCalled();
});
it("keeps a narrowing filter a single fade, without sliding the remaining cards",()=>{
 const {root,animate}=setup();
 const hidden:Rectangle={id:"hidden",x:0,y:0,width:100,height:100,kind:"image"};
 animateGalleryChange(root,[hidden,rect(100)],[rect(0)],false,false,false);
 expect(animate).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][0]).toEqual([{opacity:0},{opacity:1}]);
});
