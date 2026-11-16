// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImageNotes } from "@/components/image-notes";
const note = { id:"n",imageId:"i",text:"Keep this corner",createdAt:"2026-11-16" };
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it("retains a removed note only for its fade, then hides the empty section",()=>{
 vi.useFakeTimers();
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"180ms"}));
 const view=render(<ImageNotes notes={[note]} activeId="n"/>);
 view.rerender(<ImageNotes notes={[]} activeId=""/>);
 expect(screen.getByText(/Keep this corner/).getAttribute("aria-hidden")).toBe("true");
 act(()=>vi.advanceTimersByTime(180));
 expect(screen.queryByText(/Keep this corner/)).toBeNull();
 expect(view.container.querySelector("section")?.hidden).toBe(true);
});
it("cancels removal when the same note returns before the fade ends",()=>{
 vi.useFakeTimers();
 vi.stubGlobal("getComputedStyle",()=>({getPropertyValue:()=>"80ms"}));
 const view=render(<ImageNotes notes={[note]} activeId=""/>);
 view.rerender(<ImageNotes notes={[]} activeId=""/>);
 view.rerender(<ImageNotes notes={[note]} activeId=""/>);
 act(()=>vi.advanceTimersByTime(80));
 expect(screen.getByText(/Keep this corner/).getAttribute("aria-hidden")).toBe("false");
});
