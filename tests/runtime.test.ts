import { createHash } from "node:crypto";
import { png, mp4 } from "./fixtures";
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importExistingQueue } from "../src/core/import-queue";
import { enqueue, refreshedJobs, retryBlockedQueueJob, retryImageJob, service } from "../src/core/runtime";
import type { Job } from "../src/core/schema";
import { ImageService } from "../src/core/service";
import { ProjectStorage } from "../src/storage/project-storage";
import { FileStorage } from "../src/storage/fs";

// These unit tests explicitly supply verified fixture capabilities for each sizing mode.
// Production uses the static, evidence-backed registry; unknown IDs still use that boundary.
vi.mock("../src/core/model-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/model-profiles")>();
  return { ...actual, applyVerifiedModelProfiles: (models: import("../src/core/schema").Model[]) =>
    actual.applyVerifiedModelProfiles(models.map(model => model.id === "gpt-image-test" ? {...model, provider: "openai" as const} : model), models.filter(model => model.id === "gpt-image-test" && actual.verifiedModelProfileSchema.shape.sizeProfile.safeParse(model.sizeProfile).success).map(model => ({
      provider: "openai" as const, model: "gpt-image-test", sizeProfile: model.sizeProfile!,
      references: model.references, transparency: model.transparency,
      documentation: "https://example.com/fixture", verifiedAt: "2026-11-15T00:00:00Z",
      evidence: { generation: "fixture", referenceEdit: "fixture" },
    })))
  };
});

vi.mock("../src/sources/providers", () => ({
  generate: vi.fn(async () => ({
    bytes: new Uint8Array([1]),
    mime: "image/png",
    usage: {},
  })),
}));

import { generate } from "../src/sources/providers";

