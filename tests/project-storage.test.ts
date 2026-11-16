import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "../src/storage/fs";
import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { ProjectStorage } from "../src/storage/project-storage";
it("routes project records and image-linked notes to their store", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await storage.put("projects", "p", { id: "p" });
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  await storage.put("notes", "note", { id: "note", imageId: "image" });
  await storage.put("settings", "appearance", { theme: "dark" });
  expect(await project.get("notes", "note")).toMatchObject({ imageId: "image" });
  expect(await workspace.get("jobs", "image")).toBeUndefined();
  expect(await workspace.get("settings", "appearance")).toEqual({ theme: "dark" });
  expect(await storage.list("jobs")).toHaveLength(1);
});
it("reads blobs from project stores and rejects conflicting copies", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await project.putBlob("image", new Uint8Array([1]), "image/png");
  expect((await storage.getBlob("image"))?.bytes).toEqual(new Uint8Array([1]));
  await workspace.putBlob("image", new Uint8Array([2]), "image/png");
  await expect(storage.getBlob("image")).rejects.toThrow("Conflicting");
});

it("copies referenced file bytes into the project before publishing its record", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await storage.putBlob("results/image", new Uint8Array([1, 2]), "image/png");
  await storage.put("jobs", "image", { id: "image", projectId: "p", blobKey: "results/image" });
  expect((await project.getBlob("results/image"))?.bytes).toEqual(new Uint8Array([1, 2]));
  expect(await project.get("jobs", "image")).toMatchObject({ blobKey: "results/image" });
});

it("does not publish records whose referenced files are missing", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await expect(storage.put("references", "ref", { projectId: "p", blobKey: "missing" })).rejects.toThrow("unavailable");
  expect(await project.get("references", "ref")).toBeUndefined();
});

it("moves a record to its new project after verifying the destination", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", first], ["q", second]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  await storage.put("jobs", "image", { id: "image", projectId: "q" });
  expect(await first.get("jobs", "image")).toBeUndefined();
  expect(await second.get("jobs", "image")).toMatchObject({ projectId: "q" });
  expect(await storage.get("jobs", "image")).toMatchObject({ projectId: "q" });
});

it("reads the committed destination after stale-copy cleanup fails", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const projects = new Map([["p", first], ["q", second]]);
  const storage = new ProjectStorage(workspace, projects);
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  first.delete = async () => { throw new Error("Cleanup interrupted"); };
  await expect(storage.put("jobs", "image", { id: "image", projectId: "q" })).rejects.toThrow("Cleanup interrupted");
  const reopened = new ProjectStorage(workspace, projects);
  expect(await reopened.get("jobs", "image")).toMatchObject({ projectId: "q" });
  expect(await reopened.list("jobs")).toEqual([{ id: "image", projectId: "q" }]);
});

it("rejects reads when the routed project store is unavailable", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const connected = new ProjectStorage(workspace, new Map([["p", project]]));
  await connected.put("jobs", "image", { id: "image", projectId: "p" });
  await workspace.put("jobs", "image", { id: "image", projectId: "old" });
  const disconnected = new ProjectStorage(workspace, new Map());
  await expect(disconnected.get("jobs", "image")).rejects.toThrow("Project storage is unavailable");
});

it("serializes concurrent writes to the same routed record", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  const results = await Promise.allSettled([
    storage.put("jobs", "image", { id: "image", projectId: "p", prompt: "First" }),
    storage.put("jobs", "image", { id: "image", projectId: "p", prompt: "Second" }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(["First", "Second"]).toContain((await storage.get<{ prompt: string }>("jobs", "image"))?.prompt);
});

it("keeps deleted records hidden when stale-copy deletion fails", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const projects = new Map([["p", project]]);
  const storage = new ProjectStorage(workspace, projects);
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  project.delete = async () => { throw new Error("Cleanup failed"); };
  await expect(storage.delete("jobs", "image")).rejects.toThrow("Cleanup failed");
  const reopened = new ProjectStorage(workspace, projects);
  expect(await reopened.get("jobs", "image")).toBeUndefined();
  expect(await reopened.list("jobs")).toEqual([]);
});

it("allows an explicit write to replace a deletion marker", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p", prompt: "Before" });
  await storage.delete("jobs", "image");
  expect(await storage.get("jobs", "image")).toBeUndefined();
  await storage.put("jobs", "image", { id: "image", projectId: "p", prompt: "Restored" });
  expect(await storage.get("jobs", "image")).toMatchObject({ prompt: "Restored" });
  expect(await storage.list("jobs")).toHaveLength(1);
});

