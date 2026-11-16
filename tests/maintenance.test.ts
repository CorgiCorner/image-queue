import { afterEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { maintainTrash, startTrashMaintenance } from "../src/core/maintenance";

afterEach(() => vi.useRealTimers());

it("runs expiration maintenance against the storage contract", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "old", { id: "old", status: "done", trashedAt: "2026-01-01" });
  expect(await maintainTrash(store, Date.parse("2026-11-14"))).toEqual(["old"]);
  expect(await store.get("tombstones", "old")).toBeTruthy();
});

it("runs immediately, retries failures and stops its timer", async () => {
  vi.useFakeTimers();
  const getStore = vi.fn().mockRejectedValueOnce(new Error("private details"))
    .mockResolvedValue(new MemoryStorage());
  const report = vi.fn();
  const stop = startTrashMaintenance(getStore, report, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(report).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(getStore).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(getStore).toHaveBeenCalledTimes(2);
});

it("skips overlapping runs and resumes once the pending run settles", async () => {
  vi.useFakeTimers();
  let resolve!: (store: MemoryStorage) => void;
  const getStore = vi.fn(() => new Promise<MemoryStorage>(done => { resolve = done; }));
  const stop = startTrashMaintenance(getStore, vi.fn(), 1000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(getStore).toHaveBeenCalledTimes(1);
  resolve(new MemoryStorage());
  await vi.advanceTimersByTimeAsync(1000);
  expect(getStore).toHaveBeenCalledTimes(2);
  stop();
  resolve(new MemoryStorage());
});