let root: string;
let store: FileStorage;
let api: ImageService;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "runtime-test-"));
  process.env.STORAGE_DIR = path.join(root, "storage");
  process.env.IMAGE_QUEUE_CREDENTIALS_DIR = path.join(root, "credentials");
  process.env.CODEX_QUEUE_DIR = path.join(root, "queue");
  store = new FileStorage(process.env.STORAGE_DIR);
  api = new ImageService(store);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  for (const key of [
    "STORAGE_DIR",
    "IMAGE_QUEUE_CREDENTIALS_DIR",
    "CODEX_QUEUE_DIR",
    "STORAGE_DRIVER",
    "OPENAI_API_KEY",
  ])
    delete process.env[key];
  vi.mocked(generate).mockReset();
  vi.mocked(generate).mockResolvedValue({
    bytes: new Uint8Array([1]),
    mime: "image/png",
    usage: {},
  } as never);
});
async function make(source: "queue" | "api" = "queue") {
  const p = await api.createProject("Test");
  return api.create({
    projectId: p.id,
    idempotencyKey: crypto.randomUUID(),
    prompt: "Painted panda",
    source,
    provider: "openai",
    model: source === "api" ? "gpt-image-test" : "",
    width: 1024,
    height: 1024,
    transparent: false,
    referenceIds: [],
  });
}
describe("runtime", () => {
  it("uses configured storage", async () => {
    expect((await service()).store).toBeInstanceOf(ProjectStorage);
  });
  it("publishes queue metadata and refreshes terminal statuses", async () => {
    const job = await make();
    await enqueue(job.id);
    const saved = (await api.jobs())[0];
    expect(saved.outputPath).toContain(job.id);
    expect((await refreshedJobs())[0].status).toBe("queued");
    const f = path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md");
    await writeFile(
      f,
      (await readFile(f, "utf8")).replace(
        "Status: pending",
        "Status: blocked: missing reference",
      ),
    );
    expect((await refreshedJobs())[0].status).toBe("blocked");
    expect((await refreshedJobs())[0].status).toBe("blocked");
  });
  it("replays a blocked queue entry once with its original reference and corrected size line", async () => {
    const original = await make();
    const queueDirectory = process.env.CODEX_QUEUE_DIR!;
    const queueFile = path.join(queueDirectory, "images-todo.md");
    await mkdir(queueDirectory);
    await writeFile(path.join(root, "art-notes.md"), "Preserve the palette");
    await store.put("settings", "paths", { queueDirectory, referenceDirectories: [root] });
    await store.put("jobs", original.id, { ...original, status: "blocked" });
    const initial = `## ${original.id}\n- Status: blocked\n- Size: 1080x1920\n- Background: opaque\n- References: art-notes.md\n- Prompt: Repaint the panda\n`;
    await writeFile(queueFile, initial);
    const first = await retryImageJob(original.id);
    const second = await retryBlockedQueueJob(original.id);
    expect(second.id).toBe(first.id);
    expect(first.id).not.toBe(original.id);
    const text = await readFile(queueFile, "utf8");
    expect(text.startsWith(initial)).toBe(true);
    expect(text.match(/^## /gm)).toHaveLength(2);
    expect(text).toContain("- Size: 1080x1920 PNG");
    expect(text).toMatch(/- References: \/[^\r\n]+\/art-notes\.md/);
    expect(await store.get<Job>("jobs", original.id)).toMatchObject({ status: "blocked" });
  });
  it("can retry a blocked retry as a separate attempt without altering prior entries", async () => {
    const original = await make();
    const queueDirectory = process.env.CODEX_QUEUE_DIR!;
    const queueFile = path.join(queueDirectory, "images-todo.md");
    await mkdir(queueDirectory);
    await store.put("jobs", original.id, { ...original, status: "blocked" });
    await writeFile(queueFile, `## ${original.id}\n- Status: blocked\n- Size: 1024x1024 PNG\n- References: none\n- Prompt: Paint another panda\n`);
    const first = await retryBlockedQueueJob(original.id);
    await writeFile(queueFile, (await readFile(queueFile, "utf8")).replace("- Status: pending", "- Status: blocked"));
    await refreshedJobs();
    const second = await retryBlockedQueueJob(first.id);
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
    const { parseQueue } = await import("../src/sources/queue");
    expect(parseQueue(await readFile(queueFile, "utf8")).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: original.id, status: "blocked" },
      { id: first.id, status: "blocked" },
      { id: second.id, status: "pending" },
    ]);
  });
  it("retries an exported dropped reference when the queue is outside allowed import roots", async () => {
    const original = await make();
    const reference = await api.addReference(original.projectId, "hat.png", "image/png", png);
    await store.put("jobs", original.id, { ...original, referenceIds: [reference.id] });
    const queueDirectory = process.env.CODEX_QUEUE_DIR!;
    const external = path.join(root, "external-imports");
    await mkdir(external);
    await store.put("settings", "paths", { queueDirectory, referenceDirectories: [external] });
    await enqueue(original.id);
    const queueFile = path.join(queueDirectory, "images-todo.md");
    await writeFile(queueFile, (await readFile(queueFile, "utf8")).replace("- Status: pending", "- Status: blocked: fixture"));
    await refreshedJobs();
    const retry = await retryBlockedQueueJob(original.id);
    const { parseQueue } = await import("../src/sources/queue");
    const entries = parseQueue(await readFile(queueFile, "utf8"));
    expect(entries.find(entry => entry.id === retry.id)?.references).toBe(await realpath(entries[0].references!));
    expect(entries.find(entry => entry.id === retry.id)?.prompt).toBe(original.prompt);
    expect(await readFile(entries[0].references!)).toEqual(Buffer.from(png));
  });
  it("copies reference images into the queue output directory", async () => {
    const job = await make();
    const ref = await api.addReference(
      job.projectId,
      "x.png",
      "image/png",
      png,
    );
    await store.put("jobs", job.id, { ...job, referenceIds: [ref.id] });
    await enqueue(job.id);
    const text = await readFile(
      path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
      "utf8",
    );
    expect(text).toContain("references");
  });
  it("ignores unknown and terminal jobs", async () => {
    await enqueue("missing");
    const job = await make();
    await store.put("jobs", job.id, { ...job, status: "cancelled" });
    await enqueue(job.id);
    expect((await refreshedJobs())[0].status).toBe("cancelled");
  });
  it("requires an API key and a verified model", async () => {
    const job = await make("api");
    await expect(enqueue(job.id)).rejects.toThrow("Connect");
    process.env.OPENAI_API_KEY = "test-key";
    await expect(enqueue(job.id)).rejects.toThrow("Refresh");
  });
  it("persists attempts before generating and publishes results", async () => {
    const job = await make("api");
    process.env.OPENAI_API_KEY = "test-key";
    await store.put("models", "openai", [
      { id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
    ]);
    await enqueue(job.id);
    const saved = await store.get<Job>("jobs", job.id);
    expect(saved?.status).toBe("done");
    expect(saved?.attemptId).toBeTruthy();
    expect(saved?.provenance).toContain("gpt-image-test");
    const bytes = new Uint8Array([1]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(saved?.blobKey).toBe(`results/${digest}`);
    expect(await store.getBlob(`results/${digest}`)).toEqual({ bytes, mime: "image/png" });
  });
  it("preserves uncertain failures without replaying the request", async () => {
    const job = await make("api");
    process.env.OPENAI_API_KEY = "test-key";
    await store.put("models", "openai", [
      { id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
    ]);
    vi.mocked(generate).mockRejectedValue(new Error("Authorization: Bearer test-key"));
    await enqueue(job.id);
    expect((await api.jobs())[0].status).toBe("uncertain");
    expect(JSON.stringify(await api.jobs())).not.toContain("test-key");
    await enqueue(job.id);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("recovers interrupted API status without calling a provider", async () => {
    const job = await make("api");
    await store.put("jobs", job.id, {
      ...job,
      status: "running",
      startedAt: "2000-01-01T00:00:00Z",
    });
    expect((await refreshedJobs())[0].status).toBe("uncertain");
    expect(generate).not.toHaveBeenCalled();
  });
});
describe("importer", () => {
  it("keeps an initialized empty queue free of sample projects", async () => {
    await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
    await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"), "# Image queue\n");
    await importExistingQueue(store);
    expect(await api.projects()).toEqual([]);
    expect(await api.jobs()).toEqual([]);
  });
  it("imports queue metadata and preserves existing project assignments", async () => {
    await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
    await writeFile(
      path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
      "## IMG-old\n- Status: done\n- Filed: 2026-01-01T00:00:00Z\n- Save to: /tmp/old.png\n- Size: 512x1024 PNG\n- Background: transparent\n- Prompt: A panda\n",
    );
    await importExistingQueue(store);
    await importExistingQueue(store);
    const jobs = await api.jobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].width).toBe(512);
    expect(jobs[0].transparent).toBe(true);
    expect((await api.projects())[0].name).toBe("Imported queue");
  });
  it("allows an empty queue and cloud storage", async () => {
    await importExistingQueue(store);
    expect(await api.jobs()).toEqual([]);
    process.env.STORAGE_DRIVER = "cloudflare";
    await importExistingQueue(store);
    expect(await api.jobs()).toEqual([]);
  });
});

it("validates reference capabilities and preserves missing-file failures", async () => {
  const job = await make("api");
  process.env.OPENAI_API_KEY = "gpt-image-test";
  const ref = await api.addReference(
    job.projectId,
    "ref.png",
    "image/png",
    png,
  );
  await store.put("jobs", job.id, { ...job, referenceIds: [ref.id] });
  await store.put("models", "openai", [
    { id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
  ]);
  await expect(enqueue(job.id)).rejects.toThrow("references");
  await store.put("models", "openai", [
    { id: "gpt-image-test", references: true, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
  ]);
  await store.put("jobs", job.id, { ...job, transparent: true });
  await expect(enqueue(job.id)).rejects.toThrow("transparency");
  await store.put("jobs", job.id, { ...job, referenceIds: [ref.id] });
  await enqueue(job.id);
  expect((await api.jobs())[0].status).toBe("done");
  const another = {
    ...job,
    id: "IMG-missing-ref",
    idempotencyKey: "missing-ref",
    referenceIds: ["missing"],
  };
  await store.put("jobs", another.id, another);
  await enqueue(another.id);
  expect((await store.get<Job>("jobs", another.id))?.status).toBe("uncertain");
});
it("fails a queue request if a reference disappears", async () => {
  const job = await make();
  await store.put("jobs", job.id, { ...job, referenceIds: ["missing"] });
  await expect(enqueue(job.id)).rejects.toThrow("missing");
});
it("imports legacy defaults, unknown status and in-progress rows", async () => {
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(
    path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
    "## IMG-pending\n- Status: pending\n\n## IMG-progress\n- Status: in-progress\n\n## IMG-unknown\n- Status: unknown\n\n## IMG-blocked\n- Status: blocked: reason\n",
  );
  await importExistingQueue(store);
  const jobs = await api.jobs();
  expect(jobs).toHaveLength(3);
  expect(jobs.find((j) => j.id === "IMG-pending")?.width).toBe(1024);
  expect(jobs.find((j) => j.id === "IMG-progress")?.status).toBe("running");
  expect(jobs.find((j) => j.id === "IMG-blocked")).toMatchObject({ status: "blocked", error: "reason" });
  const blocked = jobs.find((job) => job.id === "IMG-blocked")!;
  await store.put("jobs", blocked.id, { ...blocked, error: undefined });
  const queueFile = path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md");
  const snapshot = await readFile(queueFile, "utf8");
  const nextSnapshot = snapshot.replace("blocked: reason", "blocked: missing reference");
  await writeFile(queueFile, nextSnapshot);

  await importExistingQueue(store);

  expect(await store.get("jobs", blocked.id)).toEqual({ ...blocked, error: "missing reference" });
  expect(await readFile(queueFile, "utf8")).toBe(nextSnapshot);
});
it("reports invalid queue roots instead of hiding filesystem errors", async () => {
  await writeFile(process.env.CODEX_QUEUE_DIR!, "not a directory");
  await expect(importExistingQueue(store)).rejects.toThrow();
});

it("preserves a concurrent observer update and handles a busy job lock", async () => {
  const stores = await import("../src/storage");
  const stub = vi.spyOn(stores, "storage").mockResolvedValue(store);
  const job = await make();
  await enqueue(job.id);
  const lock = vi
    .spyOn(store, "lock")
    .mockRejectedValueOnce(
      new Error("Another operation is in progress. Try again."),
    );
  expect((await refreshedJobs())[0].status).toBe("queued");
  lock.mockRestore();
  const original = store.lock.bind(store);
  vi.spyOn(store, "lock").mockImplementationOnce(async (key, work) => {
    await store.put("jobs", job.id, { ...job, status: "cancelled" });
    return original(key, work);
  });
  expect((await refreshedJobs())[0].status).toBe("cancelled");
  vi.restoreAllMocks();
  stub.mockRestore();
});
it("rejects cloud queue execution before touching files", async () => {
  const stores = await import("../src/storage");
  const stub = vi.spyOn(stores, "storage").mockResolvedValue(store);
  const job = await make();
  process.env.STORAGE_DRIVER = "cloudflare";
  await expect(enqueue(job.id)).rejects.toThrow("local companion");
  stub.mockRestore();
});
it("rejects API generation without a discovered model profile", async () => {
  const job = await make("api");
  process.env.OPENAI_API_KEY = "gpt-image-test";
  await expect(enqueue(job.id)).rejects.toThrow("Refresh provider models");
});
it("rejects sizes unsupported by the selected provider before generation", async () => {
  const job = await make("api");
  process.env.OPENAI_API_KEY = "gpt-image-test";
  await store.put("models", "openai", [
    { id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
  ]);
  await store.put("jobs", job.id, { ...job, width: 4096, height: 4096 });
  await expect(enqueue(job.id)).rejects.toThrow("No native size");
  expect(generate).not.toHaveBeenCalled();
});
it("preserves existing imported jobs when new queue entries arrive", async () => {
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  const file = path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md");
  await writeFile(
    file,
    "## IMG-original\n- Status: done\n- Prompt: Original\n",
  );
  await importExistingQueue(store);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await writeFile(
    file,
    "## IMG-original\n- Status: done\n- Prompt: Changed\n\n## IMG-new\n- Status: done\n- Prompt: New\n",
  );
  await importExistingQueue(store);
  expect((await store.get<Job>("jobs", "IMG-original"))?.prompt).toBe(
    "Original",
  );
  expect(await store.get("jobs", "IMG-new")).toBeTruthy();
});
it("preserves requested dimensions when the provider returns a different size", async () => {
  process.env.OPENAI_API_KEY="test-key";
  vi.mocked(generate).mockResolvedValueOnce({bytes:png,mime:"image/png",width:1000,height:960,usage:{}} as never);
  const job=await make("api");
  await store.put("models","openai",[{id:"gpt-image-test",references:false,transparency:false,sizeProfile:{mode:"fixed",sizes:[{width:1024,height:1024}]}}]);
  await enqueue(job.id);
  const saved=await store.get<Job>("jobs",job.id);
  expect(saved?.requestedSize).toEqual({width:1024,height:1024});
  expect(saved?.generatedSize).toEqual({width:1000,height:960});
  expect(saved?.providerSize).toEqual({width:1024,height:1024});
  expect(JSON.parse(saved!.provenance!)).toMatchObject({
    requestedSize: {width:1024,height:1024},
    providerSize: {width:1024,height:1024},
    generatedSize: {width:1000,height:960},
  });
  expect(saved?.width).toBe(1000);
  expect(saved?.height).toBe(960);
  const retry = await api.create({projectId:job.projectId,idempotencyKey:job.idempotencyKey,prompt:job.prompt,source:job.source,provider:job.provider,model:job.model,width:1024,height:1024,transparent:job.transparent,referenceIds:job.referenceIds});
  expect(retry.id).toBe(job.id);
  expect(retry.generatedSize).toEqual({width:1000,height:960});
});

it("accepts targets covered by a larger stored native model size", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1536, height: 1024 }] },
  }]);
  await enqueue(job.id);
  expect(generate).toHaveBeenCalled();
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.status).toBe("done");
  expect(saved?.requestedSize).toEqual({ width: 1024, height: 1024 });
  expect(saved?.providerSize).toEqual({ width: 1536, height: 1024 });
});

