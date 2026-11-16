import { UserFacingError } from "../core/user-facing-error";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { idSchema, projectSchema } from "../core/schema";
import { FileStorage } from "./fs";
import { mutationLock } from "./mutation-lock";
import { ProjectStorage } from "./project-storage";
import { StorageLockBusy } from "./types";
import { setTimeout as delay } from "node:timers/promises";

const registrationSchema = z.object({
  id: idSchema,
  directory: projectSchema.shape.directory.unwrap(),
});

async function registeredProjects(workspace: FileStorage) {
  const [registrations, workspaceRoot] = await Promise.all([
    workspace.entries<unknown>("project-directories"),
    realpath(workspace.root),
  ]);
  const resolved = await Promise.all(registrations.map(async registration => {
    const { id, directory } = registrationSchema.parse(registration.value);
    if (registration.id !== id) throw new UserFacingError("Project registration identity does not match its key");
    return { id, root: await realpath(directory) };
  }));
  const projects = new Map<string, FileStorage>();
  const roots = new Set<string>();
  for (const { id, root } of resolved) {
    if (root === workspaceRoot || root.startsWith(workspaceRoot + path.sep) || workspaceRoot.startsWith(root + path.sep))
      throw new UserFacingError("Project folder cannot contain or overlap the workspace store");
    for (const existing of roots) {
      if (root.startsWith(existing + path.sep) || existing.startsWith(root + path.sep))
        throw new UserFacingError("Project folders cannot overlap");
    }
    if (roots.has(root) || projects.has(id)) throw new UserFacingError("Duplicate project directory registration");
    projects.set(id, new FileStorage(root));
    roots.add(root);
  }
  await Promise.all([...projects].map(async ([id, store]) => {
    if (!(await stat(store.root)).isDirectory()) throw new UserFacingError("Project storage is not a directory");
    const owner = await store.get<{ projectId: string }>("settings", "project-owner");
    if (owner?.projectId !== id) throw new UserFacingError("Project folder ownership does not match registration");
  }));
  return projects;
}

async function recoverMigrations(workspace: FileStorage) {
  const pending = await workspace.entries<{ phase?: string }>("project-migrations");
  for (const entry of pending) {
    if (entry.value.phase === "committing") {
      const { activateProjectMigration } = await import("./activate-project-migration");
      await activateProjectMigration(workspace, workspace, entry.id);
    }
  }
}

export async function openProjectStorage(workspace: FileStorage) {
  await recoverMigrations(workspace);
  const projects = await registeredProjects(workspace);
  let refreshing: Promise<void> | undefined;
  const refresh = () => refreshing ??= refreshNow().finally(() => { refreshing = undefined; });
  const refreshNow = async () => {
    await recoverMigrations(workspace);
    const current = await registeredProjects(workspace);
    for (const id of projects.keys()) if (!current.has(id)) projects.delete(id);
    for (const [id, store] of current) {
      if (projects.get(id)?.root !== store.root) projects.set(id, store);
    }
  };
  const storage = new ProjectStorage(workspace, projects, project => mutationLock(workspace, workspace.root, async () => {
    const { createProjectFolder } = await import("./create-project-folder");
    const saved = await createProjectFolder(workspace, project);
    await refresh();
    return saved;
  }), refresh, work => mutationLock(workspace, workspace.root, async () => {
    await recoverMigrations(workspace);
    return work();
  }), (id, directory) => mutationLock(workspace, workspace.root, async () => {
    await refresh();
    // Folder creation and activation share the mutation lock with this snapshot.
    const source = new ProjectStorage(workspace, new Map(projects));
    const currentProject = await source.get<import("../core/schema").Project>("projects", id);
    if (currentProject?.directory) {
      const requested = await realpath(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (requested === await realpath(currentProject.directory)) return currentProject;
    }
    const { prepareProjectMigration } = await import("./prepare-project-migration");
    const { activateProjectMigration } = await import("./activate-project-migration");
    await prepareProjectMigration(workspace, source, id, directory);
    const project = await activateProjectMigration(workspace, source, id);
    await refresh();
    return project;
  }));
  // Readers can arrive between a writer's journal and its commit. Wait for that
  // short transaction; do not replay it concurrently or turn lock contention into 404.
  const recoverUntil = Date.now() + 2000;
  for (;;) {
    try { await storage.recover(); break; }
    catch (error) {
      if (!(error instanceof StorageLockBusy) ||
          (error.key !== "project-mutations" && !error.key.startsWith("record-write-")) ||
          Date.now() >= recoverUntil) throw error;
      await delay(10);
    }
  }
  return storage;
}