it("rejects invalid record keys before reading or writing routing markers", async () => {
  const workspace = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map());
  await expect(storage.get("jobs", "../escape")).rejects.toThrow("Invalid storage key");
  await expect(storage.put("jobs", "../escape", {})).rejects.toThrow("Invalid storage key");
  await expect(storage.delete("jobs", "../escape")).rejects.toThrow("Invalid storage key");
  await expect(storage.entries("../jobs")).rejects.toThrow("Invalid storage key");
  expect(await workspace.list("record-routes")).toEqual([]);
});

it("isolates workspace settings from project-local settings", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await workspace.put("settings", "appearance", { theme: "dark" });
  await project.put("settings", "appearance", { theme: "light" });
  await project.put("settings", "project-owner", { projectId: "p" });
  expect(await storage.get("settings", "appearance")).toEqual({ theme: "dark" });
  expect(await storage.list("settings")).toEqual([{ theme: "dark" }]);
  await storage.delete("settings", "appearance");
  expect(await project.get("settings", "appearance")).toEqual({ theme: "light" });
});

it("moves image notes and preview metadata with the image", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", first], ["q", second]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  await storage.put("notes", "note", { id: "note", imageId: "image", text: "Keep" });
  await storage.put("asset-meta", "image", { hash: "asset" });
  await storage.put("prepared-corrections", "pending", { imageId: "image", referenceIds: [] });
  await storage.put("jobs", "image", { id: "image", projectId: "q" });
  expect(await first.get("notes", "note")).toBeUndefined();
  expect(await second.get("notes", "note")).toMatchObject({ text: "Keep" });
  expect(await second.get("asset-meta", "image")).toEqual({ hash: "asset" });
  expect(await second.get("prepared-corrections", "pending")).toBeDefined();
});

it("finishes moving related notes when a project move is retried after failure", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", first], ["q", second]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  await storage.put("notes", "note", { id: "note", imageId: "image", text: "Keep" });
  const put = second.put.bind(second);
  let failed = false;
  second.put = async (collection, id, value) => {
    if (collection === "notes" && !failed) {
      failed = true;
      throw new Error("Interrupted note move");
    }
    return put(collection, id, value);
  };
  const moved = { id: "image", projectId: "q" };
  await expect(storage.put("jobs", "image", moved)).rejects.toThrow("Interrupted note move");
  expect(await storage.get("jobs", "image")).toEqual(moved);
  expect(await storage.get("notes", "note")).toMatchObject({ text: "Keep" });
  await storage.put("jobs", "image", moved);
  expect(await second.get("notes", "note")).toMatchObject({ text: "Keep" });
  expect(await first.get("notes", "note")).toBeUndefined();
});

it("recovers interrupted related-record moves from the persisted operation", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const projects = new Map([["p", first], ["q", second]]);
  const storage = new ProjectStorage(workspace, projects);
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  await storage.put("notes", "note", { imageId: "image", text: "Keep" });
  const put = second.put.bind(second);
  second.put = async (collection, id, value) => {
    if (collection === "notes") throw new Error("Interrupted");
    return put(collection, id, value);
  };
  await expect(storage.put("jobs", "image", { id: "image", projectId: "q" })).rejects.toThrow("Interrupted");
  second.put = put;
  const reopened = new ProjectStorage(workspace, projects);
  await reopened.recover();
  expect(await second.get("notes", "note")).toMatchObject({ text: "Keep" });
  expect(await first.get("notes", "note")).toBeUndefined();
  expect(await workspace.list("project-writes")).toEqual([]);
});

it("does not replay a pending write after an interrupted deletion", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p" });
  const { hash } = await import("../src/core/schema");
  await workspace.put("project-writes", await hash("jobs/image"), {
    collection: "jobs", id: "image", value: { id: "image", projectId: "p", prompt: "Old write" },
  });
  project.delete = async () => { throw new Error("Interrupted deletion"); };
  await expect(storage.delete("jobs", "image")).rejects.toThrow("Interrupted deletion");
  await storage.recover();
  expect(await storage.get("jobs", "image")).toBeUndefined();
  expect(await workspace.list("project-writes")).toEqual([]);
});

