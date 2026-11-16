import { describe, expect, it } from "vitest";
import {
  finishPool,
  MAX_WORKERS,
  poolConfig,
  savePoolConfig,
  tickPool,
  workerConfigurationPrompt,
} from "../src/core/pool";
import type { Storage } from "../src/storage/types";

it("records and preserves the shared worker instruction version in heartbeats", async () => {
  const store = memory();
  const pulse = await tickPool(store, { slot: 1, workerId: "worker", queueHash: "hash", hasReservation: false, now: 1000, workerInstructionsVersion: "image-queue-worker-v2" });
  expect(pulse.workerInstructionsVersion).toBe("image-queue-worker-v2");
  const finished = await finishPool(store, { slot: 1, workerId: "worker", queueHash: "hash", now: 2000 });
  expect(finished.workerInstructionsVersion).toBe("image-queue-worker-v2");
  await expect(tickPool(store, { slot: 1, workerId: "worker", queueHash: "hash", hasReservation: false, now: 3000, workerInstructionsVersion: "invalid" })).rejects.toThrow();
});

function memory() {
  const data = new Map<string, unknown>();
  return {
    get: async (c: string, id: string) => data.get(`${c}/${id}`),
    put: async (c: string, id: string, v: unknown) => {
      data.set(`${c}/${id}`, v);
    },
    lock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  } as Storage;
}
describe("fixed worker pool", () => {
  it("persists a validated chat model and effort without changing legacy settings", async () => {
    const store = memory();
    const legacy = await poolConfig(store);
    expect(workerConfigurationPrompt(legacy)).toContain("gpt-6.1-sol, reasoning effort low");
    const saved = await savePoolConfig(store, { ...legacy, workers: 1, workerModel: "gpt-6.1-terra", workerEffort: "high" });
    expect(await poolConfig(store)).toEqual(saved);
    expect(workerConfigurationPrompt(await poolConfig(store))).toContain("gpt-6.1-terra, reasoning effort high");
    expect(workerConfigurationPrompt(saved)).toContain("at most 1 worker slots active");
    await expect(savePoolConfig(store, { ...saved, workerModel: "unavailable-model" })).rejects.toThrow();
    await expect(savePoolConfig(store, { ...saved, workerEffort: "invented" })).rejects.toThrow();
    expect(await poolConfig(store)).toEqual(saved);
  });
  it("validates limits and returns defaults", async () => {
    const store = memory();
    expect((await poolConfig(store)).workers).toBe(4);
    await expect(savePoolConfig(store, { workers: 50 })).rejects.toThrow();
    await expect(
      tickPool(store, {
        slot: MAX_WORKERS + 1,
        workerId: "a",
        queueHash: "a",
        hasReservation: false,
        now: 0,
      }),
    ).rejects.toThrow();
  });
  it("gates idle ticks and opens an activity window only on changed work", async () => {
    const store = memory();
    const input = {
      slot: 1,
      workerId: "a",
      queueHash: "a",
      hasReservation: false,
      now: 100000,
    };
    expect((await tickPool(store, input)).allowed).toBe(true);
    expect((await tickPool(store, { ...input, now: 110000 })).allowed).toBe(
      false,
    );
    const changed = await tickPool(store, {
      ...input,
      queueHash: "b",
      now: 400000,
    });
    expect(changed.mode).toBe("active");
    expect(changed.nextEligible).toBe(460000);
    expect(
      (await tickPool(store, { ...input, queueHash: "b", now: 1100000 })).mode,
    ).toBe("idle");
  });
  it("drains owned reservations while disabling new claims", async () => {
    const store = memory();
    await savePoolConfig(store, {
      workers: 0,
      idleMinutes: 5,
      activeMinutes: 1,
      activityWindowMinutes: 10,
    });
    const input = {
      slot: 1,
      workerId: "a",
      queueHash: "a",
      hasReservation: false,
      now: 1000,
    };
    expect((await tickPool(store, input)).allowed).toBe(false);
    const draining = await tickPool(store, { ...input, hasReservation: true });
    expect(draining.allowed).toBe(true);
    expect(draining.draining).toBe(true);
  });
  it("protects slot ownership and records completed work", async () => {
    const store = memory();
    const input = {
      slot: 1,
      workerId: "a",
      queueHash: "a",
      hasReservation: false,
      now: 1000,
    };
    await tickPool(store, input);
    await expect(tickPool(store, { ...input, workerId: "b" })).rejects.toThrow(
      "another worker",
    );
    await expect(
      finishPool(store, { slot: 1, workerId: "b", queueHash: "b", now: 2000 }),
    ).rejects.toThrow();
    const finished = await finishPool(store, {
      slot: 1,
      workerId: "a",
      queueHash: "b",
      claimedAt: "2026-11-14",
      now: 2000,
    });
    expect(finished.lastClaim).toBe("2026-11-14");
    expect(
      (
        await finishPool(store, {
          slot: 1,
          workerId: "a",
          queueHash: "b",
          now: 3000,
        })
      ).queueHash,
    ).toBe("b");
  });
});
