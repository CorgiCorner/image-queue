// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GalleryContent } from "@/components/gallery-content";
const original=HTMLElement.prototype.animate;
afterEach(()=>{cleanup();vi.unstubAllGlobals();HTMLElement.prototype.animate=original;});
it("fades both directions, cancels interrupted transitions and keeps actions live",()=>{
 const cancel=vi.fn(), click=vi.fn();
 const animate=vi.fn((_frames:Keyframe[],_options:KeyframeAnimationOptions)=>({cancel,finished:Promise.resolve()}));
 HTMLElement.prototype.animate=animate as unknown as typeof HTMLElement.prototype.animate;
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:(key:string)=>key==="--motion-base"?"80ms":"linear"}));
 const view=render(<GalleryContent empty={false}>Gallery</GalleryContent>);
 expect(animate).not.toHaveBeenCalled();
 view.rerender(<GalleryContent empty><button onClick={click}>Clear filter</button></GalleryContent>);
 fireEvent.click(screen.getByRole("button"));expect(click).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][1].duration).toBe(80);
 view.rerender(<GalleryContent empty={false}>Gallery</GalleryContent>);
 expect(cancel).toHaveBeenCalledOnce();expect(animate).toHaveBeenCalledTimes(2);
});
it("works when animation APIs are unavailable",()=>{
 HTMLElement.prototype.animate=undefined as unknown as typeof HTMLElement.prototype.animate;
 const view=render(<GalleryContent empty={false}>Gallery</GalleryContent>);
 expect(()=>view.rerender(<GalleryContent empty>Empty</GalleryContent>)).not.toThrow();
});
