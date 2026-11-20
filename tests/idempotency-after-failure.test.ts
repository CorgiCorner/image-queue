import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { ImageService } from "../src/core/service";
import type { Job } from "../src/core/schema";

async function setup() {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Keys");
  const request = { projectId: project.id, idempotencyKey: "corgi-gif", prompt: "A corgi typing", width: 1024, height: 1024, source: "queue" as const,
    provider: "openai" as const, model: "", transparent: false, referenceIds: [] };
  return { store, api, request };
}

it("lets a corrected request reuse the key of a request that failed, without creating duplicates", async () => {
  const { store, api, request } = await setup();
  const first = await api.create(request);
  await store.put("jobs", first.id, { ...first, status: "failed", error: "The provider rejected the image request" });

  const corrected = await api.create({ ...request, width: 960, height: 960 });
  expect(corrected.id).toMatch(/^IMG-corgi-gif-[A-Za-z0-9]{8}$/);
  expect(corrected.status).toBe("queued");
  // Repeating the corrected request returns the same job; repeating the failed one returns the failed job.
  expect((await api.create({ ...request, width: 960, height: 960 })).id).toBe(corrected.id);
  expect((await api.create(request)).status).toBe("failed");
  expect((await store.list<Job>("jobs")).length).toBe(2);
});

it("still refuses a different request under the key of a request that is queued, running or done", async () => {
  const { store, api, request } = await setup();
  const first = await api.create(request);
  await expect(api.create({ ...request, prompt: "A cat typing" }))
    .rejects.toThrow(`Idempotency key already belongs to a different request (${first.id}, queued). Use a new idempotencyKey`);
  await store.put("jobs", first.id, { ...first, status: "done" });
  await expect(api.create({ ...request, prompt: "A cat typing" })).rejects.toThrow("different request");
});