it("accepts exact dimensions inside model limits beyond menu presets", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("jobs", job.id, { ...job, width: 1280, height: 960 });
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "dimensions", minSide: 256, maxSide: 4096,
      multiple: 16, minPixels: 65536, maxPixels: 9000000, minRatio: 0.5, maxRatio: 2 },
  }]);
  await enqueue(job.id);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 960 }), "test-key", [], expect.any(Object));
  expect((await store.get<Job>("jobs", job.id))?.status).toBe("done");
});

it("accepts supported proportions at exact dimensions outside presets", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("jobs", job.id, { ...job, width: 1280, height: 720 });
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "aspect-ratio", ratios: ["16:9"], levels: [] },
  }]);
  await enqueue(job.id);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 720 }), "test-key", [], expect.any(Object));
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.providerSizeParameters).toEqual({ aspectRatio: "16:9" });
  expect(JSON.parse(saved!.provenance!).providerSizeParameters).toEqual({ aspectRatio: "16:9" });
});
it("rejects unsupported proportions before invoking a provider", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "aspect-ratio", ratios: ["16:9"], levels: [] },
  }]);
  await expect(enqueue(job.id)).rejects.toThrow("Unsupported aspect ratio");
  expect(generate).not.toHaveBeenCalled();
});

it("preserves resolved size parameters when provider completion is uncertain", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "aspect-ratio", ratios: ["1:1"], levels: [] },
  }]);
  vi.mocked(generate).mockRejectedValueOnce(new Error("connection interrupted"));
  await enqueue(job.id);
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.status).toBe("uncertain");
  expect(saved?.requestedSize).toEqual({ width: 1024, height: 1024 });
  expect(saved?.providerSizeParameters).toEqual({ aspectRatio: "1:1" });
  await enqueue(job.id);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("records provider dimensions separately from fitted output dimensions", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{ id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } }]);
  vi.mocked(generate).mockResolvedValueOnce({
    bytes: png, mime: "image/png", width: 1024, height: 1024,
    generatedDimensions: { width: 1536, height: 1024 }, usage: {},
  } as never);
  await enqueue(job.id);
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.providerResultSize).toEqual({ width: 1536, height: 1024 });
  expect(JSON.parse(saved!.provenance!).providerResultSize).toEqual({ width: 1536, height: 1024 });
  expect(saved?.generatedSize).toEqual({ width: 1024, height: 1024 });
});

