import { expect, it, vi } from "vitest";
import { png } from "./fixtures";
import { MemoryStorage } from "../src/storage/memory";
import { importProjectImages } from "../src/storage/import-project-images";
vi.mock("../src/sources/queue", () => ({ configuredQueueRoot: async () => "/queue", queueOutput: vi.fn(async () => png) }));
it("imports queue bytes once and preserves the worker output path", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", projectId: "p", status: "done", source: "queue", outputPath: "/queue/out/one/image.png" });
  expect(await importProjectImages(store, "p")).toBe(1);
  expect(await importProjectImages(store, "p")).toBe(0);
  const job = await store.get<{ blobKey: string; outputPath: string }>("jobs", "one");
  expect(job?.outputPath).toBe("/queue/out/one/image.png");
  expect((await store.getBlob(job!.blobKey))?.bytes).toEqual(png);
});

it("leaves the job unchanged when queue output cannot be read", async () => {
  const { queueOutput } = await import("../src/sources/queue");
  vi.mocked(queueOutput).mockRejectedValueOnce(new Error("Output path escapes job directory"));
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", projectId: "p", status: "done", source: "queue" });
  await expect(importProjectImages(store, "p")).rejects.toThrow("escapes");
  expect(await store.get("jobs", "one")).not.toHaveProperty("blobKey");
});

it("does not link a job to corrupted stored bytes", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", projectId: "p", status: "done", source: "queue" });
  const putBlob = store.putBlob.bind(store);
  store.putBlob = async (key, _bytes, mime) => putBlob(key, new Uint8Array([1]), mime);
  await expect(importProjectImages(store, "p")).rejects.toThrow("verification failed");
  expect(await store.get("jobs", "one")).not.toHaveProperty("blobKey");
});

it("skips unfinished jobs and jobs from other projects", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "running", { id: "running", projectId: "p", status: "running", source: "queue" });
  await store.put("jobs", "other", { id: "other", projectId: "other", status: "done", source: "queue" });
  expect(await importProjectImages(store, "p")).toBe(0);
});

it("imports each original once after a conflicting migration attempt is retried", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", projectId: "p", status: "done", source: "queue" });
  const [first, second] = await Promise.allSettled([
    importProjectImages(store, "p"),
    importProjectImages(store, "p"),
  ]);
  expect(first).toEqual({ status: "fulfilled", value: 1 });
  expect(second).toMatchObject({ status: "rejected", reason: { message: "Another operation is in progress. Try again." } });
  expect(await importProjectImages(store, "p")).toBe(0);
  const job = await store.get<{ blobKey: string }>("jobs", "one");
  expect((await store.getBlob(job!.blobKey))?.bytes).toEqual(png);
});

it("rejects a provider result whose original is missing", async () => {
  const store = new MemoryStorage();
  const job = { id: "one", projectId: "p", status: "done", source: "api" };
  await store.put("jobs", job.id, job);
  await expect(importProjectImages(store, "p")).rejects.toThrow("Original image is unavailable");
  expect(await store.get("jobs", job.id)).toEqual(job);
});

it("skips a record moved to another project before the importer acquires its lock", async () => {
  const store = new MemoryStorage();
  const job = { id: "one", projectId: "p", status: "done", source: "queue" };
  await store.put("jobs", job.id, job);
  const lock = store.lock.bind(store);
  store.lock = (key, work) => lock(key, async () => {
    await store.put("jobs", job.id, { ...job, projectId: "destination" });
    return work();
  });
  expect(await importProjectImages(store, "p")).toBe(0);
  expect(await store.get("jobs", job.id)).toEqual({ ...job, projectId: "destination" });
});