it("rejects malformed pending operations before replaying them", async () => {
  const workspace = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map());
  await workspace.put("project-writes", "invalid", { collection: "settings", id: "credentials", value: {} });
  await expect(storage.recover()).rejects.toThrow("Invalid pending project operation");
  expect(await workspace.get("settings", "credentials")).toBeUndefined();
});

it("refreshes registrations once for a collection read", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  for (let index = 0; index < 100; index++) {
    await project.put("jobs", `image-${index}`, { id: `image-${index}`, projectId: "p" });
  }
  let refreshes = 0;
  const storage = new ProjectStorage(workspace, new Map([["p", project]]), undefined, async () => { refreshes++; });
  expect(await storage.list("jobs")).toHaveLength(100);
  expect(refreshes).toBe(1);
  await storage.get("jobs", "image-0");
  expect(refreshes).toBe(2);
});

it("writes generated thumbnails to each owning project folder", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", first], ["q", second]]));
  await storage.put("jobs", "one", { id: "one", projectId: "p" });
  await storage.put("jobs", "two", { id: "two", projectId: "q" });
  await storage.put("asset-meta", "one", { hash: "shared" });
  await storage.put("asset-meta", "two", { hash: "shared" });
  const key = "thumbs/shared/320.webp";
  await storage.putBlob(key, new Uint8Array([1, 2]), "image/webp");
  expect(await first.getBlob(key)).toBeDefined();
  expect(await second.getBlob(key)).toBeDefined();
  expect(await workspace.getBlob(key)).toBeUndefined();
});

it("does not refresh project folders for workspace-only settings", async () => {
  const workspace = new MemoryStorage();
  let refreshes = 0;
  const storage = new ProjectStorage(workspace, new Map(), undefined, async () => { refreshes++; });
  await storage.put("settings", "one", { value: true });
  expect(await storage.get("settings", "one")).toEqual({ value: true });
  expect(await storage.list("settings")).toHaveLength(1);
  await storage.delete("settings", "one");
  expect(refreshes).toBe(0);
});

it("keeps deletion and routing authoritative when listing duplicate records", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await storage.put("jobs", "image", { id: "image", projectId: "p", prompt: "Current" });
  await workspace.put("jobs", "image", { id: "image", projectId: "p", prompt: "Stale" });
  expect(await storage.list("jobs")).toEqual([{ id: "image", projectId: "p", prompt: "Current" }]);
  await storage.delete("jobs", "image");
  await workspace.put("jobs", "image", { id: "image", prompt: "Stale copy" });
  expect(await storage.list("jobs")).toEqual([]);
});

it("rejects conflicting unregistered records during collection reads", async () => {
  const workspace = new MemoryStorage();
  const project = new MemoryStorage();
  await workspace.put("jobs", "image", { prompt: "First" });
  await project.put("jobs", "image", { prompt: "Second" });
  const storage = new ProjectStorage(workspace, new Map([["p", project]]));
  await expect(storage.list("jobs")).rejects.toThrow("Conflicting project record");
});

it("removes verified staging bytes after publishing a project record", async () => {
  const workspace = new MemoryStorage();
  const folder = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", folder]]));
  await storage.putBlob("results/staged", new Uint8Array([1]), "image/png");
  await storage.put("jobs", "image", { id: "image", projectId: "p", blobKey: "results/staged" });
  expect(await workspace.getBlob("results/staged")).toBeUndefined();
  expect(await folder.getBlob("results/staged")).toBeDefined();
});

it("keeps staging bytes referenced by workspace records", async () => {
  const workspace = new MemoryStorage();
  const folder = new MemoryStorage();
  const storage = new ProjectStorage(workspace, new Map([["p", folder]]));
  await workspace.putBlob("shared", new Uint8Array([1]), "image/png");
  await workspace.put("references", "legacy", { projectId: "legacy", blobKey: "shared" });
  await storage.put("jobs", "image", { id: "image", projectId: "p", blobKey: "shared" });
  expect(await workspace.getBlob("shared")).toBeDefined();
});