it("retains a generated image when output fitting fails", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{ id: "gpt-image-test", references: false, transparency: false, sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } }]);
  vi.mocked(generate).mockResolvedValueOnce({
    bytes: png, mime: "image/png", width: 512, height: 512,
    adaptationError: "Generated image too small", usage: {},
  } as never);
  await enqueue(job.id);
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.status).toBe("blocked");
  expect(saved?.error).toBe("Generated image too small");
  expect(await store.getBlob(saved!.blobKey!)).toBeTruthy();
  await enqueue(job.id);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("does not reimport a queue entry with a deletion tombstone", async () => {
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
    "## IMG-deleted\n- Status: done\n- Prompt: Deleted result\n");
  await store.put("tombstones", "IMG-deleted", { id: "IMG-deleted", deletedAt: new Date().toISOString() });
  await importExistingQueue(store);
  expect(await store.get("jobs", "IMG-deleted")).toBeUndefined();
});

it("skips a locked queue entry, imports other jobs and checks the tombstone on retry", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const memory = new MemoryStorage();
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
    "## IMG-contended\n- Status: done\n- Prompt: Concurrent result\n\n## IMG-released\n- Status: pending\n\n## IMG-available\n- Status: pending\n");
  await memory.lock("IMG-contended", () => memory.lock("IMG-released", async () => {
    await importExistingQueue(memory);
    expect(await memory.get("jobs", "IMG-available")).toBeDefined();
    expect(await memory.get("jobs", "IMG-contended")).toBeUndefined();
    await memory.put("tombstones", "IMG-contended", { id: "IMG-contended", deletedAt: "2026-11-14" });
  }));
  await importExistingQueue(memory);
  expect(await memory.get("jobs", "IMG-released")).toBeDefined();
  expect(await memory.get("jobs", "IMG-contended")).toBeUndefined();
});

