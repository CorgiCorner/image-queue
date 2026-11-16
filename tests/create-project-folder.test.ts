import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileStorage } from "../src/storage/fs";
import { createProjectFolder } from "../src/storage/create-project-folder";
import { openProjectStorage } from "../src/storage/open-project-storage";

it("creates a self-contained project and reopens it through the workspace registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "new-project-folder-"));
  try {
    const workspace = new FileStorage(join(root, "storage"));
    const project = await createProjectFolder(workspace, { id: "p", name: "Project", createdAt: "2026-11-14" });
    expect(project.directory).toBe(join(root, "projects", "p").replace(/^\/var\//, "/private/var/"));
    expect(await workspace.get("projects", "p")).toBeUndefined();
    expect(await (await openProjectStorage(workspace)).get("projects", "p")).toEqual(project);
    expect(await createProjectFolder(workspace, project)).toEqual(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects the workspace folder before writing project ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "new-project-invalid-"));
  try {
    const workspace = new FileStorage(root);
    await expect(createProjectFolder(workspace, { id: "p", name: "Project", createdAt: "2026-11-14", directory: root })).rejects.toThrow("separate");
    expect(await workspace.get("settings", "project-owner")).toBeUndefined();
    expect(await workspace.list("project-directories")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves the first owner's folder when a second project selects it", async () => {
  const root = await mkdtemp(join(tmpdir(), "new-project-owner-"));
  try {
    const workspace = new FileStorage(join(root, "storage"));
    const first = await createProjectFolder(workspace, { id: "first", name: "First", createdAt: "2026-11-14", directory: join(root, "project") });
    await expect(createProjectFolder(workspace, { id: "second", name: "Second", createdAt: "2026-11-14", directory: first.directory })).rejects.toThrow("separate");
    expect(await (await openProjectStorage(workspace)).get("projects", "first")).toEqual(first);
    expect(await workspace.get("project-directories", "second")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("creates projects through the shared service and keeps later writes in their folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-service-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "storage"));
    const store = await openProjectStorage(workspace);
    const service = new ImageService(store);
    const project = await service.createProject("My project", join(root, "chosen"));
    await store.put("jobs", "image", { id: "image", projectId: project.id });
    await store.putBlob("images/example", new Uint8Array([1, 2]), "image/png");
    await store.put("references", "reference", { projectId: project.id, blobKey: "images/example" });
    const reopened = await openProjectStorage(workspace);
    expect(await new ImageService(reopened).projects()).toEqual([project]);
    const folder = new FileStorage(project.directory!);
    expect(await folder.get("jobs", "image")).toMatchObject({ projectId: project.id });
    expect(await folder.getBlob("images/example")).toEqual({ bytes: new Uint8Array([1, 2]), mime: "image/png" });
    expect(await workspace.get("jobs", "image")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("refreshes project routing in a client opened before another client creates a project", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-clients-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "storage"));
    const first = await openProjectStorage(workspace);
    const second = await openProjectStorage(workspace);
    const project = await new ImageService(second).createProject("Shared project");
    expect(await new ImageService(first).projects()).toEqual([project]);
    await first.put("jobs", "image", { id: "image", projectId: project.id });
    expect(await new FileStorage(project.directory!).get("jobs", "image")).toBeDefined();
    expect(await workspace.get("jobs", "image")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not recreate an unavailable project folder when an existing client writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-disconnected-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const { stat } = await import("node:fs/promises");
    const workspace = new FileStorage(join(root, "storage"));
    const store = await openProjectStorage(workspace);
    const project = await new ImageService(store).createProject("Disconnected");
    await rm(project.directory!, { recursive: true });
    await expect(store.put("jobs", "image", { id: "image", projectId: project.id })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(project.directory!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await workspace.get("jobs", "image")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects nested project folders before creating their contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "nested-project-"));
  try {
    const { stat } = await import("node:fs/promises");
    const workspace = new FileStorage(join(root, "storage"));
    const first = await createProjectFolder(workspace, { id: "first", name: "First", createdAt: "2026-11-14" });
    const nested = join(first.directory!, "nested");
    await expect(createProjectFolder(workspace, { id: "second", name: "Second", createdAt: "2026-11-14", directory: nested })).rejects.toThrow("separate");
    await expect(stat(nested)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects a changed folder on retry without creating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-retry-folder-"));
  try {
    const { stat } = await import("node:fs/promises");
    const workspace = new FileStorage(join(root, "storage"));
    const project = await createProjectFolder(workspace, { id: "p", name: "Project", createdAt: "2026-11-14" });
    const other = join(root, "other");
    await expect(createProjectFolder(workspace, { ...project, directory: other })).rejects.toThrow("different folder");
    await expect(stat(other)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await (await openProjectStorage(workspace)).get("projects", "p")).toEqual(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves the registered project when a conflicting retry changes its record", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-conflicting-retry-"));
  try {
    const workspace = new FileStorage(join(root, "storage"));
    const project = await createProjectFolder(workspace, {
      id: "p",
      name: "Original project",
      createdAt: "2026-11-14",
    });

    await expect(createProjectFolder(workspace, { ...project, name: "Conflicting project" }))
      .rejects.toThrow("Folder contains a different project record");

    expect(await workspace.get("project-directories", project.id)).toEqual({
      id: project.id,
      directory: project.directory,
    });
    expect(await (await openProjectStorage(workspace)).get("projects", project.id)).toEqual(project);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("registers only one project when two clients select the same folder concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-concurrent-"));
  try {
    const storageRoot = join(root, "storage");
    const workspace = new FileStorage(storageRoot);
    const directory = join(root, "shared");
    const results = await Promise.allSettled([
      createProjectFolder(workspace, { id: "first", name: "First", createdAt: "2026-11-14", directory }),
      createProjectFolder(new FileStorage(storageRoot), { id: "second", name: "Second", createdAt: "2026-11-14", directory }),
    ]);

    const saved = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    const rejected = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    expect(saved).toHaveLength(1);
    expect(rejected).toEqual([expect.objectContaining({ key: "project-directories" })]);
    const rejectedId = saved[0].id === "first" ? "second" : "first";
    await expect(createProjectFolder(workspace, {
      id: rejectedId, name: "Retry", createdAt: "2026-11-14", directory,
    })).rejects.toThrow("Choose a folder separate from other projects");
    expect(await workspace.list("project-directories")).toEqual([
      { id: saved[0].id, directory: saved[0].directory },
    ]);
    expect(await new FileStorage(directory).list("projects")).toEqual(saved);
    expect(await (await openProjectStorage(workspace)).list("projects")).toEqual(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
