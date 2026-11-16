import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStorage } from "../src/storage/memory";
import { FileStorage } from "../src/storage/fs";
import { mutationLock } from "../src/storage/mutation-lock";

it("permits nested writes while independent operations wait their turn", async () => {
  const store = new MemoryStorage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const operation = mutationLock(store, "workspace", async () => {
    await mutationLock(store, "workspace", async () => store.put("records", "nested", { saved: true }));
    await pending;
    order.push("first");
  });
  const waiting = mutationLock(store, "workspace", async () => { order.push("second"); return "second"; });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(order).toEqual([]);
  release();
  await operation;
  await expect(waiting).resolves.toBe("second");
  expect(order).toEqual(["first", "second"]);
  expect(await store.get("records", "nested")).toEqual({ saved: true });
});

it("still refuses after the bounded wait", async () => {
  const store = new MemoryStorage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const operation = mutationLock(store, "workspace", () => pending);
  await expect(mutationLock(store, "workspace", async () => undefined, 40)).rejects.toThrow("progress");
  release();
  await operation;
});

it("serializes concurrent callers on a disk store without refusing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "mutation-concurrent-"));
  try {
    const store = new FileStorage(root);
    const writers = Array.from({ length: 10 }, (_, index) => mutationLock(store, root, async () => {
      const current = (await store.get<{ count: number }>("records", "counter"))?.count ?? 0;
      await new Promise(resolve => setTimeout(resolve, 5));
      await mutationLock(store, root, () => store.put("records", "counter", { count: current + 1 }));
      return index;
    }));
    await expect(Promise.all(writers)).resolves.toHaveLength(10);
    expect(await store.get("records", "counter")).toEqual({ count: 10 });
  } finally { await rm(root, { recursive: true, force: true }); }
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