it("keeps provider output dimensions separate from the fitted final image", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const job = await make("api");
  await store.put("models", "openai", [{
    id: "gpt-image-test", references: false, transparency: false,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1536, height: 1024 }] },
  }]);
  vi.mocked(generate).mockResolvedValueOnce({
    bytes: png, mime: "image/png", width: 1024, height: 1024,
    generatedDimensions: { width: 1536, height: 1024 }, usage: {},
  } as never);
  await enqueue(job.id);
  const saved = await store.get<Job>("jobs", job.id);
  expect(saved?.providerSize).toEqual({ width: 1536, height: 1024 });
  expect(saved?.providerResultSize).toEqual({ width: 1536, height: 1024 });
  expect(saved?.generatedSize).toEqual({ width: 1024, height: 1024 });
  expect(JSON.parse(saved!.provenance!)).toMatchObject({
    requestedSize: { width: 1024, height: 1024 },
    providerSize: { width: 1536, height: 1024 },
    providerResultSize: { width: 1536, height: 1024 },
    generatedSize: { width: 1024, height: 1024 },
  });
});

it("imports a multi-entry queue through coordinated project storage", async () => {
  const { openProjectStorage } = await import("../src/storage/open-project-storage");
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
    Array.from({ length: 12 }, (_, index) => `## IMG-batch-${index}\n- Status: pending\n- Size: 1024x1024 PNG\n`).join("\n"));
  const routed = await openProjectStorage(store);
  await importExistingQueue(routed);
  expect(await routed.list("jobs")).toHaveLength(12);
  await importExistingQueue(routed);
  expect(await routed.list("jobs")).toHaveLength(12);
});

