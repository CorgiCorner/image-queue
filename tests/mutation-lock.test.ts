import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { mutationLock } from "../src/storage/mutation-lock";

it("permits nested writes while blocking independent concurrent operations", async () => {
  const store = new MemoryStorage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const operation = mutationLock(store, "workspace", async () => {
    await mutationLock(store, "workspace", async () => store.put("records", "nested", { saved: true }));
    await pending;
  });
  await expect(mutationLock(store, "workspace", async () => undefined)).rejects.toThrow("progress");
  release();
  await operation;
  expect(await store.get("records", "nested")).toEqual({ saved: true });
  await expect(mutationLock(store, "workspace", async () => "next")).resolves.toBe("next");
});

it("releases the mutation lock after failure", async () => {
  const store = new MemoryStorage();
  await expect(mutationLock(store, "workspace", async () => { throw new Error("Failed"); })).rejects.toThrow("Failed");
  await expect(mutationLock(store, "workspace", async () => true)).resolves.toBe(true);
});

it("recognizes the same disk store through a symlink alias", async () => {
  const { mkdtemp, mkdir, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileStorage } = await import("../src/storage/fs");
  const root = await mkdtemp(join(tmpdir(), "mutation-alias-"));
  try {
    const directory = join(root, "store");
    await mkdir(directory);
    const alias = join(root, "alias");
    await symlink(directory, alias);
    const store = new FileStorage(directory);
    const second = new FileStorage(alias);
    await mutationLock(store, directory, () => mutationLock(second, alias, async () => second.put("records", "one", { saved: true })));
    expect(await store.get("records", "one")).toEqual({ saved: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
