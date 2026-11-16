import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { copyProject } from "../src/storage/project-copy";
it("copies and verifies project records and shared blobs while leaving the source intact", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Project" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "images/shared" });
  await source.put("jobs", "other", { id: "other", projectId: "other" });
  await source.put("references", "ref", { id: "ref", projectId: "p", blobKey: "images/shared" });
  await source.put("notes", "note", { id: "note", imageId: "one", text: "Note" });
  await source.put("topics", "topic", { id: "topic", projectId: "p" });
  await source.putBlob("images/shared", new Uint8Array([1, 2, 3]), "image/png");
  expect(await copyProject(source, destination, "p")).toEqual({ records: 5, files: 1 });
  expect(await destination.get("jobs", "other")).toBeUndefined();
  expect(await destination.get("notes", "note")).toMatchObject({ imageId: "one" });
  expect(await source.get("jobs", "one")).toBeDefined();
});
it("stops on missing files without deleting the original project", async () => {
  const source = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "missing" });
  await expect(copyProject(source, new MemoryStorage(), "p")).rejects.toThrow("missing");
  expect(await source.get("projects", "p")).toBeDefined();
});

it("rejects destination conflicts before writing project data", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Source" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "image" });
  await source.putBlob("image", new Uint8Array([1]), "image/png");
  await destination.put("projects", "p", { id: "p", name: "Existing" });
  await expect(copyProject(source, destination, "p")).rejects.toThrow("conflicting project records");
  expect(await destination.getBlob("image")).toBeUndefined();
  expect(await destination.get("projects", "p")).toMatchObject({ name: "Existing" });
});

it("rejects conflicting destination bytes without overwriting them", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "image" });
  await source.putBlob("image", new Uint8Array([1]), "image/png");
  await destination.putBlob("image", new Uint8Array([2]), "image/png");
  await expect(copyProject(source, destination, "p")).rejects.toThrow("conflicting project files");
  expect((await destination.getBlob("image"))?.bytes).toEqual(new Uint8Array([2]));
  expect(await destination.get("projects", "p")).toBeUndefined();
});

it("preserves version counters and correction metadata", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", stackId: "stack", idempotencyKey: "request" });
  await source.put("stack-counters", "stack", { id: "stack", lastVersion: 7 });
  await source.put("correction-intents", "request", { imageId: "one", noteIds: ["note"] });
  await source.put("prepared-corrections", "request", { imageId: "one", referenceIds: [] });
  await source.put("asset-meta", "one", { hash: "hash" });
  await copyProject(source, destination, "p");
  expect(await destination.get("stack-counters", "stack")).toMatchObject({ lastVersion: 7 });
  expect(await destination.get("correction-intents", "request")).toMatchObject({ noteIds: ["note"] });
  expect(await destination.get("prepared-corrections", "request")).toBeDefined();
  expect(await destination.get("asset-meta", "one")).toMatchObject({ hash: "hash" });
});

it("copies between disk folders and supports retrying the same copy", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileStorage } = await import("../src/storage/fs");
  const root = await mkdtemp(join(tmpdir(), "project-copy-"));
  try {
    const source = new FileStorage(join(root, "source"));
    const destination = new FileStorage(join(root, "project"));
    await source.put("projects", "p", { id: "p", name: "Project" });
    await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "results/image" });
    await source.putBlob("results/image", new Uint8Array([1, 2, 3]), "image/png");
    const first = await copyProject(source, destination, "p");
    expect(await copyProject(source, destination, "p")).toEqual(first);
    expect((await destination.getBlob("results/image"))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(await destination.get("jobs", "one")).toMatchObject({ projectId: "p" });
    expect(await source.get("jobs", "one")).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a copy if source records change while destination writes are in progress", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Before" });
  const put = destination.put.bind(destination);
  destination.put = async (collection, id, value) => {
    await put(collection, id, value);
    if (collection === "projects") await source.put("projects", "p", { id: "p", name: "After" });
  };
  await expect(copyProject(source, destination, "p")).rejects.toThrow("changed during copy");
  expect(await source.get("projects", "p")).toMatchObject({ name: "After" });
});

it("detects new project images created during the copy", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  const put = destination.put.bind(destination);
  destination.put = async (collection, id, value) => {
    await put(collection, id, value);
    await source.put("jobs", "new", { id: "new", projectId: "p" });
  };
  await expect(copyProject(source, destination, "p")).rejects.toThrow("changed during copy");
  expect(await source.get("jobs", "new")).toBeDefined();
});

it.each(["notes", "topics"])("detects new %s during copying", async collection => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p" });
  const put = destination.put.bind(destination);
  destination.put = async (target, id, value) => {
    await put(target, id, value);
    await source.put(collection, "new", { id: "new", projectId: "p", imageId: "image" });
  };
  await expect(copyProject(source, destination, "p")).rejects.toThrow("changed during copy");
});

it("detects source file changes after copying its bytes", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "image" });
  await source.putBlob("image", new Uint8Array([1]), "image/png");
  const put = destination.put.bind(destination);
  destination.put = async (collection, id, value) => {
    await put(collection, id, value);
    await source.putBlob("image", new Uint8Array([2]), "image/png");
  };
  await expect(copyProject(source, destination, "p")).rejects.toThrow("file changed during copy");
});