it("coalesces concurrent queue imports in one process", async () => {
  const { openProjectStorage } = await import("../src/storage/open-project-storage");
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"),
    "## IMG-concurrent-a\n- Status: pending\n\n## IMG-concurrent-b\n- Status: pending\n");
  const first = await openProjectStorage(store);
  const second = await openProjectStorage(store);
  await Promise.all([importExistingQueue(first), importExistingQueue(second)]);
  expect(await first.list("jobs")).toHaveLength(2);
});

it("clears a shared failed import before retrying", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const memory = new MemoryStorage();
  await mkdir(process.env.CODEX_QUEUE_DIR!, { recursive: true });
  await writeFile(path.join(process.env.CODEX_QUEUE_DIR!, "images-todo.md"), "## IMG-retry\n- Status: pending\n");
  const put = memory.put.bind(memory);
  memory.put = async (collection, id, value) => {
    if (collection === "jobs") throw new Error("Temporary write failure");
    return put(collection, id, value);
  };
  const attempts = await Promise.allSettled([importExistingQueue(memory), importExistingQueue(memory)]);
  expect(attempts.every(result => result.status === "rejected")).toBe(true);
  memory.put = put;
  await importExistingQueue(memory);
  expect(await memory.get("jobs", "IMG-retry")).toBeDefined();
});

it("persists all simultaneous stale job updates through coordinated storage", async () => {
  const { openProjectStorage } = await import("../src/storage/open-project-storage");
  const routed = await openProjectStorage(store);
  const stores = await import("../src/storage");
  const stub = vi.spyOn(stores, "storage").mockResolvedValue(routed);
  try {
    for (const id of ["stale-one", "stale-two", "stale-three"]) {
      await routed.put("jobs", id, {
        id, projectId: "legacy", source: "api", status: "running",
        startedAt: "2020-01-01T00:00:00Z", createdAt: "2020-01-01T00:00:00Z",
      });
    }
    const observed = await refreshedJobs();
    expect(observed.map(job => job.status)).toEqual(["uncertain", "uncertain", "uncertain"]);
    expect((await routed.list<Job>("jobs")).every(job => job.status === "uncertain")).toBe(true);
  } finally { stub.mockRestore(); }
});

it("backfills historical queue dimensions without changing job metadata", async () => {
  const root = process.env.CODEX_QUEUE_DIR!;
  const id = "IMG-measured";
  const outputPath = path.join(root, "out", id, "result.png");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, png);
  await writeFile(path.join(root, "images-todo.md"),
    `## ${id}\n- Status: done\n- Size: 1024x1536 PNG\n- Save to: ${outputPath}\n- Prompt: Sample\n`);
  await store.put("jobs", id, { id, source: "queue", status: "done", outputPath, width: 1024, height: 1536, prompt: "Preserve me" });
  await importExistingQueue(store);
  expect(await store.get("jobs", id)).toMatchObject({
    outputPath,
    requestedSize: { width: 1024, height: 1536 },
    generatedSize: { width: 1, height: 1 },
    width: 1, height: 1, prompt: "Preserve me",
  });
  expect((await store.get<Job>("jobs", id))?.blobKey).toBeUndefined();
  expect(await readFile(outputPath)).toEqual(Buffer.from(png));
});

