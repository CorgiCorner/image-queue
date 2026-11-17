import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), open: vi.fn(actual.open) };
});
import { mkdir, open } from "node:fs/promises";
import { FileStorage } from "../src/storage/fs";
afterEach(() => { vi.mocked(mkdir).mockRestore(); vi.mocked(open).mockRestore(); });
it("propagates unexpected lock creation failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "image-queue-lock-"));
  try {
    const store = new FileStorage(root);
    await store.lock("one", async () => {});
    const original = vi.mocked(open).getMockImplementation()!;
    vi.mocked(open).mockImplementation(async (...args: any[]) => {
      if (String(args[0]).endsWith("two.kernel"))
        throw Object.assign(new Error("io failure"), { code: "EIO" });
      return original(...(args as Parameters<typeof open>));
    });
    await expect(store.lock("two", async () => {})).rejects.toThrow(
      "io failure",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("propagates unexpected queue lock failures", async () => {
  const {withQueueLock}=await import("../src/sources/queue");
  const root=await mkdtemp(path.join(os.tmpdir(),"image-queue-lock-"));
  const original=vi.mocked(open).getMockImplementation()!;
  try {
    vi.mocked(open).mockImplementation(async(...args:any[])=>{
      if(String(args[0]).endsWith(".queue.kernel")) throw new Error("lock io failure");
      return original(...(args as Parameters<typeof open>));
    });
    await expect(withQueueLock(root,async()=>{})).rejects.toThrow("lock io failure");
  } finally {await rm(root,{recursive:true,force:true});}
});
