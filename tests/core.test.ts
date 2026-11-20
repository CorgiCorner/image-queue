import { png, mp4 } from "./fixtures";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hash,
  type ImageRequest,
  type Job,
  requestSchema,
  transition,
  transitions,
} from "../src/core/schema";
import { ImageService } from "../src/core/service";
import { readKey, saveKey } from "../src/core/settings";
import { extensionForMime, extensionForOutputFormat, mimeForDetectedType, svgDocument } from "../src/core/image-format";
import { requestsForCount } from "../src/core/request-count";
import { FileStorage } from "../src/storage/fs";
import { safeKey } from "../src/storage/types";

let root: string;
let service: ImageService;
const request = (projectId: string): ImageRequest => ({
  projectId,
  idempotencyKey: "test",
  prompt: "A painted red panda",
  source: "queue",
  provider: "openai",
  model: "",
  width: 1024,
  height: 1024,
  transparent: true,
  referenceIds: [],
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "codex-images-test-"));
  service = new ImageService(new FileStorage(root));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.SETTINGS_SECRET;
  delete process.env.OPENAI_API_KEY;
});
describe("image requests", () => {
  it("creates projects, validates names and sorts them", async () => {
    const p = await service.createProject("  Test  ");
    expect(p.name).toBe("Test");
    expect(await service.projects()).toEqual([p]);
    await expect(service.createProject(" ")).rejects.toThrow();
    await expect(service.createProject("x".repeat(101))).rejects.toThrow();
  });
  it("creates idempotently and rejects conflicting retries", async () => {
    const p = await service.createProject("One");
    const input = request(p.id);
    const first = await service.create(input);
    expect(await service.create(input)).toEqual(first);
    await expect(
      service.create({ ...input, prompt: "Another idea" }),
    ).rejects.toThrow("Idempotency");
    expect(await service.jobs()).toHaveLength(1);
  });
  it("refuses output format and frame settings for queue requests before creating a job", async () => {
    const project = await service.createProject("Formats");
    const input = request(project.id);
    await expect(service.create({ ...input, outputFormat: "webp" })).rejects.toThrow("Output format and frame settings apply only to API generation");
    await expect(service.create({ ...input, frameCount: 4 })).rejects.toThrow("Output format and frame settings apply only to API generation");
    await expect(service.create({ ...input, frameDurationMs: 200 })).rejects.toThrow("Output format and frame settings apply only to API generation");
    expect(await service.jobs()).toEqual([]);
  });
  it("refuses GIF output with reference images before storing a job", async () => {
    const project = await service.createProject("GIF");
    await service.store.put("models", "openai", [{
      id: "gpt-image-2.6-sunburst", provider: "openai", name: "Sunburst",
      references: true, transparency: true,
      sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
    }]);
    const reference = await service.addReference(project.id, "ref.png", "image/png", png);
    await expect(service.create({
      ...request(project.id), source: "api", model: "gpt-image-2.6-sunburst", transparent: false,
      outputFormat: "gif", referenceIds: [reference.id],
    })).rejects.toThrow("GIF output with reference images is not supported by this application yet.");
    expect(await service.jobs()).toEqual([]);
  });
  it("requires a project and model for API requests", async () => {
    await expect(service.create(request("missing"))).rejects.toThrow("Project");
    const p = await service.createProject("One");
    await expect(
      service.create({ ...request(p.id), source: "api" }),
    ).rejects.toThrow("model");
  });
  it("accepts the documented format and frame bounds", () => {
    const base = { ...request("test"), source: "api" as const, model: "gpt-image-2.6-sunburst" };
    expect(requestSchema.safeParse({ ...base, outputFormat: "gif", frameCount: 2, frameDurationMs: 20 }).success).toBe(true);
    expect(requestSchema.safeParse({ ...base, outputFormat: "gif", frameCount: 16, frameDurationMs: 2000 }).success).toBe(true);
    for (const frameCount of [1, 17])
      expect(requestSchema.safeParse({ ...base, outputFormat: "gif", frameCount }).success).toBe(false);
    for (const frameDurationMs of [19, 2001])
      expect(requestSchema.safeParse({ ...base, outputFormat: "gif", frameDurationMs }).success).toBe(false);
    expect(requestSchema.safeParse({ ...base, outputFormat: "bmp" }).success).toBe(false);
    const counted = requestsForCount({ ...base, idempotencyKey: "k".repeat(96) }, 10);
    expect(requestSchema.safeParse(counted[0]).success).toBe(true);
    expect(counted[9].idempotencyKey).toBe(`${"k".repeat(96)}-10`);
    expect(requestSchema.safeParse(counted[9]).success).toBe(false);
    expect(() => requestsForCount(base, 11)).toThrow("1 to 10");
    expect(extensionForOutputFormat("jpeg")).toBe("jpg");
    expect(extensionForOutputFormat()).toBe("png");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/jpeg; charset=binary")).toBe("jpg");
    expect(extensionForMime("image/gif")).toBe("gif");
    expect(mimeForDetectedType("jpg")).toBe("image/jpeg");
    expect(mimeForDetectedType("bmp")).toBeUndefined();
    expect(svgDocument(new TextEncoder().encode("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))).toBe(true);
    expect(svgDocument(new TextEncoder().encode("hello <svg></svg>"))).toBe(false);
  });
  it("rejects queue injection", () => {
    expect(
      requestSchema.safeParse({
        ...request("test"),
        prompt: "Hello\n## IMG-injected\n- Status: done",
      }).success,
    ).toBe(false);
  });
  it("moves jobs without changing immutable request hash", async () => {
    const p = await service.createProject("One");
    const p2 = await service.createProject("Two");
    const job = await service.create(request(p.id));
    await service.moveJob(job.id, p2.id);
    const moved = (await service.jobs())[0];
    expect(moved.projectId).toBe(p2.id);
    expect(moved.requestHash).toBe(job.requestHash);
    await expect(service.moveJob("missing", p.id)).rejects.toThrow("Job");
    await expect(service.moveJob(job.id, "missing")).rejects.toThrow("Project");
  });
  it("stores references and validates them on requests", async () => {
    const p = await service.createProject("One");
    const ref = await service.addReference(p.id, "image.png", "image/png", png);
    expect(ref.kind).toBe("image");
    expect(await service.store.getBlob(ref.blobKey)).toEqual({
      bytes: png,
      mime: "image/png",
    });
    await service.create({ ...request(p.id), referenceIds: [ref.id] });
    await expect(
      service.create({
        ...request(p.id),
        idempotencyKey: "missing",
        referenceIds: ["missing"],
      }),
    ).rejects.toThrow("references");
    await expect(service.addReference(p.id, "clip.mp4", "video/mp4", mp4)).rejects.toThrow("Unsupported reference format");
  });
  it("rejects invalid reference uploads", async () => {
    const p = await service.createProject("One");
    await expect(
      service.addReference("missing", "x", "image/png", png),
    ).rejects.toThrow("Project");
    await expect(
      service.addReference(p.id, "x", "text/html", new Uint8Array([1])),
    ).rejects.toThrow("format");
    await expect(
      service.addReference(p.id, "x", "image/png", new Uint8Array()),
    ).rejects.toThrow("20 MB");
    await expect(
      service.addReference(
        p.id,
        "x",
        "image/png",
        new Uint8Array(21 * 1024 * 1024),
      ),
    ).rejects.toThrow("20 MB");
  });
});
describe("state and storage", () => {
  it("checks every state transition", () => {
    for (const from of Object.keys(transitions) as Job["status"][])
      for (const to of Object.keys(transitions) as Job["status"][]) {
        const job = { status: from } as Job;
        if (transitions[from].includes(to))
          expect(transition(job, to).status).toBe(to);
        else expect(() => transition(job, to)).toThrow();
      }
  });
  it("rejects traversal and permits storage keys", () => {
    for (const key of ["../x", "x/../y", "/root", "x/./y", ""])
      expect(() => safeKey(key)).toThrow();
    expect(safeKey("refs/test.png")).toBe("refs/test.png");
  });
  it("reads missing records and detects invalid JSON", async () => {
    expect(await service.store.get("jobs", "missing")).toBeUndefined();
    expect(await service.store.getBlob("missing")).toBeUndefined();
    await mkdir(path.join(root, "jobs"), { recursive: true });
    await writeFile(path.join(root, "jobs", "bad.json"), "{");
    await expect(service.store.get("jobs", "bad")).rejects.toThrow();
  });
  it("serializes writers through exclusive locks and releases on errors", async () => {
    await service.store.lock("test", async () => {
      await expect(service.store.lock("test", async () => {})).rejects.toThrow(
        "progress",
      );
    });
    await expect(
      service.store.lock("test", async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(await service.store.lock("test", async () => 42)).toBe(42);
  });
  it("hashes strings and bytes identically", async () => {
    expect(await hash("hello")).toBe(
      await hash(new TextEncoder().encode("hello")),
    );
  });
  it("stores keys outside application records and uses environment overrides", async () => {
    const { readFile, stat } = await import("node:fs/promises");
    process.env.IMAGE_QUEUE_CREDENTIALS_DIR = path.join(
      root,
      "private-credentials",
    );
    try {
      await saveKey(service.store, "openai", "secret-test-value");
      expect(
        JSON.stringify(await service.store.get("secrets", "openai")),
      ).not.toContain("secret-test-value");
      expect(await readKey(service.store, "openai")).toBe("secret-test-value");
      const file = path.join(root, "private-credentials", "openai.key");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).toBe("secret-test-value");
      process.env.OPENAI_API_KEY = "environment-value";
      expect(await readKey(service.store, "openai")).toBe("environment-value");
    } finally {
      delete process.env.IMAGE_QUEUE_CREDENTIALS_DIR;
    }
  });
  it("requires encryption for legacy in-memory records and configured credentials", async () => {
    const { MemoryStorage } = await import("../src/storage/memory");
    await expect(saveKey(new MemoryStorage(), "openai", "x")).rejects.toThrow(
      "SETTINGS_SECRET",
    );
    process.env.IMAGE_QUEUE_CREDENTIALS_DIR = path.join(
      root,
      "empty-credentials",
    );
    try {
      await expect(readKey(service.store, "openai")).rejects.toThrow("Connect");
    } finally {
      delete process.env.IMAGE_QUEUE_CREDENTIALS_DIR;
    }
  });
});

it("sorts multiple projects and requests", async () => {
  const one = await service.createProject("First");
  await service.createProject("Second");
  expect(await service.projects()).toHaveLength(2);
  await service.create({ ...request(one.id), idempotencyKey: "one" });
  await service.create({ ...request(one.id), idempotencyKey: "two" });
  expect(await service.jobs()).toHaveLength(2);
});
it("blocks storage directory symlinks", async () => {
  const { symlink } = await import("node:fs/promises");
  const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
  try {
    await symlink(outside, path.join(root, "jobs"));
    await expect(service.store.get("jobs", "test")).rejects.toThrow("escapes");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it("only cancels work before submission to the worker queue", async () => {
  const project = await service.createProject("Cancellation");
  const job = await service.create(request(project.id));
  await service.store.put("jobs", job.id, {
    ...job,
    outputPath: "/queue/out/image.png",
  });
  await expect(service.cancelJob(job.id)).rejects.toThrow(
    "managed by the worker",
  );
  await service.store.put("jobs", job.id, job);
  await service.cancelJob(job.id);
  expect((await service.store.get<Job>("jobs", job.id))?.status).toBe(
    "cancelled",
  );
  await expect(service.cancelJob(job.id)).rejects.toThrow("queued");
});

it("validates reference contents and video ancestry at the shared entry point", async () => {
  const project = await service.createProject("References");
  await expect(
    service.addReference(
      project.id,
      "bad.png",
      "image/png",
      new Uint8Array([1]),
    ),
  ).rejects.toThrow("contents");
  await expect(
    service.addReference(
      project.id,
      "frame.png",
      "image/png",
      png,
      undefined,
      -1,
    ),
  ).rejects.toThrow("timestamp");
  await expect(
    service.addReference(
      project.id,
      "frame.png",
      "image/png",
      png,
      "missing",
      0,
    ),
  ).rejects.toThrow("video");

});

it("rejects record symlinks pointing outside storage", async () => {
  const { symlink } = await import("node:fs/promises");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const outside = await mkdtemp(path.join(os.tmpdir(), "outside-record-"));
  try {
    await writeFile(path.join(outside, "secret.json"), '{"private":true}');
    await symlink(
      path.join(outside, "secret.json"),
      path.join(root, "projects", "escape.json"),
    );
    await expect(service.store.get("projects", "escape")).rejects.toThrow(
      "symbolic link",
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it("migrates legacy encrypted credentials into the private credential store", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const memory = new MemoryStorage();
  process.env.SETTINGS_SECRET = "12".repeat(32);
  process.env.IMAGE_QUEUE_CREDENTIALS_DIR = path.join(
    root,
    "migrated-credentials",
  );
  try {
    await saveKey(memory, "openai", "legacy-test-value");
    await service.store.put(
      "secrets",
      "openai",
      await memory.get("secrets", "openai"),
    );
    expect(await readKey(service.store, "openai")).toBe("legacy-test-value");
    expect(await service.store.get("secrets", "openai")).toEqual({
      external: true,
    });
  } finally {
    delete process.env.IMAGE_QUEUE_CREDENTIALS_DIR;
  }
});

it("rechecks previously used directories after a symlink replacement", async () => {
  const { symlink, rename } = await import("node:fs/promises");
  await service.store.put("records", "one", { value: 1 });
  const outside = await mkdtemp(path.join(os.tmpdir(), "replaced-directory-"));
  try {
    await rename(
      path.join(root, "records"),
      path.join(root, "original-records"),
    );
    await symlink(outside, path.join(root, "records"));
    await expect(service.store.get("records", "one")).rejects.toThrow(
      "escapes",
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
it("removes private credentials and rejects environment-owned removal", async () => {
  const { removeKey } = await import("../src/core/settings");
  process.env.IMAGE_QUEUE_CREDENTIALS_DIR = path.join(root, "removal");
  try {
    await saveKey(service.store, "google", "test-key");
    await removeKey(service.store, "google");
    await expect(readKey(service.store, "google")).rejects.toThrow("Connect");
    process.env.IMAGE_QUEUE_GOOGLE_GENERATIVE_AI_API_KEY = "env-value";
    await expect(removeKey(service.store, "google")).rejects.toThrow(
      "environment",
    );
  } finally {
    delete process.env.IMAGE_QUEUE_CREDENTIALS_DIR;
    delete process.env.IMAGE_QUEUE_GOOGLE_GENERATIVE_AI_API_KEY;
  }
});
it("rejects cloud key writes and multiline key material", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const store = new MemoryStorage();
  process.env.IMAGE_QUEUE_STORAGE_DRIVER = "cloudflare";
  try {
    await expect(saveKey(store, "openai", "test-key")).rejects.toThrow(
      "platform secret",
    );
  } finally {
    delete process.env.IMAGE_QUEUE_STORAGE_DRIVER;
  }
  await expect(saveKey(store, "openai", "bad\nkey")).rejects.toThrow(
    "invalid characters",
  );
});
it("imports images into Inbox and deduplicates by content", async () => {
  const first = await service.importImage("sample.png", "image/png", png);
  expect(first.job.projectId).toBe("inbox");
  expect(first.job.imported).toBe(true);
  expect(first.duplicate).toBe(false);
  const second = await service.importImage("again.png", "image/png", png);
  expect(second.duplicate).toBe(true);
  expect(second.job.id).toBe(first.job.id);
  expect(await service.jobs()).toHaveLength(1);
});
it("rejects unsupported import files and unknown target projects", async () => {
  await expect(
    service.importImage("clip.mp4", "video/mp4", mp4),
  ).rejects.toThrow("images only");
  await expect(
    service.importImage("sample.png", "image/png", png, "missing"),
  ).rejects.toThrow("Project");
});
it("preserves request tags as agent proposals", async () => {
  const project=await service.createProject("Tagged");
  const job=await service.create({...request(project.id),tags:["Forest"]});
  expect(job.tags?.[0]).toMatchObject({tag:"forest",source:"agent"});
});

it("does not recreate permanently deleted request identifiers", async () => {
  const project = await service.createProject("Deleted requests");
  await service.store.put("tombstones", "IMG-test", { id: "IMG-test", deletedAt: new Date().toISOString() });
  await expect(service.create(request(project.id))).rejects.toThrow("permanently deleted");
  expect(await service.store.get("jobs", "IMG-test")).toBeUndefined();
});

it("rejects record deletion through a symbolic link", async () => {
  const { symlink, readFile } = await import("node:fs/promises");
  const outside = await mkdtemp(path.join(os.tmpdir(), "image-queue-delete-outside-"));
  try {
    const target = path.join(outside, "keep.json");
    await writeFile(target, '{"keep":true}');
    await mkdir(path.join(root, "records"), { recursive: true });
    await symlink(target, path.join(root, "records", "linked.json"));
    await expect(service.store.delete("records", "linked")).rejects.toThrow("symbolic link");
    expect(await readFile(target, "utf8")).toBe('{"keep":true}');
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});


it("rejects contradictory ratio metadata through the shared service", async () => {
  const project = await service.createProject("Ratios");
  await expect(service.create({ ...request(project.id), aspectRatio: "16:9" }))
    .rejects.toThrow("do not match");
  expect(await service.jobs()).toEqual([]);
});

it("rejects unknown projects and topics outside the request project", async () => {
  await expect(service.create(request("missing"))).rejects.toThrow("Project does not exist");
  const project = await service.createProject("Destination");
  for (const topic of [undefined, { projectId: project.id, deleted: true }, { projectId: "other" }]) {
    if (topic) await service.store.put("topics", "topic", topic);
    await expect(service.create({ ...request(project.id), topicId: "topic" })).rejects.toThrow("Topic does not belong to project");
  }
  expect(await service.jobs()).toEqual([]);
});

it("creates a request in an existing topic from the same project", async () => {
  const project = await service.createProject("Destination");
  await service.store.put("topics", "topic", { projectId: project.id });
  const job = await service.create({ ...request(project.id), topicId: "topic" });
  expect(job.topicId).toBe("topic");
});

it("serializes explicit reference IDs and rejects conflicting content", async () => {
  const project = await service.createProject("References");
  const sharp = (await import("sharp")).default;
  const other = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer();
  const results = await Promise.allSettled([
    service.addReference(project.id, "first", "image/png", png, undefined, undefined, "shared"),
    service.addReference(project.id, "second", "image/png", other, undefined, undefined, "shared"),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await service.store.list("references")).toHaveLength(1);
});

it("accepts project directories while preserving older project records", async () => {
  const { projectSchema } = await import("../src/core/schema");
  const project = { id: "project", name: "Project", createdAt: "2026-11-14" };
  expect(projectSchema.parse(project).directory).toBeUndefined();
  expect(projectSchema.parse({ ...project, directory: "/projects/images" }).directory).toBe("/projects/images");
  expect(() => projectSchema.parse({ ...project, directory: "/projects/\u0000images" })).toThrow();
});

it("persists a validated directory when creating a project", async () => {
  const project = await service.createProject("Folder project", "/projects/folder-project");
  expect(project.directory).toBe("/projects/folder-project");
  expect((await service.projects()).find(item => item.id === project.id)?.directory).toBe(project.directory);
  await expect(service.createProject("Invalid", "bad\npath")).rejects.toThrow("Invalid project directory");
  expect(await service.projects()).toHaveLength(1);
});

it("requires absolute project directories", async () => {
  const { projectSchema } = await import("../src/core/schema");
  const project = { id: "project", name: "Project", createdAt: "2026-11-14" };
  for (const directory of ["relative/folder", "../outside", "~/images", "C:relative"])
    expect(() => projectSchema.parse({ ...project, directory })).toThrow("absolute path");
  expect(projectSchema.parse({ ...project, directory: "C:\\images" }).directory).toBe("C:\\images");
});


it("retries a blocked provider job once without changing the original attempt", async () => {
  const project = await service.createProject("Recovery");
  const original = await service.create({...request(project.id),source:"api",model:"test"});
  const blocked = {...original,status:"blocked" as const,error:"Reference unavailable",attemptId:"paid-attempt"};
  await service.store.put("jobs",original.id,blocked);
  const parallel = await Promise.allSettled([service.retryImage(original.id),service.retryImage(original.id)]);
  expect(parallel.filter(item=>item.status === "fulfilled")).toHaveLength(1);
  const first = (parallel.find(item=>item.status === "fulfilled") as PromiseFulfilledResult<Job>).value;
  await service.store.put("jobs",original.id,{...blocked,tags:[{tag:"new user tag",source:"user",createdAt:"now"}]});
  const second = await service.retryImage(original.id);
  expect(first.id).toBe(second.id);
  expect(first.id).not.toBe(original.id);
  expect(first.status).toBe("queued");
  expect(first.attemptId).toBeUndefined();
  expect(await service.store.get("jobs",original.id)).toMatchObject({...blocked,tags:[{tag:"new user tag",source:"user",createdAt:"now"}]});
});
it("requires acknowledgement for an uncertain retry and can explicitly mark it failed", async () => {
  const project = await service.createProject("Recovery");
  const original = await service.create({...request(project.id),source:"api",model:"test"});
  await service.store.put("jobs",original.id,{...original,status:"uncertain",attemptId:"original-attempt"});
  await expect(service.retryImage(original.id)).rejects.toThrow("may be charged again");
  expect(await service.store.list("jobs")).toHaveLength(1);
  const retried = await service.retryImage(original.id,true);
  expect(retried.status).toBe("queued");
  expect((await service.markUncertainFailed(original.id)).status).toBe("failed");
  await expect(service.markUncertainFailed(retried.id)).rejects.toThrow("uncertain");
});
it("rejects recovery for active, retained and imported requests", async () => {
  const project = await service.createProject("Recovery");
  const original = await service.create({...request(project.id),source:"api",model:"test"});
  for (const patch of [{status:"queued"},{status:"running"},{status:"done"},{status:"blocked",trashedAt:"now"},{status:"blocked",archivedAt:"now"},{status:"blocked",imported:true},{status:"blocked",source:"queue"}]) {
    await service.store.put("jobs",original.id,{...original,...patch});
    await expect(service.retryImage(original.id,true)).rejects.toThrow("provider request");
  }
});
