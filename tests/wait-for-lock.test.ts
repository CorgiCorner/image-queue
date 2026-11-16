import { expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { StorageLockBusy } from "../src/storage/types";
import { waitForLock } from "../src/storage/wait-for-lock";

const hold = (store: MemoryStorage, key: string) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const operation = store.lock(key, () => held);
  return { release, operation };
};

it("retries a busy lock and runs the work once it is free", async () => {
  const store = new MemoryStorage();
  const holder = hold(store, "key");
  const work = vi.fn(async () => "done");
  const waiting = waitForLock(store, "key", work, 2000);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(work).not.toHaveBeenCalled();
  holder.release();
  await holder.operation;
  await expect(waiting).resolves.toBe("done");
  expect(work).toHaveBeenCalledOnce();
});

it("gives up with StorageLockBusy after the bound", async () => {
  const store = new MemoryStorage();
  const holder = hold(store, "key");
  const work = vi.fn(async () => "never");
  const started = Date.now();
  const error = await waitForLock(store, "key", work, 50).catch(caught => caught);
  expect(error).toBeInstanceOf(StorageLockBusy);
  expect(error.key).toBe("key");
  expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  expect(work).not.toHaveBeenCalled();
  holder.release();
  await holder.operation;
});

it("never re-runs work that has started, even when it throws a busy error for the same key", async () => {
  const store = new MemoryStorage();
  const work = vi.fn(async () => { throw new StorageLockBusy("key"); });
  await expect(waitForLock(store, "key", work, 2000)).rejects.toBeInstanceOf(StorageLockBusy);
  expect(work).toHaveBeenCalledOnce();
  const failing = vi.fn(async () => { throw new Error("Failed"); });
  await expect(waitForLock(store, "key", failing, 2000)).rejects.toThrow("Failed");
  expect(failing).toHaveBeenCalledOnce();
});

it("does not swallow a nested busy lock for another key", async () => {
  const store = new MemoryStorage();
  const holder = hold(store, "other");
  const work = vi.fn(() => store.lock("other", async () => "nested"));
  const started = Date.now();
  const error = await waitForLock(store, "key", work, 2000).catch(caught => caught);
  expect(error).toBeInstanceOf(StorageLockBusy);
  expect(error.key).toBe("other");
  expect(work).toHaveBeenCalledOnce();
  expect(Date.now() - started).toBeLessThan(1000);
  holder.release();
  await holder.operation;
});

it("does not retry a busy error for a different key or another failure from acquisition", async () => {
  const store = new MemoryStorage();
  const lock = vi.spyOn(store, "lock").mockRejectedValue(new StorageLockBusy("different"));
  await expect(waitForLock(store, "key", async () => 1, 2000)).rejects.toMatchObject({ key: "different" });
  expect(lock).toHaveBeenCalledOnce();
  lock.mockClear().mockRejectedValue(new Error("disk"));
  await expect(waitForLock(store, "key", async () => 1, 2000)).rejects.toThrow("disk");
  expect(lock).toHaveBeenCalledOnce();
});