it("rejects a destination that does not preserve written file bytes", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "image" });
  await source.putBlob("image", new Uint8Array([1]), "image/png");
  const putBlob = destination.putBlob.bind(destination);
  destination.putBlob = async (key, _bytes, mime) => putBlob(key, new Uint8Array([9]), mime);
  await expect(copyProject(source, destination, "p")).rejects.toThrow("file verification failed");
  expect(await destination.get("projects", "p")).toBeUndefined();
  expect((await source.getBlob("image"))?.bytes).toEqual(new Uint8Array([1]));
});

it("rejects a destination that does not preserve record contents", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Original" });
  const put = destination.put.bind(destination);
  destination.put = async (collection, id, _value) => put(collection, id, { id, name: "Corrupt" });
  await expect(copyProject(source, destination, "p")).rejects.toThrow("record verification failed");
  expect(await source.get("projects", "p")).toMatchObject({ name: "Original" });
});

it("copies pending correction preparation before a job exists", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p" });
  await source.put("prepared-corrections", "pending", { id: "pending", imageId: "image", referenceIds: [] });
  await source.put("correction-intents", "pending", { id: "pending", imageId: "image" });
  await copyProject(source, destination, "p");
  expect(await destination.get("prepared-corrections", "pending")).toMatchObject({ imageId: "image" });
  expect(await destination.get("correction-intents", "pending")).toBeDefined();
});

it("refuses to report a complete copy when ready images still live outside storage", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "external", { id: "external", projectId: "p", source: "queue", status: "done", outputPath: "/external/image.png" });
  await expect(copyProject(source, destination, "p")).rejects.toThrow("Import external image files");
  expect(await destination.list("projects")).toEqual([]);
  expect(await destination.list("jobs")).toEqual([]);
});

it("includes stored thumbnail files alongside original images", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "one", { id: "one", projectId: "p", blobKey: "original", thumbnailKey: "thumbnail" });
  await source.putBlob("original", new Uint8Array([1]), "image/png");
  await source.putBlob("thumbnail", new Uint8Array([2]), "image/webp");
  expect((await copyProject(source, destination, "p")).files).toBe(2);
  expect(await destination.getBlob("thumbnail")).toEqual({ bytes: new Uint8Array([2]), mime: "image/webp" });
});

it("preserves legacy pending records using their storage keys", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p" });
  await source.put("prepared-corrections", "legacy-key", { imageId: "image", referenceIds: [] });
  await copyProject(source, destination, "p");
  expect(await destination.get("prepared-corrections", "legacy-key")).toEqual({ imageId: "image", referenceIds: [] });
});

it("detects a newly prepared correction during project copying", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p" });
  const put = destination.put.bind(destination);
  destination.put = async (collection, id, value) => {
    await put(collection, id, value);
    await source.put("prepared-corrections", "new", { imageId: "image", referenceIds: [] });
  };
  await expect(copyProject(source, destination, "p")).rejects.toThrow("changed during copy");
});

it("copies legacy notes and topics using their storage keys", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p" });
  await source.put("notes", "legacy-note", { imageId: "image", text: "Keep this note" });
  await source.put("topics", "legacy-topic", { projectId: "p", name: "Keep this topic" });
  await copyProject(source, destination, "p");
  expect(await destination.get("notes", "legacy-note")).toEqual({ imageId: "image", text: "Keep this note" });
  expect(await destination.get("topics", "legacy-topic")).toEqual({ projectId: "p", name: "Keep this topic" });
});

it("copies referenced files from another project including their source video", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: ["frame"] });
  await source.put("references", "frame", { id: "frame", projectId: "other", parentId: "video", blobKey: "frame" });
  await source.put("references", "video", { id: "video", projectId: "other", blobKey: "video" });
  await source.putBlob("frame", new Uint8Array([1]), "image/png");
  await source.putBlob("video", new Uint8Array([2]), "video/mp4");
  await copyProject(source, destination, "p");
  expect(await destination.get("references", "frame")).toBeDefined();
  expect(await destination.get("references", "video")).toBeDefined();
  expect(await destination.getBlob("video")).toBeDefined();
});

it("rejects missing job references before copying records", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: ["missing"] });
  await expect(copyProject(source, destination, "p")).rejects.toThrow("Project reference is missing");
  expect(await destination.list("projects")).toEqual([]);
});

it("rejects a missing parent video before copying records", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("references", "frame", { id: "frame", projectId: "p", parentId: "missing-video", blobKey: "frame" });
  await source.putBlob("frame", new Uint8Array([1]), "image/png");
  await expect(copyProject(source, destination, "p")).rejects.toThrow("Project reference is missing");
  expect(await destination.list("references")).toEqual([]);
});

it("includes references held by corrections that have not been queued yet", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: [] });
  await source.put("prepared-corrections", "pending", { imageId: "image", referenceIds: ["prepared"] });
  await source.put("references", "prepared", { id: "prepared", projectId: "other", blobKey: "prepared" });
  await source.putBlob("prepared", new Uint8Array([1]), "image/png");
  await copyProject(source, destination, "p");
  expect(await destination.get("references", "prepared")).toBeDefined();
  expect(await destination.getBlob("prepared")).toBeDefined();
});

it("handles cyclic reference ancestry without repeating files", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p" });
  await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: ["a"] });
  await source.put("references", "a", { id: "a", projectId: "other", parentId: "b", blobKey: "a" });
  await source.put("references", "b", { id: "b", projectId: "other", parentId: "a", blobKey: "b" });
  await source.putBlob("a", new Uint8Array([1]), "image/png");
  await source.putBlob("b", new Uint8Array([2]), "image/png");
  expect(await copyProject(source, destination, "p")).toEqual({ records: 4, files: 2 });
  expect(await destination.list("references")).toHaveLength(2);
});
