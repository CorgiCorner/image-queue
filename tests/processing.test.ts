import { afterEach, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MemoryStorage } from "../src/storage/memory";
import { ImageService } from "../src/core/service";
import { hash, type Job } from "../src/core/schema";
import {
  changeProcessing,
  sourceControls,
  recordFailure,
  resumeAfterReset,
  admitted,
} from "../src/core/processing";
import { startApiRunner } from "../src/core/api-runner";
import { generate } from "../src/sources/providers";
vi.mock("../src/sources/providers", () => ({ generate: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const result = {
  bytes: new Uint8Array([3]),
  mime: "image/png",
  usage: {},
} as Awaited<ReturnType<typeof generate>>;
async function fixture(count: number) {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "synthetic-unit-test");
  const store = new MemoryStorage();
  await store.put("models", "openai", [
    { id: "gpt-image-1.5", provider: "openai" },
  ]);
  const service = new ImageService(store);
  const project = await service.createProject("Tests");
  const jobs: Job[] = [];
  for (let i = 0; i < count; i++)
    jobs.push(
      await service.create({
        projectId: project.id,
        idempotencyKey: `task-${i}`,
        source: "api",
        provider: "openai",
        model: "gpt-image-1.5",
        prompt: `Test image ${i}`,
        width: 1024,
        height: 1024,
        referenceIds: [],
        transparent: false,
      }),
    );
  return { store, jobs };
}
it("counts distinct failures in a rolling window, persists the stop, and keeps manual pause through a quota reset", async () => {
  const store = new MemoryStorage();
  await changeProcessing(store, {
    source: "api",
    policy: { limit: 3, windowMinutes: 10 },
  });
  await recordFailure(store, "api", "old", { id: "old" }, 0);
  await Promise.all(
    ["a", "a", "b"].map((id) =>
      recordFailure(store, "api", "bad", { id }, 600000),
    ),
  );
  expect((await sourceControls(store, "api")).blockedReason).toBeUndefined();
  await recordFailure(store, "api", "bad", { id: "c" }, 600001);
  expect((await sourceControls(store, "api")).blockedReason).toContain(
    "3 requests",
  );
  await changeProcessing(store, { source: "api", paused: false });
  const reset = new Date(0).toISOString();
  await recordFailure(store, "api", "limit", { stop: true, resumeAt: reset });
  await changeProcessing(store, { source: "all", paused: true });
  expect(await resumeAfterReset(store, "api", reset)).toBe(false);
  await changeProcessing(store, { source: "api", paused: true });
  await changeProcessing(store, { source: "all", paused: false });
  expect(await admitted(store, "api")).toBe(false);
  expect(await resumeAfterReset(store, "api", reset)).toBe(false);
});
it("resumes queued jobs across executor restart, bounds work and never repeats ambiguous attempts", async () => {
  const { store } = await fixture(12);
  await changeProcessing(store, { source: "api", workers: 2, paused: true });
  let peak = 0,
    active = 0;
  const sends = new Set<string>();
  vi.mocked(generate).mockImplementation(async (job) => {
    if (sends.has(job.id)) throw Error("duplicate");
    sends.add(job.id);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    if (["IMG-task-0", "IMG-task-1", "IMG-task-2"].includes(job.id))
      throw Error("transport");
    return result;
  });
  const first = await startApiRunner(store, 10);
  await expect(startApiRunner(store, 10)).rejects.toThrow("in progress");
  await first.stop();
  expect(sends.size).toBe(0);
  const second = await startApiRunner(store, 10);
  try {
    await changeProcessing(store, { source: "api", paused: false });
    await vi.waitFor(
      async () => expect(await store.list("api-pending")).toHaveLength(0),
      { timeout: 5000 },
    );
    const saved = await store.list<Job>("jobs");
    expect(saved.filter((j) => j.status === "done")).toHaveLength(9);
    expect(saved.filter((j) => j.status === "uncertain")).toHaveLength(3);
    expect(peak).toBe(2);
    expect(generate).toHaveBeenCalledTimes(12);
  } finally {
    await second.stop();
  }
});
it("recovers a durable output and fences an interrupted send without contacting the provider", async () => {
  const { store, jobs } = await fixture(2);
  for (const job of jobs)
    await store.put("jobs", job.id, {
      ...job,
      status: "running",
      attemptId: job.id,
    });
  const blobKey = `results/${await hash(new Uint8Array([3]))}`;
  await store.putBlob(blobKey, new Uint8Array([3]), "image/png");
  await store.put("api-results", jobs[0].id, {
    ...jobs[0],
    status: "done",
    attemptId: jobs[0].id,
    blobKey,
  });
  const runner = await startApiRunner(store, 10);
  try {
    expect((await store.get<Job>("jobs", jobs[0].id))?.status).toBe("done");
    expect((await store.get<Job>("jobs", jobs[1].id))?.status).toBe(
      "uncertain",
    );
    expect(generate).not.toHaveBeenCalled();
  } finally {
    await runner.stop();
  }
});
it("stops on provider rejection and preserves the following requests", async () => {
  const { store } = await fixture(3);
  vi.mocked(generate).mockRejectedValueOnce(
    new APICallError({
      message: "test",
      url: "fixture",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "retry-after": "600" },
    }),
  );
  const runner = await startApiRunner(store, 10);
  try {
    await vi.waitFor(async () =>
      expect(
        (await store.list<Job>("jobs")).filter(
          (job) => job.status === "failed",
        ),
      ).toHaveLength(1),
    );
    expect(await store.list("api-pending")).toHaveLength(2);
    expect((await sourceControls(store, "api")).resumeAt).toBeTruthy();
    expect(generate).toHaveBeenCalledTimes(1);
  } finally {
    await runner.stop();
  }
});

it("stops at the configured failure budget, retains it through restart and resumes only independent work", async () => {
  const { store } = await fixture(6);
  await changeProcessing(store, {
    source: "api",
    policy: { limit: 3, windowMinutes: 90 },
  });
  vi.mocked(generate)
    .mockRejectedValueOnce(Error("fixture"))
    .mockRejectedValueOnce(Error("fixture"))
    .mockRejectedValueOnce(Error("fixture"))
    .mockResolvedValue(result);
  const first = await startApiRunner(store, 10);
  try {
    await vi.waitFor(async () =>
      expect((await sourceControls(store, "api")).blockedReason).toContain(
        "3 requests",
      ),
    );
  } finally {
    await first.stop();
  }
  expect(generate).toHaveBeenCalledTimes(3);
  const second = await startApiRunner(store, 10);
  try {
    expect(await store.list("api-pending")).toHaveLength(3);
    await changeProcessing(store, { source: "queue", paused: false });
    expect(await admitted(store, "queue")).toBe(true);
    expect(await admitted(store, "api")).toBe(false);
    await changeProcessing(store, { source: "api", paused: false });
    await vi.waitFor(async () =>
      expect(await store.list("api-pending")).toHaveLength(0),
    );
    expect(
      (await store.list<Job>("jobs")).filter((j) => j.status === "done"),
    ).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(6);
  } finally {
    await second.stop();
  }
});
