import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileStorage } from "../src/storage/fs";
import { prepareProjectDirectory } from "../src/storage/prepare-project-directory";
it("prepares an owned directory with verified project records", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepare-project-directory-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project" });
    const result = await prepareProjectDirectory(source, join(root, "project"), "p");
    expect(result).toMatchObject({ records: 1, imported: 0, files: 0 });
    const copied = new FileStorage(result.directory);
    expect(await copied.get("projects", "p")).toMatchObject({ name: "Project" });
    expect(await copied.get("settings", "project-owner")).toEqual({ projectId: "p" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects the workspace itself and symlink aliases without claiming it", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepare-project-same-"));
  try {
    const { symlink } = await import("node:fs/promises");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project" });
    await expect(prepareProjectDirectory(source, source.root, "p")).rejects.toThrow("separate");
    const alias = join(root, "alias");
    await symlink(source.root, alias);
    await expect(prepareProjectDirectory(source, alias, "p")).rejects.toThrow("separate");
    expect(await source.get("settings", "project-owner")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not create a destination for a missing project", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepare-project-missing-"));
  try {
    const { stat } = await import("node:fs/promises");
    const source = new FileStorage(join(root, "workspace"));
    const destination = join(root, "destination");
    await expect(prepareProjectDirectory(source, destination, "missing")).rejects.toThrow("does not exist");
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects destinations containing or nested inside the workspace store", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlapping-project-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p" });
    await expect(prepareProjectDirectory(source, join(source.root, "nested"), "p")).rejects.toThrow("separate");
    await expect(prepareProjectDirectory(source, root, "p")).rejects.toThrow("separate");
    expect(await new FileStorage(root).get("settings", "project-owner")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("resolves existing ancestor symlinks before checking an uncreated destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "ancestor-project-"));
  try {
    const { symlink, stat } = await import("node:fs/promises");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p" });
    const alias = join(root, "workspace-alias");
    await symlink(source.root, alias);
    await expect(prepareProjectDirectory(source, join(alias, "new", "project"), "p")).rejects.toThrow("separate");
    await expect(stat(join(source.root, "new"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("prepares a project that already lives in a registered folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepare-routed-project-"));
  try {
    const { openProjectStorage } = await import("../src/storage/open-project-storage");
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const records = await openProjectStorage(workspace);
    const project = await new ImageService(records).createProject("Project");
    await records.put("notes", "note", { id: "note", imageId: "image", text: "Keep" });
    await records.put("jobs", "image", { id: "image", projectId: project.id, referenceIds: [] });
    const result = await prepareProjectDirectory(workspace, join(root, "destination"), project.id, records);
    const copied = new FileStorage(result.directory);
    expect(await copied.get("projects", project.id)).toEqual(project);
    expect(await copied.get("notes", "note")).toMatchObject({ text: "Keep" });
    expect(await workspace.get("project-directories", project.id)).toMatchObject({ directory: project.directory });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects relative paths and paths through a regular file without changing the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepare-project-invalid-path-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    const project = { id: "p", name: "Project", createdAt: "2026-01-01" };
    await source.put("projects", project.id, project);
    const file = join(root, "regular-file");
    await writeFile(file, "existing content");

    await expect(prepareProjectDirectory(source, "relative/path", project.id)).rejects.toThrow("must be an absolute path");
    await expect(prepareProjectDirectory(source, join(file, "child"), project.id)).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(await source.get("projects", project.id)).toEqual(project);
    expect(await source.list("project-directories")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
