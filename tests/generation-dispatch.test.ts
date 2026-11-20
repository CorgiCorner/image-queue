import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import type { Job } from "../src/core/schema";

const { state } = vi.hoisted(() => ({
  state: { store: undefined as unknown, env: {} as Record<string, unknown> },
}));
vi.mock("../src/storage", () => ({ storage: async () => state.store }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));
import { abandonQueuedJob, dispatch, runQueuedJob } from "../src/core/runtime";

let store: MemoryStorage;
const job = (patch: Partial<Job> = {}) => ({
  id: "IMG-remote",
  projectId: "project",
  source: "api",
  provider: "openai",
  model: "gpt-image-2",
  prompt: "A blue square",
  width: 1024,
  height: 1024,
  referenceIds: [],
  status: "queued",
  createdAt: "2026-11-19T20:00:00.000Z",
  updatedAt: "2026-11-19T20:00:00.000Z",
  ...patch,
}) as Job;

beforeEach(() => {
  store = new MemoryStorage();
  state.store = store;
  state.env = {};
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

it("hands a Cloudflare provider job to the generation queue without contacting the provider", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  state.env = { GENERATION_QUEUE: { send } };
  await store.put("jobs", "IMG-remote", job());
  await dispatch("IMG-remote");
  expect(send).toHaveBeenCalledExactlyOnceWith({ jobId: "IMG-remote" });
  expect((await store.get<Job>("jobs", "IMG-remote"))?.status).toBe("queued");
});

it("records a job as failed when the queue cannot accept it, before any provider request", async () => {
  for (const env of [{}, { GENERATION_QUEUE: { send: vi.fn().mockRejectedValue(new Error("queue down")) } }]) {
    state.env = env;
    await store.put("jobs", "IMG-remote", job());
    await dispatch("IMG-remote");
    expect(await store.get<Job>("jobs", "IMG-remote")).toMatchObject({
      status: "failed",
      error: "Generation could not be started. No provider request was made.",
    });
  }
});

it("does not queue a job that is no longer waiting", async () => {
  const send = vi.fn();
  state.env = { GENERATION_QUEUE: { send } };
  await store.put("jobs", "IMG-remote", job({ status: "done" }));
  await dispatch("IMG-remote");
  expect(send).not.toHaveBeenCalled();
});

it("keeps the Codex file queue local-only on Cloudflare", async () => {
  const send = vi.fn();
  state.env = { GENERATION_QUEUE: { send } };
  await store.put("jobs", "IMG-remote", job({ source: "queue" }));
  await expect(dispatch("IMG-remote")).rejects.toThrow("only in a local installation");
  expect(send).not.toHaveBeenCalled();
});

it("records a queued job that cannot start as failed with its reason", async () => {
  await store.put("jobs", "IMG-remote", job());
  await runQueuedJob("IMG-remote");
  expect(await store.get<Job>("jobs", "IMG-remote")).toMatchObject({
    status: "failed",
    error: "Connect this provider in Settings first",
  });
});

it("records unexpected start failures without exposing their details", async () => {
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "fixture-key");
  const get = store.get.bind(store);
  for (const failure of [new Error("Authorization: Bearer private-background-key"), "bad"]) {
    vi.spyOn(store, "get").mockImplementation(async (collection: string, id: string) => {
      if (collection === "models") throw failure;
      return get(collection, id);
    });
    await store.put("jobs", "IMG-remote", job());
    await runQueuedJob("IMG-remote");
    const saved = await get<Job>("jobs", "IMG-remote");
    expect(saved).toMatchObject({ status: "failed", error: "Generation failed" });
    expect(JSON.stringify(saved)).not.toContain("private-background-key");
  }
});

it("reports a busy job without failing it, and abandons it only when asked", async () => {
  await store.put("jobs", "IMG-remote", job());
  await store.lock("IMG-remote", async () => {
    expect(await runQueuedJob("IMG-remote")).toBe("busy");
    // Still locked: abandoning must not throw or change anything.
    await abandonQueuedJob("IMG-remote");
  });
  expect((await store.get<Job>("jobs", "IMG-remote"))?.status).toBe("queued");
  await abandonQueuedJob("IMG-remote");
  expect(await store.get<Job>("jobs", "IMG-remote")).toMatchObject({
    status: "failed",
    error: "Generation could not start because the request stayed busy. No provider request was made.",
  });
});
