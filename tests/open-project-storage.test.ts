import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { FileStorage } from "../src/storage/fs";
import { projectDirectory } from "../src/storage/project-directory";
import { openProjectStorage } from "../src/storage/open-project-storage";
it("opens registered project data and writes back to its folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-project-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const folder = await projectDirectory(join(root, "project"), "p");
    await workspace.put("project-directories", "p", { id: "p", directory: folder.root });
    await folder.put("jobs", "image", { id: "image", projectId: "p" });
    const storage = await openProjectStorage(workspace);
    expect(await storage.get("jobs", "image")).toMatchObject({ projectId: "p" });
    await storage.put("notes", "note", { imageId: "image", text: "Note" });
    expect(await folder.get("notes", "note")).toMatchObject({ text: "Note" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("does not recreate missing registered folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "missing-project-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const missing = join(root, "missing");
    await workspace.put("project-directories", "p", { id: "p", directory: missing });
    await expect(openProjectStorage(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects a registration stored under another project's key", async () => {
  const root = await mkdtemp(join(tmpdir(), "registration-key-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const folder = await projectDirectory(join(root, "project"), "p");
    await workspace.put("project-directories", "other", { id: "p", directory: folder.root });
    await expect(openProjectStorage(workspace)).rejects.toThrow("identity");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects the workspace store as a project folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-registration-"));
  try {
    const workspace = new FileStorage(root);
    await workspace.put("project-directories", "p", { id: "p", directory: root });
    await expect(openProjectStorage(workspace)).rejects.toThrow("workspace store");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("waits for an active journal writer instead of replaying its unfinished operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "concurrent-project-open-"));
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let journalWritten!: () => void;
  const pending = new Promise<void>(resolve => { journalWritten = resolve; });
  let write: Promise<void> | undefined;
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    const folder = await projectDirectory(join(root, "project"), "p");
    await workspace.put("project-directories", "p", { id: "p", directory: folder.root });
    await folder.put("jobs", "image", { id: "image", projectId: "p", status: "done" });
    const storage = await openProjectStorage(workspace);
    const put = workspace.put.bind(workspace);
    vi.spyOn(workspace, "put").mockImplementation(async (collection, id, value) => {
      await put(collection, id, value);
      if (collection === "project-writes") { journalWritten(); await blocked; }
    });
    write = storage.put("asset-meta", "image", { id: "image", hash: "pixels" });
    await pending;
    // Start opening while the write's journal and per-record lock still exist.
    const opening = openProjectStorage(workspace);
    const outcome = opening.then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await write;
    expect(await outcome).toHaveProperty("value");
    expect(await (await opening).get("asset-meta", "image")).toMatchObject({ hash: "pixels" });
    expect(await workspace.list("project-writes")).toEqual([]);
  } finally {
    release(); await write?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
