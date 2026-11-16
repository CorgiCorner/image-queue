// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Job } from "../src/core/schema";
const { add, remove } = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock("../src/actions", () => ({ tagImageAction: add, removeImageTagAction: remove }));
import { ImageTags } from "../src/components/image-tags";
const initial = { id: "one", tags: [{ tag: "kept", source: "user" }, ...Array.from({length:10}, (_,i)=>({tag:`suggestion ${i}`,source:"agent"}))] } as Job;
function Harness() { const [job,setJob]=useState(initial);return <ImageTags job={job} onUpdated={setJob}/>; }
afterEach(()=>{cleanup();vi.resetAllMocks()});
it("shows each suggestion once, reveals overflow, and accepts a suggestion with next keyboard focus", async()=>{
 add.mockResolvedValue({data:{...initial,tags:initial.tags!.map(t=>t.tag==='suggestion 0'?{...t,source:'user'}:t)}});
 render(<Harness/>);
 expect(screen.getAllByText('suggestion 0')).toHaveLength(1);
 expect(screen.queryByRole('button',{name:'Add tag suggestion 8'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show 2 more'}));
 expect(screen.getByRole('button',{name:'Add tag suggestion 8'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Add tag suggestion 0'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Remove tag suggestion 0'})).toBeTruthy());
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Add tag suggestion 1'})));
 expect(screen.getByRole('status').textContent).toBe('Added tag suggestion 0.');
});
it("adds all suggestions in one mutation",async()=>{
 add.mockResolvedValue({data:{...initial,tags:initial.tags!.map(t=>({...t,source:'user'}))}});
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Add all'}));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'Suggested tags'})).toBeNull());
 expect(add).toHaveBeenCalledOnce();expect(add.mock.calls[0][0].tags).toHaveLength(10);
});
it("supports comma entry, empty-field Backspace and scoped removal",async()=>{
 add.mockResolvedValue({data:initial});remove.mockResolvedValue({data:{...initial,tags:initial.tags!.slice(1)}});
 render(<Harness/>);const input=screen.getByPlaceholderText('Add a tag');
 fireEvent.change(input,{target:{value:'custom'}});fireEvent.keyDown(input,{key:','});
 await waitFor(()=>expect((input as HTMLInputElement).value).toBe(''));
 expect(add).toHaveBeenCalledWith({id:'one',tags:['custom']});
 fireEvent.keyDown(input,{key:'Backspace'});
 await waitFor(()=>expect(remove).toHaveBeenCalledWith({id:'one',tag:'kept'}));
});
it("keeps the draft and current tags on failure and rejects double submits",async()=>{
 let resolve!:(x:unknown)=>void;add.mockReturnValue(new Promise(r=>{resolve=r}));render(<Harness/>);
 const input=screen.getByPlaceholderText('Add a tag');fireEvent.change(input,{target:{value:'custom'}});
 fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});expect(add).toHaveBeenCalledOnce();
 resolve({serverError:'Could not save'});await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('Could not save'));
 expect((input as HTMLInputElement).value).toBe('custom');expect(screen.getByRole('button',{name:'Remove tag kept'})).toBeTruthy();
});
