// @vitest-environment happy-dom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExpandablePrompt } from "@/components/expandable-prompt";
const animate=vi.hoisted(()=>vi.fn((_element: HTMLElement, _height: number)=>vi.fn()));
vi.mock("@/lib/height-motion",()=>({animateHeightChange:animate}));
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
it("animates expansion but never carries another image's height",()=>{
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({height:144} as DOMRect);
 const view=render(<ExpandablePrompt text="Long prompt" expanded={false}/>);
 expect(animate).not.toHaveBeenCalled();
 view.rerender(<ExpandablePrompt text="Long prompt" expanded/>);
 expect(animate).toHaveBeenCalledOnce();
 expect(animate.mock.calls[0][1]).toBe(144);
 view.rerender(<ExpandablePrompt text="Another image" expanded/>);
 expect(animate).toHaveBeenCalledOnce();
 expect(view.container.querySelector('p')?.textContent).toBe('Another image');
});
