import { expect, it, vi, afterEach } from "vitest";
import { machineId } from "../src/core/machine";
import { MemoryStorage } from "../src/storage/memory";
afterEach(() => vi.unstubAllEnvs());
it("persists a stable machine identity", async () => {
  const store = new MemoryStorage();
  const first = await machineId(store);
  expect(await machineId(store)).toBe(first);
  expect(first).toMatch(/^[a-f0-9-]+$/);
});
it("supports an explicit machine identity", async () => {
  vi.stubEnv("IMAGE_QUEUE_MACHINE_ID", "workstation");
  expect(await machineId(new MemoryStorage())).toBe("workstation");
});

it("reuses the identity written by another client before the lock was acquired", async () => {
  const store = new MemoryStorage();
  const lock = store.lock.bind(store);
  vi.spyOn(store, "lock").mockImplementation(async (key, work) => {
    await store.put("settings", "machine", { id: "existing-workstation" });
    return lock(key, work);
  });

  expect(await machineId(store)).toBe("existing-workstation");
  expect(await store.get("settings", "machine")).toEqual({ id: "existing-workstation" });
});