it("reuses a legacy reference identifier when the original bytes match", async () => {
  const job = await make();
  const reference = await api.addReference(job.projectId, "ref.png", "image/png", png);
  const digest = createHash("sha256").update(png).digest("hex");
  expect(reference.blobKey).toBe(`refs/${digest}`);
  const legacy = { ...reference, blobKey: "refs/legacy" };
  await store.putBlob(legacy.blobKey, png, legacy.mime);
  await store.put("references", legacy.id, legacy);

  await expect(api.addReference(job.projectId, legacy.name, legacy.mime, png, undefined, undefined, legacy.id))
    .resolves.toEqual(legacy);
  await store.deleteBlob(legacy.blobKey);
  await expect(api.addReference(job.projectId, legacy.name, legacy.mime, png, undefined, undefined, legacy.id))
    .rejects.toThrow("belongs to different content");
});

it("keeps workspace reads available while another request owns purge recovery", async () => {
  const job = await make();
  await store.put("purge-operations", "pending", {
    id: "pending", jobIds: ["gone"], blobKeys: [],
    deletedAt: "2026-01-01", complete: false,
  });

  await store.lock("stacks", async () => {
    expect((await (await service()).jobs()).map(item => item.id)).toContain(job.id);
    expect(await store.get("tombstones", "gone")).toBeUndefined();
  });

  await service();
  expect(await store.get("tombstones", "gone")).toBeTruthy();
});

it("imports changed queue contents even when the modification time is unchanged", async () => {
  const root = process.env.CODEX_QUEUE_DIR!;
  await mkdir(root, { recursive: true });
  const queue = path.join(root, "images-todo.md");
  const unchangedTime = new Date("2026-01-01T00:00:00Z");
  const entry = (id: string) => `## ${id}\n- Status: pending\n- Size: 1024x1024 PNG\n- Prompt: Queue fixture\n`;
  await writeFile(queue, entry("IMG-one"));
  await utimes(queue, unchangedTime, unchangedTime);
  await importExistingQueue(store);

  await writeFile(queue, entry("IMG-one") + entry("IMG-two"));
  await utimes(queue, unchangedTime, unchangedTime);
  await importExistingQueue(store);
  expect((await api.jobs()).map(job => job.id).sort()).toEqual(["IMG-one", "IMG-two"]);
});

it("retries an unchanged queue snapshot when a record was locked during import", async () => {
  const root = process.env.CODEX_QUEUE_DIR!;
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "images-todo.md"),
    "## IMG-locked\n- Status: pending\n- Prompt: Locked\n\n## IMG-free\n- Status: pending\n- Prompt: Free\n",
  );

  await store.lock("IMG-locked", async () => {
    await importExistingQueue(store);
    expect(await store.get("jobs", "IMG-locked")).toBeUndefined();
    expect(await store.get("jobs", "IMG-free")).toBeTruthy();
  });

  await importExistingQueue(store);
  expect((await api.jobs()).map(job => job.id).sort()).toEqual(["IMG-free", "IMG-locked"]);
});

it("imports from the queue directory configured in the supplied store", async () => {
  delete process.env.STORAGE_DIR;
  const { MemoryStorage } = await import("../src/storage/memory");
  const memory = new MemoryStorage();
  const queueDirectory = path.join(root, "configured-queue");
  const defaultQueue = process.env.CODEX_QUEUE_DIR!;
  await Promise.all([
    mkdir(queueDirectory, { recursive: true }),
    mkdir(defaultQueue, { recursive: true }),
  ]);
  await writeFile(path.join(queueDirectory, "images-todo.md"), "## IMG-configured\n- Status: pending\n");
  await writeFile(path.join(defaultQueue, "images-todo.md"), "## IMG-default\n- Status: pending\n");
  await memory.put("settings", "paths", { queueDirectory, referenceDirectories: [root] });

  await importExistingQueue(memory);

  expect(await memory.get("jobs", "IMG-configured")).toBeDefined();
  expect(await memory.get("jobs", "IMG-default")).toBeUndefined();
});

it("dispatches provider recovery without executing the provider until submitted",async()=>{
  const original=await make("api");
  await store.put("jobs",original.id,{...original,status:"blocked"});
  const retry=await retryImageJob(original.id);
  expect(retry.status).toBe("queued");
  expect(generate).not.toHaveBeenCalled();
  expect(retry.id).not.toBe(original.id);
});

