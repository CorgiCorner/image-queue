import { png, mp4 } from "./fixtures";
import { service } from "../src/core/runtime";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/mcp/server";
import { setTimeout as pollDelay } from "node:timers/promises";

vi.mock("node:timers/promises", async (importOriginal) => {
  const timers = await importOriginal<typeof import("node:timers/promises")>();
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) };
});

let root: string;
let client: Client;
let server: ReturnType<typeof createServer>;
beforeEach(async () => {
  vi.mocked(pollDelay).mockClear();
  root = await mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
  process.env.STORAGE_DIR = path.join(root, "store");
  process.env.CODEX_QUEUE_DIR = path.join(root, "queue");
  process.env.REFERENCE_ROOTS = root;
  server = createServer();
  client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
  delete process.env.STORAGE_DIR;
  delete process.env.CODEX_QUEUE_DIR;
  delete process.env.REFERENCE_ROOTS;
});
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0].text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}
describe("MCP client/server flow", () => {
  it("lists tools and manages project, request, result and cancellation", async () => {
    expect((await client.listTools()).tools.length).toBe(25);
    const p = await call("create_project", { name: "Agent project" });
    expect(await call("list_projects")).toHaveLength(1);
    const job = await call("request_image", {
      projectId: p.id,
      idempotencyKey: "first",
      prompt: "A cheerful red panda",
      source: "queue",
      width: 1024,
      height: 1024,
    });
    expect(job.outputPath).toContain("IMG-first");
    expect(p.globalId).toMatch(/^G-[a-f0-9]{64}$/);
    expect(job.globalId).toMatch(/^G-[a-f0-9]{64}$/);
    expect(job.createdVersion.changedBy).toBe(job.originMachine);
    expect((await call("get_job",{id:job.id})).globalId).toBe(job.globalId);
    expect(await call("list_jobs", { projectId: p.id })).toHaveLength(1);
    expect(await call("list_jobs", { projectId: "missing" })).toHaveLength(0);
    expect((await call("get_job", { id: job.id })).status).toBe("queued");
    expect(await call("get_job", { id: "missing" })).toEqual({
      error: "Not found",
    });
    expect(
      (await call("wait_for_job", { id: job.id, timeoutSeconds: 0 })).status,
    ).toBe("queued");
    await expect(call("cancel_job", { id: job.id })).rejects.toThrow(
      "managed by the worker",
    );
    expect((await call("get_job", { id: job.id })).status).toBe("queued");
    expect(await call("list_models")).toEqual([]);
  });
  it("imports local references within configured roots", async () => {
    const p = await call("create_project", { name: "References" });
    const file = path.join(root, "test.png");
    await writeFile(file, png);
    expect(
      (await call("add_reference", { projectId: p.id, filePath: file })).kind,
    ).toBe("image");
    await expect(
      call("add_reference", { projectId: p.id, filePath: "/etc/hosts" }),
    ).rejects.toThrow("outside");
  });
  it("waits for missing results without polling", async () => {
    expect(
      await call("wait_for_job", { id: "missing", timeoutSeconds: 1 }),
    ).toEqual({ error: "Not found" });
  });
});

it("rejects cloud-side local file access and unsupported files", async () => {
  const p = await call("create_project", { name: "P" });
  const api = await service();
  process.env.STORAGE_DRIVER = "cloudflare";
  const { addLocalReference } = await import("../src/storage/local-references");
  await expect(
    addLocalReference(api, p.id, path.join(root, "x.png")),
  ).rejects.toThrow("local");
  delete process.env.STORAGE_DRIVER;
  const file = path.join(root, "x.txt");
  await writeFile(file, "text");
  await expect(
    call("add_reference", { projectId: p.id, filePath: file }),
  ).rejects.toThrow("Unsupported");
});
it("rejects oversized local references", async () => {
  const p = await call("create_project", { name: "P" });
  const file = path.join(root, "big.png");
  const { open } = await import("node:fs/promises");
  const f = await open(file, "w");
  await f.truncate(21 * 1024 * 1024);
  await f.close();
  await expect(
    call("add_reference", { projectId: p.id, filePath: file }),
  ).rejects.toThrow("20 MB");
});