it("recovers publication interrupted while deleting staging bytes", async () => {
  const workspace = new MemoryStorage();
  const folder = new MemoryStorage();
  const projects = new Map([["p", folder]]);
  const storage = new ProjectStorage(workspace, projects);
  await storage.putBlob("results/retry", new Uint8Array([1]), "image/png");
  const remove = workspace.deleteBlob.bind(workspace);
  workspace.deleteBlob = async () => { throw new Error("Cleanup interrupted"); };
  await expect(storage.put("jobs", "image", { id: "image", projectId: "p", blobKey: "results/retry" })).rejects.toThrow("Cleanup interrupted");
  expect(await folder.getBlob("results/retry")).toBeDefined();
  workspace.deleteBlob = remove;
  await new ProjectStorage(workspace, projects).recover();
  expect(await workspace.getBlob("results/retry")).toBeUndefined();
  expect(await folder.get("jobs", "image")).toBeDefined();
  expect(await workspace.list("project-writes")).toEqual([]);
});

it.each([false, true])("cleans the previous project folder only if its file is unshared (%s)", async (shared) => {
  const root = await mkdtemp(join(tmpdir(), "image-queue-move-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const first = new FileStorage(join(root, "first"));
    const second = new FileStorage(join(root, "second"));
    const storage = new ProjectStorage(workspace, new Map([["p", first], ["q", second]]));
    const blobKey = "results/moved";
    const bytes = new Uint8Array([1]);
    await storage.putBlob(blobKey, bytes, "image/png");
    await storage.put("jobs", "image", { id: "image", projectId: "p", blobKey });
    if (shared) await storage.put("references", "reference", { projectId: "p", blobKey });

    await storage.put("jobs", "image", { id: "image", projectId: "q", blobKey });

    expect(await second.getBlob(blobKey)).toEqual({ bytes, mime: "image/png" });
    expect(Boolean(await first.getBlob(blobKey))).toBe(shared);
    expect(await first.get("jobs", "image")).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers a move interrupted during source file cleanup", async () => {
  const workspace = new MemoryStorage();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  const projects = new Map([["p", first], ["q", second]]);
  const storage = new ProjectStorage(workspace, projects);
  const blobKey = "results/moved";
  const bytes = new Uint8Array([1]);
  await storage.putBlob(blobKey, bytes, "image/png");
  await storage.put("jobs", "image", { id: "image", projectId: "p", blobKey });

  const deleteBlob = first.deleteBlob.bind(first);
  first.deleteBlob = async () => { throw new Error("Interrupted source cleanup"); };
  const moved = { id: "image", projectId: "q", blobKey };
  await expect(storage.put("jobs", "image", moved)).rejects.toThrow("Interrupted source cleanup");
  expect(await second.getBlob(blobKey)).toEqual({ bytes, mime: "image/png" });

  first.deleteBlob = deleteBlob;
  const reopened = new ProjectStorage(workspace, projects);
  await reopened.recover();
  expect(await reopened.get("jobs", "image")).toEqual(moved);
  expect(await first.getBlob(blobKey)).toBeUndefined();
  expect(await workspace.list("project-writes")).toEqual([]);
});

it.each([false, true])("moves topic reference bytes between folders (shared: %s)", async (shared) => {
  const { moveTopic } = await import("../src/core/organization");
  const root = await mkdtemp(join(tmpdir(), "image-queue-topic-move-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const from = new FileStorage(join(root, "from"));
    const to = new FileStorage(join(root, "to"));
    const store = new ProjectStorage(workspace, new Map([["from", from], ["to", to]]));
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("projects", "from", { id: "from" });
    await store.put("projects", "to", { id: "to" });
    await store.put("topics", "topic", { id: "topic", projectId: "from" });
    await from.putBlob("reference", bytes, "image/png");
    await store.put("references", "ref", { id: "ref", projectId: "from", topicId: "topic", blobKey: "reference" });

    if (shared) {
      await store.put("references", "remaining", { id: "remaining", projectId: "from", topicId: "other", blobKey: "reference" });
    }

    await moveTopic(store, "topic", "to");
    expect(await to.get("references", "ref")).toMatchObject({ projectId: "to", topicId: "topic" });
    expect(await to.getBlob("reference")).toEqual({ mime: "image/png", bytes });
    expect(await from.get("references", "ref")).toBeUndefined();
    if (shared) {
      expect(await from.get("references", "remaining")).toMatchObject({ projectId: "from", topicId: "other" });
      expect(await from.getBlob("reference")).toEqual({ mime: "image/png", bytes });
    } else {
      expect(await from.getBlob("reference")).toBeUndefined();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