it("assigns portable identity to newly imported legacy jobs without rewriting the worker queue",async()=>{
  const queue=process.env.CODEX_QUEUE_DIR!;await mkdir(queue,{recursive:true});
  const content="## IMG-legacy-portable-id\n- Status: pending\n- Size: 1080x1920 PNG\n- Background: opaque\n- References: none\n- Prompt: Paint a portrait\n";
  await writeFile(path.join(queue,"images-todo.md"),content);
  await importExistingQueue(store);
  const job=await store.get<Job>("jobs","IMG-legacy-portable-id");
  expect(job?.globalId).toMatch(/^G-[a-f0-9]{64}$/);
  expect(job?.originMachine).toBe(job?.machineId);
  expect(job?.createdVersion?.changedBy).toBe(job?.originMachine);
  expect(job?.id).toBe("IMG-legacy-portable-id");
  expect(await readFile(path.join(queue,"images-todo.md"),"utf8")).toBe(content);
});


it.each([undefined, { mode: "fixed", sizes: [] }])("rejects missing or malformed size profiles before creating a paid attempt: %j", async sizeProfile => {
  const job = await make("api");
  process.env.OPENAI_API_KEY = "test-key";
  await store.put("models", "openai", [{ id: "gpt-image-test", references: true, transparency: true, sizeProfile }]);
  await expect(enqueue(job.id)).rejects.toThrow("no valid size profile");
  expect(generate).not.toHaveBeenCalled();
  expect(await store.get<Job>("jobs", job.id)).toMatchObject({ status: "queued" });
  expect((await store.get<Job>("jobs", job.id))?.attemptId).toBeUndefined();
});

it("does not execute legacy non-OpenAI provider jobs in 0.1.0", async () => {
  const job = await make("api");
  await store.put("jobs", job.id, { ...job, provider: "google" });
  await expect(enqueue(job.id)).rejects.toThrow("supports OpenAI only");
  expect(generate).not.toHaveBeenCalled();
  expect((await store.get<Job>("jobs", job.id))?.attemptId).toBeUndefined();
});

it("rejects an unverified cached model before a paid attempt", async () => {
  const job = await make("api");
  await store.put("jobs", job.id, { ...job, model: "gpt-image-unverified" });
  await store.put("models", "openai", [{
    id: "gpt-image-unverified", provider: "openai", references: true, transparency: false,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
  }]);
  process.env.OPENAI_API_KEY = "test-key";
  await expect(enqueue(job.id)).rejects.toThrow("no valid size profile");
  expect(generate).not.toHaveBeenCalled();
  expect((await store.get<Job>("jobs", job.id))?.attemptId).toBeUndefined();
});

it('requires acknowledgement to resend an uncertain queue job and preserves its original entry',async()=>{
 const original=await make();await enqueue(original.id);
 const file=path.join(process.env.CODEX_QUEUE_DIR!,'images-todo.md');
 const reserved=(await readFile(file,'utf8')).replace('Status: pending','Status: in-progress');await writeFile(file,reserved);
 const { inspectReservedResult } = await import('../src/core/reservation-recovery');
 const { jobCounts } = await import('../src/core/workspace-state');
 await store.put('jobs',original.id,{...(await store.get<Job>('jobs',original.id))!,status:'running',claim:{owner:'Worker 2',since:'2026-11-16T10:42:00Z',reserved:true}});
 expect(jobCounts(await store.list<Job>('jobs')).active).toBe(1);
 await inspectReservedResult(store,{id:original.id,acknowledgeUncertain:true});
 expect(jobCounts(await refreshedJobs()).active).toBe(0);
 await expect(retryImageJob(original.id)).rejects.toThrow('Confirm');
 const retry=await retryImageJob(original.id,true);expect(retry.id).not.toBe(original.id);expect(retry.status).toBe('queued');
 expect((await readFile(file,'utf8')).startsWith(reserved)).toBe(true);
 const jobsAfterRetry=await refreshedJobs();
 expect(jobsAfterRetry.find(j=>j.id===original.id)?.status).toBe('uncertain');
 expect(jobsAfterRetry.find(j=>j.id===original.id)?.claim?.owner).toBe('Worker 2');
 expect(jobCounts(jobsAfterRetry).active).toBe(1);
});

it('keeps local process execution distinct from a merely reserved queue request',async()=>{
 const job=await make();await enqueue(job.id);
 await store.put('jobs',job.id,{...(await store.get<Job>('jobs',job.id))!,status:'running',attemptId:'attempt-one',startedAt:new Date().toISOString()});
 // The queue remains authoritative for delivery; process state refines its reservation label.
 const jobs=await refreshedJobs();expect(jobs.find(j=>j.id===job.id)?.attemptId).toBe('attempt-one');
});