it("waits until the bounded polling deadline", async () => {
  const api = await service();
  await api.store.put("settings", "local-runner", { workers: 1, paused: false });
  const p = await call("create_project", { name: "Wait" });
  const job = await call("request_image", {
    projectId: p.id,
    idempotencyKey: "wait",
    prompt: "A panda",
    source: "queue",
    width: 1024,
    height: 1024,
  });
  vi.useFakeTimers();
  try {
    const waiting = call("wait_for_job", { id: job.id, timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1500);
    expect((await waiting).status).toBe("queued");
  } finally {
    vi.useRealTimers();
  }
});
it("cancels an unsubmitted job through MCP", async () => {
  const api = await service();
  const project = await api.createProject("Unsubmitted");
  const job = await api.create({
    projectId: project.id,
    idempotencyKey: "unsubmitted",
    prompt: "A calm ocean",
    source: "queue",
    provider: "openai",
    model: "",
    width: 1024,
    height: 1024,
    transparent: false,
    referenceIds: [],
  });
  expect((await call("cancel_job", { id: job.id })).status).toBe("cancelled");
});
it("waits while a job is pending and observes completion", async () => {
  const api = await service();
  await api.store.put("settings", "local-runner", { workers: 1, paused: false });
  const project = await api.createProject("Polling");
  const job = await api.create({
    projectId: project.id,
    idempotencyKey: "polling",
    prompt: "A cloud",
    source: "queue",
    provider: "openai",
    model: "",
    width: 1024,
    height: 1024,
    transparent: false,
    referenceIds: [],
  });
  const delay = vi.mocked(pollDelay);
  delay.mockImplementationOnce(async () => {
    await api.store.put("jobs", job.id, { ...job, status: "done" });
  });
  const result = await call("wait_for_job", { id: job.id, timeoutSeconds: 2 });
  expect(result.status).toBe("done");
  expect(delay).toHaveBeenCalledWith(1000, undefined, { signal: expect.any(AbortSignal) });
});
it("manages image notes through MCP", async () => {
  const api = await service();
  const project = await api.createProject("Notes");
  const job = await api.create({
    projectId: project.id,
    idempotencyKey: "note-image",
    prompt: "A cloud",
    source: "queue",
    provider: "openai",
    model: "",
    width: 1024,
    height: 1024,
    transparent: false,
    referenceIds: [],
  });
  const note = await call("add_note", {
    imageId: job.id,
    text: "Make the cloud smaller",
    x: 0.5,
    y: 0.5,
  });
  expect(note.text).toContain("smaller");
  expect(await call("list_notes", { imageId: job.id })).toHaveLength(1);
});
it("omits deleted topics from MCP listings", async () => {
  const api = await service();
  const project = await api.createProject("Topics");
  const topic = await call("create_topic", {
    projectId: project.id,
    name: "Archived",
  });
  const { deleteTopic } = await import("../src/core/organization");
  await deleteTopic(api.store, topic.id);
  expect(
    (await call("list_topics")).some(
      (item: { id: string }) => item.id === topic.id,
    ),
  ).toBe(false);
});
it("bounds untagged batches and returns thumbnail links", async () => {
  const api = await service();
  for (const id of ["batch-a", "batch-b", "batch-c"]) {
    await api.store.put("jobs", id, {
      id,
      status: "done",
      prompt: "Image",
      projectId: "p",
      createdAt: "2026-01-01",
    });
  }
  const batch = await call("list_untagged", { limit: 1, afterId: "batch-a" });
  expect(batch).toEqual([
    {
      id: "batch-b",
      projectId: "p",
      prompt: "Image",
      thumbnailUrl: "/api/asset?job=batch-b&thumb=640",
    },
  ]);
});
it("rejects incomplete note coordinates through MCP", async () => {
  await expect(
    call("add_note", { imageId: "one", text: "Change sky", x: 0.5 }),
  ).rejects.toThrow();
});

it("shows missing jobs and rejects oversized batches", async () => {
  expect(await call("show_job", { id: "missing" })).toEqual({
    error: "Not found",
  });
  await expect(call("request_images", { requests: [] })).rejects.toThrow();
});
it("registers optional HTML resources only for a capable host", async () => {
  expect((await client.listResources()).resources).toEqual([]);
  const appServer = createServer();
  const appClient = new Client(
    { name: "app-host", version: "1" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await appServer.connect(a);
  await appClient.connect(b);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resources = await appClient.listResources();
    expect(resources.resources.map((item) => item.uri)).toContain(
      "ui://image-queue/job",
    );
    const appTools = (await appClient.listTools()).tools;
    expect(
      appTools.find((tool) => tool.name === "get_job_state")?._meta,
    ).toMatchObject({ ui: { visibility: ["app"] } });
    expect(
      appTools.find((tool) => tool.name === "show_job")?._meta,
    ).toMatchObject({ ui: { resourceUri: "ui://image-queue/job" } });
    expect(
      (await client.listTools()).tools.some(
        (tool) => tool.name === "get_job_state",
      ),
    ).toBe(false);
    const resource = await appClient.readResource({
      uri: "ui://image-queue/job",
    });
    expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    await expect(
      appClient.readResource({ uri: "image-queue://thumbnail/missing" }),
    ).rejects.toThrow("unavailable");
    await expect(
      appClient.readResource({ uri: "image-queue://thumbnail/%2Fetc%2Fhosts" }),
    ).rejects.toThrow();
    const api = await service();
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await api.store.putBlob("results/test-preview", bytes, "image/png");
    await api.store.put("jobs", "preview", {
      id: "preview",
      status: "done",
      source: "api",
      blobKey: "results/test-preview",
      prompt: "A violet rectangle",
      createdAt: "2026-01-01",
    });
    const preview = await appClient.readResource({
      uri: "image-queue://thumbnail/preview",
    });
    expect(preview.contents[0].mimeType).toBe("image/webp");
    const content = preview.contents[0];
    expect("blob" in content).toBe(true);
    if ("blob" in content)
      expect(
        (await sharp(Buffer.from(content.blob, "base64")).metadata()).width,
      ).toBe(640);
    await api.store.put("jobs", "trashed-preview", {
      id: "trashed-preview", status: "done", source: "api",
      blobKey: "results/test-preview", createdAt: "2026-01-01", trashedAt: "2026-11-14",
      prompt: "A violet rectangle",
    });
    await expect(appClient.readResource({
      uri: "image-queue://thumbnail/trashed-preview",
    })).rejects.toThrow("unavailable");
    expect(appTools.find(tool => tool.name === "add_notes_to_queue")?._meta)
      .toMatchObject({ ui: { visibility: ["app"] } });
    expect((await client.listTools()).tools.some(tool => tool.name === "add_notes_to_queue")).toBe(false);
    expect(appTools.find(tool => tool.name === "get_image_details")?._meta)
      .toMatchObject({ ui: { visibility: ["app"] } });
    expect((await client.listTools()).tools.some(tool => tool.name === "get_image_details")).toBe(false);
    await api.store.put("notes", "preview-note", { id: "preview-note", imageId: "preview", text: "Brighten sky", x: 0.5, y: 0.2 });
    expect(appTools.find(tool => tool.name === "show_image")?._meta).toMatchObject({ ui: { resourceUri: "ui://image-queue/image" } });
    const imageResource = await appClient.readResource({ uri: "ui://image-queue/image" });
    expect(imageResource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    const project = await api.createProject("MCP parity");
    for (const request of [
      { name: "show_image", arguments: { id: "preview" } },
      { name: "show_job", arguments: { id: "preview" } },
      { name: "show_images", arguments: { offset: 0, limit: 40 } },
      { name: "request_image", arguments: {
        idempotencyKey: "compare-view-result",
        projectId: project.id,
        prompt: "Draw a violet rectangle",
        source: "queue",
        width: 1024,
        height: 1024,
      } },
    ]) {
      const withView = await appClient.callTool(request);
      const withoutView = await client.callTool(request);
      expect(withView.isError, JSON.stringify(withView.content)).toBeFalsy();
      expect(withoutView.isError, request.name).toBeFalsy();
      expect(withView.content, request.name).toEqual(withoutView.content);
      expect(withView.content, request.name).toEqual([{ type: "text", text: expect.any(String) }]);
    }
    const detailResult = await appClient.callTool({ name: "get_image_details", arguments: { id: "preview" } });
    expect(detailResult.isError).toBeFalsy();
    const details = JSON.parse((detailResult.content as { text: string }[])[0].text);
    expect(details.notes[0]).toMatchObject({ text: "Brighten sky", x: 0.5 });
    expect(details.versions).toHaveLength(1);
    expect(JSON.stringify(details)).not.toContain("results/test-preview");
    const invalidDetails = await appClient.callTool({ name: "get_image_details", arguments: { id: "../escape" } });
    expect(invalidDetails.isError).toBe(true);
    const trashedDetails = await appClient.callTool({ name: "get_image_details", arguments: { id: "trashed-preview" } });
    expect(trashedDetails.isError).toBe(true);
    const state = await appClient.callTool({
      name: "get_job_state",
      arguments: { id: "preview" },
    });
    expect(state.content?.every((item) => item.type === "text")).toBe(true);
    expect(JSON.stringify(state)).not.toContain("base64");
    const queued = await call("request_image", {
      idempotencyKey: "worker-health",
      projectId: (await call("create_project", { name: "Worker health" })).id,
      prompt: "A forest",
      source: "queue",
      width: 1024,
      height: 1024,
    });
    const readWorkerState = async () => {
      const response = await appClient.callTool({ name: "get_job_state", arguments: { id: queued.id } });
      expect(response.isError, JSON.stringify(response.content)).toBeFalsy();
      return JSON.parse((response.content as { text: string }[])[0].text);
    };
    // Local workers send no heartbeats, so their notice follows the runner's own state.
    expect(await readWorkerState()).toMatchObject({ status: "queued", workersOffline: false, queueNotice: "Workers are turned off. Requests will wait in the queue." });
    await api.store.put("settings", "local-runner", { workers: 1, paused: false, blockedReason: "Sign in to Codex." });
    const blocked = await readWorkerState();
    expect(blocked).toMatchObject({ workersOffline: false, queueNotice: "Queue stopped — action needed. Sign in to Codex. Requests will wait until you resume the queue." });
    await api.store.put("settings", "local-runner", { workers: 1, paused: false });
    expect(await readWorkerState()).not.toHaveProperty("queueNotice");
    process.env.IMAGE_QUEUE_EXECUTOR = "scheduled";
    try {
      expect(await readWorkerState()).toMatchObject({ status: "queued", workersOffline: true, queueNotice: "Workers are offline. Requests will wait in the queue." });
      await api.store.put("pulses", "1", {
        slot: 1, workerId: "test-worker", lastWake: new Date().toISOString(),
      });
      expect(await readWorkerState()).toMatchObject({ status: "queued", workersOffline: false });
      expect(await readWorkerState()).not.toHaveProperty("queueNotice");
    } finally {
      delete process.env.IMAGE_QUEUE_EXECUTOR;
    }
    expect(await call("get_job", { id: queued.id })).not.toHaveProperty("workersOffline");
    const result = await appClient.callTool({
      name: "show_job",
      arguments: { id: "missing" },
    });
    expect(result.content).toEqual(
      (
        await client.callTool({
          name: "show_job",
          arguments: { id: "missing" },
        })
      ).content,
    );
  } finally {
    await appClient.close();
    await appServer.close();
  }
  // This end-to-end contract exercises both clients, generated HTML, thumbnails
  // and queue persistence; coverage instrumentation can exceed the default 5s.
}, 15_000);
it("queues annotated corrections through the app-only tool idempotently", async () => {
  const appServer = createServer();
  const appClient = new Client({ name: "correction-host", version: "1" }, {
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await appServer.connect(a);
  await appClient.connect(b);
  try {
    const api = await service();
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({ create: { width: 512, height: 256, channels: 3, background: "blue" } }).png().toBuffer();
    const correctionProject = await api.createProject("MCP corrections");
    const imported = await api.importImage("source.png", "image/png", bytes, correctionProject.id);
    for (const text of ["Change the sky", "Move the object"])
      await appClient.callTool({ name: "add_note", arguments: { imageId: imported.job.id, text } });
    const correctionArguments = { imageId: imported.job.id, idempotencyKey: "mcp-correction" };
    const queuedCorrection = await appClient.callTool({ name: "add_notes_to_queue", arguments: correctionArguments });
    expect(queuedCorrection.isError, JSON.stringify(queuedCorrection.content)).toBeFalsy();
    const correction = JSON.parse((queuedCorrection.content as { text: string }[])[0].text);
    expect(correction.parentVersionId).toBe(imported.job.id);
    expect(correction.projectId).toBe(correctionProject.id);
    expect(correction.referenceIds).toHaveLength(2);
    expect(correction.prompt).toContain("1. Change the sky");
    expect(correction.prompt).toContain("2. Move the object");
    const repeatedCorrection = await appClient.callTool({ name: "add_notes_to_queue", arguments: correctionArguments });
    expect(repeatedCorrection.isError).toBeFalsy();
    expect(JSON.parse((repeatedCorrection.content as { text: string }[])[0].text).id).toBe(correction.id);
    const invalidCorrection = await appClient.callTool({ name: "add_notes_to_queue", arguments: { imageId: "../escape", idempotencyKey: "test" } });
    expect(invalidCorrection.isError).toBe(true);
  } finally {
    await appClient.close();
    await appServer.close();
  }
}, 15_000);
it("excludes archive and trash from default job listings", async () => {
  const api=await service();
  for(const job of [{id:"archived",archivedAt:"2026-01-01"},{id:"trashed",trashedAt:"2026-01-01"}]) await api.store.put("jobs",job.id,{...job,status:"done",createdAt:"2026-01-01"});
  expect(await call("list_jobs")).toEqual([]);
  expect(await call("list_jobs",{includeArchived:true,includeTrashed:true})).toHaveLength(2);
  expect(await call("list_untagged")).toEqual([]);
});
it("accepts aspect ratio intent for queue requests", async () => {
  const project=await call("create_project",{name:"Ratio project"});
  const job=await call("request_image",{projectId:project.id,idempotencyKey:"portrait-ratio",prompt:"A portrait landscape",source:"queue",aspectRatio:"9:16"});
  expect(job.aspectRatio).toBe("9:16");
  expect(job.width).toBe(1080);
  expect(job.height).toBe(1920);
  await expect(call("request_image",{projectId:project.id,idempotencyKey:"mismatch-ratio",prompt:"A portrait landscape",source:"queue",aspectRatio:"1:1",width:1080,height:1920})).rejects.toThrow("do not match");
});
it("rejects a resolution level on queue jobs before creating any batch entries", async () => {
  const project = await call("create_project", { name: "Resolution batch" });
  const base = { projectId: project.id, prompt: "A landscape", source: "queue", aspectRatio: "16:9" };
  await expect(call("request_images", { requests: [
    { ...base, idempotencyKey: "valid-ratio" },
    { ...base, idempotencyKey: "invalid-level", resolution: "2K" },
  ] })).rejects.toThrow("Resolution levels require");
  expect(await call("list_jobs")).toEqual([]);
});

it("validates every batch size intent before creating jobs", async () => {
  const project = await call("create_project", {name:"Batch dimensions"});
  const base = {projectId:project.id,prompt:"A landscape",source:"queue"};
  await expect(call("request_images", {requests:[
    {...base,idempotencyKey:"valid-first",aspectRatio:"16:9"},
    {...base,idempotencyKey:"invalid-second",width:1080},
  ]})).rejects.toThrow("both width and height");
  expect(await call("list_jobs")).toEqual([]);
  const jobs = await call("request_images", {requests:[
    {...base,idempotencyKey:"wide",aspectRatio:"16:9"},
    {...base,idempotencyKey:"tall",aspectRatio:"9:16"},
  ]});
  expect(jobs.map((job: {width:number;height:number}) => [job.width,job.height])).toEqual([[1920,1080],[1080,1920]]);
});

it("does not return unverified stored model size profiles to agent clients", async () => {
  const api = await service();
  const model = {
    id: "profiled-image", name: "Profiled image", provider: "openai",
    references: true, transparency: false,
    sizeProfile: {
      mode: "dimensions", minSide: 256, maxSide: 2048, multiple: 16,
      minPixels: 262144, maxPixels: 4194304, minRatio: 0.5, maxRatio: 2,
    },
  };
  await api.store.put("models", "openai", [model, { ...model, id: "unprofiled", sizeProfile: undefined }]);
  expect(await call("list_models")).toEqual([]);
});

it("returns retained output metadata for blocked image jobs", async () => {
  const api = await service();
  const project = await api.createProject("Retained output");
  const job = await api.create({ projectId: project.id, idempotencyKey: "retained",
    prompt: "Panda", source: "api", provider: "openai", model: "test",
    width: 1024, height: 1024, transparent: false, referenceIds: [],
  });
  await api.store.putBlob("results/retained", new Uint8Array([1]), "image/png");
  await api.store.put("jobs", job.id, { ...job, status: "blocked",
    blobKey: "results/retained", error: "Output could not be fitted",
    providerResultSize: { width: 512, height: 512 },
  });
  const result = await call("get_job", { id: job.id });
  expect(result.status, JSON.stringify(result)).toBe("blocked");
  expect(result.blobKey).toBe("results/retained");
  expect(result.providerResultSize).toEqual({ width: 512, height: 512 });
});

it("keeps historical Google profiles hidden from the 0.1.0 catalog", async () => {
  const api = await service();
  await api.store.put("models", "google", [{ id: "historical", provider: "google", sizeProfile: { mode: "aspect-ratio", ratios: ["16:9"], levels: ["2K"] } }]);
  expect(await call("list_models")).toEqual([]);
  expect(await api.store.get("models", "google")).toHaveLength(1);
});

it("validates API aspect ratios against stored model profiles before creating jobs", async () => {
  const api = await service();
  const project = await api.createProject("API ratios");
  await api.store.put("models", "openai", [{
    id: "profiled", name: "Profiled", provider: "openai",
    sizeProfile: { mode: "aspect-ratio", ratios: ["1:1"], levels: [] },
  }]);
  await expect(call("request_image", {
    projectId: project.id, idempotencyKey: "unsupported-api-ratio", prompt: "A landscape",
    source: "api", provider: "openai", model: "profiled", aspectRatio: "16:9",
  })).rejects.toThrow("no valid size profile");
  await expect(call("request_image", {
    projectId: project.id, idempotencyKey: "invalid-exact-size", prompt: "A wide landscape",
    source: "api", provider: "openai", model: "profiled", width: 1920, height: 1080,
  })).rejects.toThrow("no valid size profile");
  await expect(api.create({
    projectId: project.id, idempotencyKey: "invalid-panel-size", prompt: "A wide landscape",
    source: "api", provider: "openai", model: "profiled", width: 1920, height: 1080,
    referenceIds: [], transparent: false,
  })).rejects.toThrow("Unsupported aspect ratio");
  expect(await api.jobs()).toEqual([]);
});

it("pages and filters gallery results over MCP without exposing trashed images", async () => {
  const api = await service();
  const project = await api.createProject("Gallery");
  for (const job of [
    { id: "gallery-new", prompt: "Blue mountain", createdAt: "2026-01-03" },
    { id: "gallery-old", prompt: "Blue river", createdAt: "2026-01-02" },
    { id: "gallery-trash", prompt: "Blue forest", createdAt: "2026-01-04", trashedAt: "2026-01-05" },
  ]) await api.store.put("jobs", job.id, { ...job, projectId: project.id, source: "api", status: "done" });
  const first = await call("show_images", { projectId: project.id, query: "BLUE", limit: 1 });
  expect(first.items.map((job: { id: string }) => job.id)).toEqual(["gallery-new"]);
  expect(first.total).toBe(2);
  expect(first.nextOffset).toBe(1);
  const second = await call("show_images", { projectId: project.id, query: "blue", limit: 1, offset: first.nextOffset });
  expect(second.items.map((job: { id: string }) => job.id)).toEqual(["gallery-old"]);
  expect(second.nextOffset).toBeNull();
  await expect(call("show_images", { limit: 101 })).rejects.toThrow();
});

it("creates a project in the selected folder through MCP", async () => {
  const { FileStorage } = await import("../src/storage/fs");
  const directory = path.join(root, "selected-project");
  const project = await call("create_project", { name: "Selected folder", directory });
  const folder = new FileStorage(project.directory);
  expect(await folder.get("projects", project.id)).toEqual(project);
  expect(await folder.get("settings", "project-owner")).toEqual({ projectId: project.id });
  expect(await call("list_projects")).toEqual([project]);
  const workspace = new FileStorage(process.env.STORAGE_DIR!);
  expect(await workspace.get("projects", project.id)).toBeUndefined();
  expect(await workspace.get("project-directories", project.id)).toEqual({ id: project.id, directory: project.directory });
});

it("rejects relative project folders through MCP without creating a project", async () => {
  await expect(call("create_project", { name: "Invalid folder", directory: "relative-folder" })).rejects.toThrow();
  expect(await call("list_projects")).toEqual([]);
});

it("cancels an MCP wait without cancelling the underlying image request", async () => {
  const api = await service();
  await api.store.put("settings", "local-runner", { workers: 1, paused: false });
  const project = await call("create_project", { name: "Cancelled wait" });
  const job = await call("request_image", {
    projectId: project.id, idempotencyKey: "wait-abort", prompt: "A panda",
    source: "queue", width: 1024, height: 1024,
  });

  const controller = new AbortController();
  const pending = client.callTool({
    name: "wait_for_job", arguments: { id: job.id, timeoutSeconds: 60 },
  }, { signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow("Stop waiting");
  controller.abort(new Error("Stop waiting"));
  await rejected;
  expect((await call("get_job", { id: job.id })).status).toBe("queued");
});

it("returns useful text for all three display tools without an Apps-capable host", async () => {
  const api = await service();
  await api.store.put("jobs", "plain-preview", {
    id: "plain-preview", projectId: "inbox", source: "api", status: "done",
    prompt: "A plain preview", createdAt: "2026-01-01T00:00:00Z",
  });

  const tools = (await client.listTools()).tools;
  for (const [name, args] of [
    ["show_job", { id: "plain-preview" }],
    ["show_image", { id: "plain-preview" }],
    ["show_images", {}],
  ] as const) {
    expect(tools.find(tool => tool.name === name)?._meta?.ui).toBeUndefined();
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("plain-preview") }]);
  }
});

it.each(["queued", "running"])("defers background tagging while generation is %s", async status => {
  const api = await service();
  await api.store.put("jobs", "untagged", {
    id: "untagged", status: "done", prompt: "Image", projectId: "p", createdAt: "2026-01-01",
  });
  await api.store.put("jobs", "priority", {
    id: "priority", status, prompt: "Generate first", projectId: "other", createdAt: "2026-01-02",
  });
  expect(await call("list_untagged", { limit: 1 })).toEqual([]);
  await api.store.put("jobs", "priority", {
    id: "priority", status: "done", tags: [{ tag: "finished", source: "user" }], createdAt: "2026-01-02",
  });
  expect((await call("list_untagged", { limit: 1 })).map((job: { id: string }) => job.id)).toEqual(["untagged"]);
});

it("exposes explicit recovery tools and rejects uncertain retries without charge acknowledgement",async()=>{
  const project=await call("create_project",{name:"Recovery"});
  const api=await service();
  const job=await api.create({projectId:project.id,prompt:"Paint a landscape",idempotencyKey:"uncertain-recovery",source:"api",provider:"openai",model:"test",width:1024,height:1024,referenceIds:[],transparent:false});
  await api.store.put("jobs",job.id,{...job,status:"uncertain"});
  await expect(call("retry_image",{id:job.id})).rejects.toThrow("may be charged again");
  expect(await api.jobs()).toHaveLength(1);
  expect((await call("mark_uncertain_failed",{id:job.id})).status).toBe("failed");
  await expect(call("mark_uncertain_failed",{id:job.id})).rejects.toThrow("uncertain");
});


it("rejects reference traversal and symlink escapes through the MCP transport", async () => {
  const project = await call("create_project", { name: "Path boundary" });
  const allowed = path.join(root, "allowed");
  const outside = path.join(root, "outside.png");
  await mkdir(allowed);
  await writeFile(outside, png);
  await writeFile(path.join(allowed, "inside.png"), png);
  await symlink(outside, path.join(allowed, "escape.png"));
  process.env.REFERENCE_ROOTS = allowed;
  for (const filePath of [outside, path.join(allowed, "..", "outside.png"), path.join(allowed, "escape.png")]) {
    await expect(call("add_reference", { projectId: project.id, filePath })).rejects.toThrow("outside");
  }
  expect(await call("add_reference", { projectId: project.id, filePath: path.join(allowed, "inside.png") }))
    .toMatchObject({ kind: "image", projectId: project.id });
});

it("rejects non-OpenAI requests before creating a job in 0.1.0", async () => {
  const project = await call("create_project", { name: "Release scope" });
  for (const provider of ["google", "openrouter", "gateway"]) {
    await expect(call("request_image", {
      projectId: project.id, idempotencyKey: `scope-${provider}`, prompt: "A blue square",
      source: "api", provider, model: "unavailable", width: 1024, height: 1024,
    })).rejects.toThrow("supports OpenAI only");
  }
  expect(await call("list_jobs")).toEqual([]);
});

it("tells agents the reference formats before they submit a request", async () => {
  const tools = (await client.listTools()).tools;
  for (const name of ["add_reference", "request_image", "request_images"]) {
    const description = tools.find(tool => tool.name === name)?.description ?? "";
    expect(description).toContain("PNG");
    expect(description).toContain("JPEG");
    expect(description).toContain("WebP");
    expect(description).toContain("20 MB");
    expect(description).toContain("SVG");
    expect(description).toContain("Markdown");
  }
});

it("returns execution guidance and the original error for blocked queue jobs", async () => {
  const api=await service();
  await api.store.put("settings","local-runner",{workers:1,paused:true});
  await api.store.put("jobs","blocked-reference",{id:"blocked-reference",projectId:"inbox",source:"queue",status:"blocked",error:"A required reference is not a supported PNG, JPEG or WebP image"});
  for (const name of ["get_job","wait_for_job"]) {
    const job=await call(name,{id:"blocked-reference"});
    expect(job.error).toContain("supported PNG");
    expect(job.execution).toMatchObject({state:"paused",requiresUserAction:true});
    expect(job.recovery).toMatchObject({action:"repair_references",automaticRetryAllowed:true});
  }
});

it("returns size mismatch recovery through get_job and wait_for_job for both sources",async()=>{
 const api=await service();
 for(const source of ["queue","api"]){
  const id=`bad-size-${source}`;
  await api.store.put("jobs",id,{id,projectId:"inbox",source,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),referenceIds:[],status:"uncertain",error:"The generated image is too small for the requested size without upscaling",width:1024,height:1536,providerResultSize:{width:851,height:1847}});
  for(const tool of ["get_job","wait_for_job"]){
   const job=await call(tool,{id});
   expect(job.recovery).toMatchObject({action:"inspect_size_mismatch",generationCompleted:true,automaticRetryAllowed:false,requestedSize:{width:1024,height:1536},actualSize:{width:851,height:1847}});
   expect(job.recovery.message).toContain("Resuming the queue will not repair");
  }
 }
});

it("returns a paused Codex job immediately without polling", async () => {
  const api = await service();
  await api.store.put("settings", "local-runner", { workers: 1, paused: true });
  const project = await api.createProject("Paused queue");
  const job = await call("request_image", {
    projectId: project.id, idempotencyKey: "paused-wait", prompt: "A panda",
    source: "queue", width: 1024, height: 1024,
  });

  const result = await call("wait_for_job", { id: job.id, timeoutSeconds: 1 });
  expect(result).toMatchObject({ status: "queued", execution: { state: "paused", requiresUserAction: true } });
  expect(pollDelay).not.toHaveBeenCalled();
});

it("continues waiting for a running Codex job after pause", async () => {
  const api = await service();
  await api.store.put("settings", "local-runner", { workers: 1, paused: true });
  const project = await api.createProject("Finishing work");
  const job = await api.create({
    projectId: project.id, idempotencyKey: "finishing-job", prompt: "A panda",
    source: "queue", provider: "openai", model: "", transparent: false, referenceIds: [],
    width: 1024, height: 1024,
  });
  await api.store.put("jobs", job.id, { ...job, status: "running" });
  vi.mocked(pollDelay).mockImplementationOnce(async () => {
    await api.store.put("jobs", job.id, { ...job, status: "done" });
  });
  expect(await call("wait_for_job", { id: job.id, timeoutSeconds: 2 })).toMatchObject({ status: "done" });
});

it("gives agents the retained Codex original when delivery cannot fit it", async () => {
  const api = await service();
  const id = "size-mismatch-original";
  const original = path.join(root, "original.png");
  await writeFile(original, png);
  await api.store.put("generation-artifacts", id, { original });
  await api.store.put("jobs", id, {
    id, source: "queue", status: "uncertain", error: "The generated image is too small for the requested size",
  });

  expect(await call("get_job", { id })).toMatchObject({
    status: "uncertain",
    recovery: { action: "inspect_size_mismatch", generationCompleted: true, originalPath: original },
  });
});

it("changes only the saved source and lets an omitted source use it",async()=>{
 const api=await service();await api.store.put('models','openai',[{id:'gpt-image-1.5',name:'GPT Image',provider:'openai',references:true,transparency:true}]);
 const result=await call('set_generation_source',{source:'api',model:'gpt-image-1.5'});
 expect(result).toMatchObject({generationStarted:false,existingRequestsChanged:false,preference:{source:'api'}});
 expect((await call('get_generation_source')).preference.model).toBe('gpt-image-1.5');
 const project=await api.createProject('API default');
 const runtime=await import('../src/core/runtime');const enqueueSpy=vi.spyOn(runtime,'enqueue').mockResolvedValue(undefined);
 try {
  const job=await call('request_image',{projectId:project.id,prompt:'A red square',width:1024,height:1024,idempotencyKey:'saved-default'});
  expect(job).toMatchObject({source:'api',model:'gpt-image-1.5',status:'queued'});
  const override=await call('request_image',{projectId:project.id,prompt:'A blue square',source:'queue',width:1024,height:1024,idempotencyKey:'explicit-override'});
  expect(override).toMatchObject({source:'queue',status:'queued'});
  expect((await call('get_generation_source')).preference.source).toBe('api');
 } finally {enqueueSpy.mockRestore();}
});

it("replays an identical MCP request after its default and model catalog change", async () => {
  const api = await service();
  await api.store.put("models", "openai", [{ id: "gpt-image-1.5", name: "GPT Image", provider: "openai" }]);
  await call("set_generation_source", { source: "api", model: "gpt-image-1.5" });
  const project = await api.createProject("Stable requests");
  const request = { projectId: project.id, idempotencyKey: "stable-request", prompt: "A blue square", aspectRatio: "1:1" };
  const runtime = await import("../src/core/runtime");
  const enqueue = vi.spyOn(runtime, "enqueue").mockResolvedValue(undefined);
  try {
    const job = await call("request_image", request);
    const done = { ...job, status: "done" };
    await api.store.put("jobs", job.id, done);
    await api.store.delete("models", "openai");
    await call("set_generation_source", { source: "queue" });
    enqueue.mockClear();

    expect(await call("request_image", request)).toEqual(done);
    expect(await call("request_images", { requests: [request] })).toEqual([done]);
    await expect(call("request_image", { ...request, prompt: "A red square" })).rejects.toThrow("Idempotency key");
    expect(enqueue).not.toHaveBeenCalled();
  } finally {
    enqueue.mockRestore();
  }
});
