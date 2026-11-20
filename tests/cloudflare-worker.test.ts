import { expect, it, vi } from "vitest";
const { maintain, fetchHandler, bindings, runQueuedJob, abandonQueuedJob, runWithContext } = vi.hoisted(() => ({
  maintain: vi.fn().mockResolvedValue([]),
  fetchHandler: vi.fn(),
  bindings: vi.fn(),
  runQueuedJob: vi.fn().mockResolvedValue("finished"),
  abandonQueuedJob: vi.fn().mockResolvedValue(undefined),
  runWithContext: vi.fn(async (_request: Request, _env: unknown, _ctx: unknown, work: () => Promise<unknown>) => work()),
}));
vi.mock("./.open-next/worker.js", () => ({ default: { fetch: fetchHandler } }));
vi.mock("./generated-init-stub", () => ({ runWithCloudflareRequestContext: runWithContext }));
vi.mock("../src/core/maintenance", () => ({ maintainTrash: maintain }));
vi.mock("../src/core/runtime", () => ({ runQueuedJob, abandonQueuedJob }));
vi.mock("../src/storage/cloudflare", () => ({
  CloudflareStorage: class { constructor(db: unknown, blobs: unknown) { bindings(db, blobs); } },
}));
import worker from "../cloudflare-worker";
import { busyRetryDelaySeconds, maxBusyAttempts } from "../src/core/generation-queue";

const env = { DB: {}, BLOBS: {} } as Parameters<typeof worker.scheduled>[1];
const ctx = { waitUntil: vi.fn() };
const message = (body: unknown) => ({ body, ack: vi.fn() });

it("preserves the app handler and awaits scheduled maintenance with event time", async () => {
  await worker.scheduled({ scheduledTime: 12345 }, env);
  expect(worker.fetch).toBe(fetchHandler);
  expect(bindings).toHaveBeenCalledWith(env.DB, env.BLOBS);
  expect(maintain).toHaveBeenCalledWith(expect.anything(), 12345);
});

it("keeps the hourly trigger, the queue without retries and no public workers.dev route", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  expect(config.main).toBe("cloudflare-worker.ts");
  expect(config.triggers.crons).toEqual(["0 * * * *"]);
  expect(config.workers_dev).toBe(false);
  expect(config.preview_urls).toBe(false);
  expect(config.queues.producers).toEqual([{ binding: "GENERATION_QUEUE", queue: "image-queue-generation" }]);
  expect(config.queues.consumers).toEqual([expect.objectContaining({
    queue: "image-queue-generation", max_batch_size: 1, max_retries: 0,
  })]);
});

it("propagates maintenance failure to the scheduled invocation", async () => {
  maintain.mockRejectedValueOnce(new Error("maintenance failed"));
  await expect(worker.scheduled({ scheduledTime: 12345 }, env)).rejects.toThrow("maintenance failed");
});

it("runs each queued job inside the Cloudflare context and acknowledges every message once", async () => {
  const valid = message({ jobId: "IMG-remote" });
  const malformed = [message(null), message({ jobId: 7 }), message("IMG-remote")];
  await worker.queue({ messages: [valid, ...malformed] }, env, ctx);
  expect(runQueuedJob).toHaveBeenCalledTimes(1);
  expect(runQueuedJob).toHaveBeenCalledWith("IMG-remote");
  expect(runWithContext).toHaveBeenCalledWith(expect.any(Request), env, ctx, expect.any(Function));
  for (const item of [valid, ...malformed]) expect(item.ack).toHaveBeenCalledTimes(1);
});

it("offers a busy job again later and abandons it after the last attempt", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const withQueue = { ...env, GENERATION_QUEUE: { send } };
  runQueuedJob.mockResolvedValue("busy");
  try {
    const first = message({ jobId: "IMG-busy" });
    await worker.queue({ messages: [first] }, withQueue, ctx);
    expect(send).toHaveBeenCalledExactlyOnceWith({ jobId: "IMG-busy", attempt: 1 }, { delaySeconds: busyRetryDelaySeconds });
    expect(first.ack).toHaveBeenCalledOnce();
    expect(abandonQueuedJob).not.toHaveBeenCalled();

    const last = message({ jobId: "IMG-busy", attempt: maxBusyAttempts });
    await worker.queue({ messages: [last] }, withQueue, ctx);
    expect(send).toHaveBeenCalledOnce();
    expect(abandonQueuedJob).toHaveBeenCalledExactlyOnceWith("IMG-busy");
    expect(last.ack).toHaveBeenCalledOnce();
  } finally {
    runQueuedJob.mockResolvedValue("finished");
  }
});
