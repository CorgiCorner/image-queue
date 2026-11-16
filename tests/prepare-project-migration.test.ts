import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileStorage } from "../src/storage/fs";
import { prepareProjectMigration } from "../src/storage/prepare-project-migration";

it("persists a verified migration manifest without switching active routing", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-migration-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: [] });
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    expect(operation.records.map(record => record.collection).sort()).toEqual(["jobs", "projects"]);
    expect(await source.get("project-migrations", "p")).toEqual(operation);
    expect(await source.get("project-directories", "p")).toBeUndefined();
    expect(await source.get("jobs", "image")).toBeDefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("detects new records added after migration preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "changed-migration-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await expect(verifyProjectMigration(source, operation)).resolves.toEqual(operation);
    await source.put("jobs", "new", { id: "new", projectId: "p" });
    await expect(verifyProjectMigration(source, operation)).rejects.toThrow("changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects changed and deleted records after preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "stale-migration-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await source.put("projects", "p", { id: "p", name: "Renamed", createdAt: "2026-11-14" });
    await expect(verifyProjectMigration(source, operation)).rejects.toThrow("changed");
    await source.delete("projects", "p");
    await expect(verifyProjectMigration(source, operation)).rejects.toThrow("changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("detects changed binary files after preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "changed-migration-file-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await source.put("references", "ref", { id: "ref", projectId: "p", blobKey: "reference" });
    await source.putBlob("reference", new Uint8Array([1]), "image/png");
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    expect(operation.files).toHaveLength(1);
    await source.putBlob("reference", new Uint8Array([2]), "image/png");
    await expect(verifyProjectMigration(source, operation)).rejects.toThrow("file changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("detects destination corruption and ownership changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "destination-migration-"));
  try {
    const { verifyMigrationDestination } = await import("../src/storage/verify-migration-destination");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await source.put("references", "ref", { id: "ref", projectId: "p", blobKey: "reference" });
    await source.putBlob("reference", new Uint8Array([1]), "image/png");
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    const destination = new FileStorage(operation.directory);
    await expect(verifyMigrationDestination(destination, operation)).resolves.toEqual(operation);
    await destination.putBlob("reference", new Uint8Array([2]), "image/png");
    await expect(verifyMigrationDestination(destination, operation)).rejects.toThrow("file changed");
    await destination.put("settings", "project-owner", { projectId: "other" });
    await expect(verifyMigrationDestination(destination, operation)).rejects.toThrow("ownership changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects an incomplete or inconsistent project manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "invalid-migration-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await expect(verifyProjectMigration(source, { ...operation, records: [] })).rejects.toThrow("project record");
    await expect(verifyProjectMigration(source, { ...operation, project: { ...operation.project, name: "Other" } })).rejects.toThrow("project record");
    await expect(verifyProjectMigration(source, { ...operation, records: [...operation.records, ...operation.records] })).rejects.toThrow("Duplicate migration record");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects a manifest that omits a referenced file", async () => {
  const root = await mkdtemp(join(tmpdir(), "omitted-migration-file-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await source.put("references", "ref", { id: "ref", projectId: "p", blobKey: "reference" });
    await source.putBlob("reference", new Uint8Array([1]), "image/png");
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await expect(verifyProjectMigration(source, { ...operation, files: [] })).rejects.toThrow("incomplete");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("retains shared reference metadata in the verified manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-migration-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    await source.put("jobs", "image", { id: "image", projectId: "p", referenceIds: ["shared"] });
    await source.put("references", "shared", { id: "shared", projectId: "other", blobKey: "shared" });
    await source.putBlob("shared", new Uint8Array([1]), "image/png");
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    expect(operation.records.find(record => record.id === "shared")?.value).toEqual({ id: "shared", projectId: "other", blobKey: "shared" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects unrelated project records inserted into a manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "foreign-migration-record-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const foreign = { id: "foreign", projectId: "other", referenceIds: [] };
    await source.put("jobs", "foreign", foreign);
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await expect(verifyProjectMigration(source, { ...operation, records: [...operation.records, { collection: "jobs", id: "foreign", value: foreign }] })).rejects.toThrow("another project");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects unrelated shared references added to the manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "unrelated-reference-"));
  try {
    const { verifyProjectMigration } = await import("../src/storage/verify-project-migration");
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const reference = { id: "foreign", projectId: "other", blobKey: "foreign" };
    await source.put("references", "foreign", reference);
    const operation = await prepareProjectMigration(source, source, "p", join(root, "destination"));
    await expect(verifyProjectMigration(source, { ...operation, records: [...operation.records, { collection: "references", id: "foreign", value: reference }] })).rejects.toThrow("unrelated reference");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects another project's folder before copying records", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlap-migration-"));
  try {
    const { openProjectStorage } = await import("../src/storage/open-project-storage");
    const { ImageService } = await import("../src/core/service");
    const workspace = new FileStorage(join(root, "workspace"));
    const source = await openProjectStorage(workspace);
    const api = new ImageService(source);
    const first = await api.createProject("First");
    const second = await api.createProject("Second");
    await expect(prepareProjectMigration(workspace, source, first.id, join(second.directory!, "nested"))).rejects.toThrow("separate");
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(second.directory!, "nested"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves a committing migration when another preparation is requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "pending-migration-"));
  try {
    const source = new FileStorage(join(root, "workspace"));
    await source.put("projects", "p", { id: "p", name: "Project", createdAt: "2026-11-14" });
    const pending = { id: "p", phase: "committing", directory: join(root, "first") };
    await source.put("project-migrations", "p", pending);
    await expect(prepareProjectMigration(source, source, "p", join(root, "second"))).rejects.toThrow("Finish the current");
    expect(await source.get("project-migrations", "p")).toEqual(pending);
  } finally { await rm(root, { recursive: true, force: true }); }
});
