import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileStorage } from "../src/storage/fs";
import { openProjectStorage } from "../src/storage/open-project-storage";
import { prepareProjectMigration } from "../src/storage/prepare-project-migration";
import { activateProjectMigration } from "../src/storage/activate-project-migration";

it("activates a verified legacy project copy and routes subsequent writes there", async () => {
  const root = await mkdtemp(join(tmpdir(), "activate-project-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await workspace.put("jobs", "image", { id: "image", projectId: "p", referenceIds: [] });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const project = await activateProjectMigration(workspace, source, "p");
    const reopened = await openProjectStorage(workspace);
    expect(await reopened.get("projects", "p")).toEqual(project);
    await reopened.put("jobs", "image", { id: "image", projectId: "p", prompt: "Updated" });
    expect(await new FileStorage(project.directory!).get("jobs", "image")).toMatchObject({ prompt: "Updated" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects a stale migration before changing the registered folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "stale-activation-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    await source.put("jobs", "new", { id: "new", projectId: "p" });
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("changed");
    expect(await workspace.get("project-directories", "p")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("resumes a migration interrupted after its registration was written", async () => {
  const root = await mkdtemp(join(tmpdir(), "resume-activation-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const put = workspace.put.bind(workspace);
    workspace.put = async (collection, id, value) => {
      if (collection === "record-routes") throw new Error("Interrupted");
      return put(collection, id, value);
    };
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("Interrupted");
    workspace.put = put;
    const project = await activateProjectMigration(workspace, source, "p");
    expect(await (await openProjectStorage(workspace)).get("projects", "p")).toEqual(project);
    expect(await activateProjectMigration(workspace, source, "p")).toEqual(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("finishes interrupted route activation before opening the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-activation-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const put = workspace.put.bind(workspace);
    workspace.put = async (collection, id, value) => {
      if (collection === "record-routes") throw new Error("Interrupted");
      return put(collection, id, value);
    };
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("Interrupted");
    workspace.put = put;
    const reopened = await openProjectStorage(workspace);
    expect((await reopened.get<{directory:string}>("projects", "p"))?.directory).toContain("destination");
    expect(await workspace.get("project-migrations", "p")).toMatchObject({ phase: "complete" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("recovers an incomplete migration before an already-open client writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "client-recovery-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const put = workspace.put.bind(workspace);
    workspace.put = async (collection, id, value) => {
      if (collection === "record-routes") throw new Error("Interrupted");
      return put(collection, id, value);
    };
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("Interrupted");
    workspace.put = put;
    await source.put("jobs", "new", { id: "new", projectId: "p" });
    expect(await new FileStorage(join(root, "destination")).get("jobs", "new")).toBeDefined();
    expect(await workspace.get("project-migrations", "p")).toMatchObject({ phase: "complete" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects destination corruption when resuming activation", async () => {
  const root = await mkdtemp(join(tmpdir(), "corrupt-activation-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    const operation = await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    await workspace.put("project-migrations", "p", { ...operation, phase: "committing", routes: [{ collection: "projects", id: "p" }] });
    await new FileStorage(operation.directory).delete("projects", "p");
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("changed");
    expect(await workspace.get("project-directories", "p")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([
  { routes: undefined, message: "routes are missing" },
  { routes: [], message: "routes are incomplete" },
  { routes: [{ collection: "projects", id: "p" }, { collection: "projects", id: "p" }], message: "Invalid migration route" },
])("rejects invalid saved routes before resuming: $message", async ({ routes, message }) => {
  const root = await mkdtemp(join(tmpdir(), "incomplete-routes-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    const operation = await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    await workspace.put("project-migrations", "p", { ...operation, phase: "committing", routes });
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow(message);
    expect(await workspace.get("project-directories", "p")).toBeUndefined();
    expect(await workspace.get("projects", "p")).toMatchObject({ id: "p" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("recovers an interrupted activation before an existing client reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "read-recovery-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const put = workspace.put.bind(workspace);
    workspace.put = async (collection, id, value) => {
      if (collection === "record-routes") throw new Error("Interrupted");
      return put(collection, id, value);
    };
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("Interrupted");
    workspace.put = put;
    expect((await source.get<{ directory: string }>("projects", "p"))?.directory).toContain("destination");
    expect(await workspace.get("project-migrations", "p")).toMatchObject({ phase: "complete" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("moves a legacy project through the shared service", async () => {
  const root = await mkdtemp(join(tmpdir(), "service-migration-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const api = new ImageService(await openProjectStorage(workspace));
    const moved = await api.moveProject("p", join(root, "destination"));
    expect(await api.projects()).toEqual([moved]);
    expect(moved.directory).toContain("destination");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("moves an already registered project to another folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "registered-migration-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const api = new ImageService(await openProjectStorage(workspace));
    const original = await api.createProject("Project");
    const moved = await api.moveProject(original.id, join(root, "destination"));
    expect(await api.projects()).toEqual([moved]);
    expect(moved.directory).not.toBe(original.directory);
    await api.store.put("jobs", "image", { id: "image", projectId: moved.id });
    expect(await new FileStorage(moved.directory!).get("jobs", "image")).toBeDefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("treats selecting the current folder through an alias as an unchanged project", async () => {
  const root = await mkdtemp(join(tmpdir(), "same-project-folder-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const { symlink } = await import("node:fs/promises");
    const workspace = new FileStorage(join(root, "workspace"));
    const api = new ImageService(await openProjectStorage(workspace));
    const project = await api.createProject("Project");
    const alias = join(root, "alias");
    await symlink(project.directory!, alias);
    expect(await api.moveProject(project.id, alias)).toEqual(project);
    expect(await workspace.list("project-migrations")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("returns current project metadata when a completed activation is retried", async () => {
  const root = await mkdtemp(join(tmpdir(), "completed-retry-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    const project = await activateProjectMigration(workspace, source, "p");
    const updated = { ...project, name: "Renamed" };
    await source.put("projects", "p", updated);
    expect(await activateProjectMigration(workspace, source, "p")).toEqual(updated);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not reassign a shared reference owned by another project during recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "foreign-route-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await workspace.put("jobs", "image", { id: "image", projectId: "p", referenceIds: ["shared"] });
    await workspace.put("references", "shared", { id: "shared", projectId: "other", blobKey: "shared" });
    await workspace.putBlob("shared", new Uint8Array([1]), "image/png");
    const source = await openProjectStorage(workspace);
    const operation = await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    await workspace.put("project-migrations", "p", { ...operation, phase: "committing", routes: [{ collection: "references", id: "shared" }] });
    await expect(activateProjectMigration(workspace, source, "p")).rejects.toThrow("another project");
    expect(await workspace.get("project-directories", "p")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps imported image bytes readable after moving a populated project", async () => {
  const root = await mkdtemp(join(tmpdir(), "image-project-move-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const sharp = (await import("sharp")).default;
    const workspace = new FileStorage(join(root, "workspace"));
    const api = new ImageService(await openProjectStorage(workspace));
    const project = await api.createProject("Images");
    const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: "blue" } }).png().toBuffer();
    const imported = await api.importImage("sample.png", "image/png", bytes, project.id);
    const { hash } = await import("../src/core/schema");
    const digest = await hash(bytes);
    const thumbnailKey = `thumbs/${digest}/160.webp`;
    const thumbnail = await sharp(bytes).resize(160).webp().toBuffer();
    await api.store.put("asset-meta", imported.job.id, { hash: digest });
    await api.store.putBlob(thumbnailKey, thumbnail, "image/webp");
    const moved = await api.moveProject(project.id, join(root, "destination"));
    const reopened = await openProjectStorage(workspace);
    const job = await reopened.get<{ blobKey: string }>("jobs", imported.job.id);
    expect(Buffer.from((await reopened.getBlob(job!.blobKey))!.bytes)).toEqual(bytes);
    expect(Buffer.from((await new FileStorage(moved.directory!).getBlob(job!.blobKey))!.bytes)).toEqual(bytes);
    expect(Buffer.from((await new FileStorage(moved.directory!).getBlob(thumbnailKey))!.bytes)).toEqual(thumbnail);
    expect(await new FileStorage(project.directory!).getBlob(thumbnailKey)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("removes verified old project records after activation", async () => {
  const root = await mkdtemp(join(tmpdir(), "cleanup-project-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const api = new ImageService(await openProjectStorage(workspace));
    const original = await api.createProject("Project");
    await api.store.put("jobs", "image", { id: "image", projectId: original.id });
    const moved = await api.moveProject(original.id, join(root, "destination"));
    const previous = new FileStorage(original.directory!);
    expect(await previous.get("projects", original.id)).toBeUndefined();
    expect(await previous.get("jobs", "image")).toBeUndefined();
    expect(await new FileStorage(moved.directory!).get("jobs", "image")).toBeDefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("cleans old image bytes after verifying the destination copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "cleanup-project-bytes-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const api = new ImageService(await openProjectStorage(workspace));
    const project = await api.createProject("Project");
    await api.store.putBlob("results/test", new Uint8Array([1, 2]), "image/png");
    await api.store.put("jobs", "image", { id: "image", projectId: project.id, blobKey: "results/test", referenceIds: [] });
    const moved = await api.moveProject(project.id, join(root, "destination"));
    expect(await new FileStorage(project.directory!).getBlob("results/test")).toBeUndefined();
    expect((await new FileStorage(moved.directory!).getBlob("results/test"))?.bytes).toEqual(new Uint8Array([1, 2]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("retains source files still used by another project", async () => {
  const root = await mkdtemp(join(tmpdir(), "retained-migration-file-"));
  try {
    const workspace = new FileStorage(join(root, "workspace"));
    await workspace.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await workspace.putBlob("shared", new Uint8Array([1]), "image/png");
    await workspace.put("jobs", "image", { id: "image", projectId: "p", referenceIds: [], blobKey: "shared" });
    await workspace.put("references", "other", { id: "other", projectId: "q", blobKey: "shared" });
    const source = await openProjectStorage(workspace);
    await prepareProjectMigration(workspace, source, "p", join(root, "destination"));
    await activateProjectMigration(workspace, source, "p");
    expect(await workspace.getBlob("shared")).toBeDefined();
    expect(await workspace.get("references", "other")).toBeDefined();
    expect(await workspace.get("jobs", "image")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("checks previous folder ownership before changing project routing", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-source-owner-"));
  try {
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const source = await openProjectStorage(workspace);
    const project = await new ImageService(source).createProject("Project");
    const originalRoute = await workspace.get("project-directories", project.id);
    const operation = await prepareProjectMigration(workspace, source, project.id, join(root, "destination"));
    await workspace.put("project-migrations", project.id, {
      ...operation,
      phase: "committing",
      routes: [{ collection: "projects", id: project.id }],
    });
    const previous = new FileStorage(project.directory!);
    await previous.put("settings", "project-owner", { projectId: "another-project" });

    await expect(activateProjectMigration(workspace, source, project.id))
      .rejects.toThrow("Previous project folder ownership changed");
    expect(await workspace.get("project-directories", project.id)).toEqual(originalRoute);
    expect(await previous.get("projects", project.id)).toEqual(project);

    await previous.put("settings", "project-owner", { projectId: project.id });
    const moved = await activateProjectMigration(workspace, source, project.id);
    expect(moved.directory).toBe(operation.directory);
    expect(await workspace.get("project-directories", project.id))
      .toMatchObject({ directory: operation.directory });
    expect(await new FileStorage(operation.directory).get("projects", project.id)).toEqual(moved);
    expect(await previous.get("projects", project.id)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
