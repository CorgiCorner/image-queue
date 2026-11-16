import { UserFacingError } from "../core/user-facing-error";
import { projectThumbnailKeys } from "./project-thumbnails";
import { z } from "zod";
import { hash, idSchema } from "../core/schema";
import { FileStorage } from "./fs";
import { mutationLock } from "./mutation-lock";
import { recordProject } from "./project-record";
import { projectMigrationSchema, verifyProjectMigration } from "./verify-project-migration";
import { verifyMigrationDestination } from "./verify-migration-destination";
import type { Storage } from "./types";

export async function activateProjectMigration(workspace: FileStorage, source: Storage, projectId: string) {
  idSchema.parse(projectId);
  return mutationLock(workspace, workspace.root, () => workspace.lock("project-directories", async () => {
    const input = await workspace.get("project-migrations", projectId);
    const pendingSchema = projectMigrationSchema.extend({
      phase: z.enum(["prepared", "committing", "complete"]),
      routes: z.array(z.object({ collection: z.string(), id: z.string() })).optional(),
    });
    const pending = pendingSchema.parse(input);
    if (pending.id !== projectId) throw new UserFacingError("Migration identity does not match");
    if (pending.phase === "complete") {
      const current = await source.get<import("../core/schema").Project>("projects", projectId);
      if (!current) throw new UserFacingError("Project does not exist");
      return current;
    }
    const operation = { ...pending, phase: "prepared" as const };
    const destination = new FileStorage(operation.directory);
    let routes = pending.routes;
    if (pending.phase === "prepared") {
      await verifyProjectMigration(source, operation);
      await verifyMigrationDestination(destination, operation);
      routes = [];
      for (const record of operation.records) {
        if (await recordProject(source, record.collection, record.id, record.value) === projectId)
          routes.push({ collection: record.collection, id: record.id });
      }
      await workspace.put("project-migrations", projectId, { ...operation, phase: "committing", routes });
    }
    if (!routes) throw new UserFacingError("Migration routes are missing");
    const allowedRoutes = new Map(operation.records.map(record => [`${record.collection}/${record.id}`, record]));
    const ownedRoutes = new Set<string>();
    for (const [key, record] of allowedRoutes) {
      if (await recordProject(destination, record.collection, record.id, record.value) === projectId)
        ownedRoutes.add(key);
    }
    const seenRoutes = new Set<string>();
    for (const route of routes) {
      const key = `${route.collection}/${route.id}`;
      if (!allowedRoutes.has(key) || seenRoutes.has(key)) throw new UserFacingError("Invalid migration route");
      if (!ownedRoutes.has(key)) throw new UserFacingError("Migration route belongs to another project");
      seenRoutes.add(key);
    }
    if (seenRoutes.size !== ownedRoutes.size) throw new UserFacingError("Migration routes are incomplete");
    if (pending.phase === "committing") {
      const currentProject = await destination.get("projects", projectId);
      const expectedProject = { ...operation.project, directory: operation.directory };
      const verification = JSON.stringify(currentProject) === JSON.stringify(expectedProject)
        ? { ...operation, project: expectedProject, records: operation.records.map(record => record.collection === "projects" && record.id === projectId ? { ...record, value: expectedProject } : record) }
        : operation;
      await verifyMigrationDestination(destination, verification);
    }
    const previous = operation.sourceDirectory && operation.sourceDirectory !== operation.directory
      ? new FileStorage(operation.sourceDirectory)
      : undefined;
    if (previous) {
      const { realpath } = await import("node:fs/promises");
      if (await realpath(previous.root) !== await realpath(workspace.root)) {
        const owner = await previous.get<{ projectId: string }>("settings", "project-owner");
        if (owner?.projectId !== projectId) throw new UserFacingError("Previous project folder ownership changed");
      }
    }
    await workspace.put("project-directories", projectId, { id: projectId, directory: operation.directory });
    for (const record of routes) {
      await workspace.put("record-routes", await hash(`${record.collection}/${record.id}`), { projectId });
    }
    const project = { ...operation.project, directory: operation.directory };
    await destination.put("projects", projectId, project);
    if (previous) {
      for (const record of routes) {
        const expected = allowedRoutes.get(`${record.collection}/${record.id}`)!;
        const current = await previous.get(record.collection, record.id);
        if (current !== undefined && JSON.stringify(current) !== JSON.stringify(expected.value))
          throw new UserFacingError("Previous project records changed before cleanup");
        await previous.delete(record.collection, record.id);
      }
      const retained = projectThumbnailKeys(await previous.list("asset-meta"));
      for (const collection of ["jobs", "references"]) {
        for (const record of await previous.list<{ blobKey?: string; thumbnailKey?: string }>(collection)) {
          if (record.blobKey) retained.add(record.blobKey);
          if (record.thumbnailKey) retained.add(record.thumbnailKey);
        }
      }
      for (const file of operation.files) {
        if (retained.has(file.key)) continue;
        const original = await previous.getBlob(file.key);
        if (!original) continue;
        const copied = await destination.getBlob(file.key);
        if (!copied || copied.mime !== file.mime || await hash(copied.bytes) !== file.hash)
          throw new UserFacingError("Destination file changed before cleanup");
        if (original.mime !== file.mime || await hash(original.bytes) !== file.hash)
          throw new UserFacingError("Previous project file changed before cleanup");
        await previous.deleteBlob(file.key);
      }
    }
    await workspace.put("project-migrations", projectId, { ...operation, phase: "complete" });
    return project;
  }));
}
