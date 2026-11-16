// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { openSharedImage } from "@/lib/shared-image-motion";
const original=HTMLElement.prototype.animate;
afterEach(()=>{document.body.innerHTML="";HTMLElement.prototype.animate=original;vi.unstubAllGlobals();});
it("connects the tile to the preview and cleans its overlay",async()=>{
 const target=document.createElement('div'),source=document.createElement('img');source.src='/thumb.png';
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 let done!:()=>void;const finished=new Promise<void>(resolve=>done=resolve);const cancel=vi.fn();
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({finished,cancel}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key==='--motion-slow'?'240ms':'linear'}));
 const stop=openSharedImage(target,source);
 expect(document.querySelector('.shared-image-flight')).not.toBeNull();
 expect(animate.mock.calls[0][1].duration).toBe(240);
 done();await finished;for(let i=0;i<4;i++) await Promise.resolve();expect(document.querySelector('.shared-image-flight')).toBeNull();
 stop();expect(cancel).toHaveBeenCalledOnce();
});
it("skips spatial motion when reduced",()=>{
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:()=> '1'}));
 openSharedImage(document.createElement('div'),document.createElement('img'))();
 expect(document.querySelector('.shared-image-flight')).toBeNull();
});
it("finishes computed-style reads before inserting the flight overlay",()=>{
 const target=document.createElement('div'),source=document.createElement('img');
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120,right:110}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 HTMLElement.prototype.animate=vi.fn(()=>({finished:Promise.resolve(),cancel:vi.fn()})) as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>{
  expect(document.querySelector('.shared-image-flight')).toBeNull();
  return key==='--motion-reduced'?'0':key.startsWith('--motion')?'240ms':'linear';
 }}));
 openSharedImage(target,source)();
});
it("reverses the path with the base duration when closing",()=>{
 const target=document.createElement('div'),source=document.createElement('img');
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({finished:Promise.resolve(),cancel:vi.fn()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key==='--motion-base'?'180ms':'linear'}));
 openSharedImage(target,source,true);
 expect(animate.mock.calls[0][0][0].transform).toBe('translate(0, 0) scale(1)');
 expect(animate.mock.calls[0][1].duration).toBe(180);
});
it("replaces a previous flight and ignores its late completion",async()=>{
 const target=document.createElement('div'),source=document.createElement('img');
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120,right:110}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 const completions: (()=>void)[]=[], cancels: ReturnType<typeof vi.fn>[]=[];
 HTMLElement.prototype.animate=vi.fn(()=>{
  const cancel=vi.fn();cancels.push(cancel);
  return {cancel,finished:new Promise<void>(resolve=>completions.push(resolve))};
 }) as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key.startsWith('--motion')?'180ms':'linear'}));
 openSharedImage(target,source);
 const stop=openSharedImage(target,source,true);
 expect(cancels[0]).toHaveBeenCalledOnce();
 expect(document.querySelectorAll('.shared-image-flight')).toHaveLength(1);
 completions[0]();await Promise.resolve();
 expect(document.querySelectorAll('.shared-image-flight')).toHaveLength(1);
 stop();expect(document.querySelectorAll('.shared-image-flight')).toHaveLength(0);
});
it("hides the stage while the copy flies and fades the copy over the full file after landing",async()=>{
 const target=document.createElement('div'),source=document.createElement('img');
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120,right:110}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 const completions:(()=>void)[]=[];
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel:vi.fn(),finished:new Promise<void>(resolve=>completions.push(resolve))}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key==='--motion-slow'?'240ms':key==='--motion-fast'?'120ms':'linear'}));
 openSharedImage(target,source);
 expect(target.style.visibility).toBe('hidden');
 completions[0]();await Promise.resolve();await Promise.resolve();
 expect(target.style.visibility).toBe('');
 expect(animate.mock.calls[1][0]).toEqual([{opacity:1},{opacity:0}]);
 expect(animate.mock.calls[1][1].duration).toBe(120);
 expect(document.querySelector('.shared-image-flight')).not.toBeNull();
 completions[1]();await Promise.resolve();await Promise.resolve();
 expect(document.querySelector('.shared-image-flight')).toBeNull();
});
it("keeps the stage hidden for a newer flight when a replaced flight settles late",async()=>{
 const target=document.createElement('div'),source=document.createElement('img');
 source.getBoundingClientRect=()=>({left:10,top:20,width:100,height:100,bottom:120,right:110}) as DOMRect;
 target.getBoundingClientRect=()=>({left:200,top:100,width:400,height:400}) as DOMRect;
 const settle:(()=>void)[]=[];
 HTMLElement.prototype.animate=vi.fn(()=>({cancel:vi.fn(),finished:new Promise<void>((_resolve,reject)=>settle.push(()=>reject(new Error('cancelled'))))})) as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal('getComputedStyle',()=>({getPropertyValue:(key:string)=>key==='--motion-reduced'?'0':key.startsWith('--motion')?'180ms':'linear'}));
 openSharedImage(target,source);
 const stop=openSharedImage(target,source,true);
 settle[0]();await Promise.resolve();await Promise.resolve();
 expect(target.style.visibility).toBe('hidden');
 stop();expect(target.style.visibility).toBe('');
});
