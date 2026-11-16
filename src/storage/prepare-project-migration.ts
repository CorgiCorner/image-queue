import { UserFacingError } from "../core/user-facing-error";
import { existingProjectThumbnails } from "./project-thumbnails";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { hash, idSchema, type Project } from "../core/schema";
import { FileStorage } from "./fs";
import { verifyMigrationDestination } from "./verify-migration-destination";
import { verifyProjectMigration } from "./verify-project-migration";
import { recordProject } from "./project-record";
import { validateProjectDirectory, prepareProjectDirectory } from "./prepare-project-directory";
import type { Storage } from "./types";

/** Persist the verified copy manifest before changing any active routing. */
export async function prepareProjectMigration(workspace: FileStorage, source: Storage, projectId: string, directory: string) {
  idSchema.parse(projectId);
  return workspace.lock("project-directories", async () => {
    const pending = await workspace.get<{ phase?: string }>("project-migrations", projectId);
    if (pending?.phase === "committing") throw new UserFacingError("Finish the current project migration before starting another");
    const target = await validateProjectDirectory(workspace.root, directory);
    for (const registration of await workspace.list<{ id: string; directory: string }>("project-directories")) {
      const root = await realpath(registration.directory);
      if (target === root || target.startsWith(root + sep) || root.startsWith(target + sep))
        throw new UserFacingError("Choose a folder separate from existing project folders");
    }
    const prepared = await prepareProjectDirectory(workspace, directory, projectId, source);
    const destination = new FileStorage(prepared.directory);
    const records: { collection: string; id: string; value: unknown }[] = [];
    for (const collection of ["projects", "jobs", "references", "topics", "notes", "asset-meta", "stack-counters", "correction-intents", "prepared-corrections"]) {
      for (const entry of await destination.entries(collection)) {
        if (collection === "references" || await recordProject(source, collection, entry.id, entry.value) === projectId)
          records.push({ collection, ...entry });
      }
    }
    const project = await source.get<Project>("projects", projectId);
    if (!project) throw new UserFacingError("Project does not exist");
    const files: { key: string; hash: string; mime: string }[] = [];
    const keys = new Set(await existingProjectThumbnails(source, records.filter(record => record.collection === "asset-meta").map(record => record.value)));
    for (const collection of ["jobs", "references"]) {
      for (const { value } of await destination.entries<{ blobKey?: string; thumbnailKey?: string }>(collection)) {
        if (value.blobKey) keys.add(value.blobKey);
        if (value.thumbnailKey) keys.add(value.thumbnailKey);
      }
    }
    for (const key of keys) {
      const blob = await destination.getBlob(key);
      if (!blob) throw new UserFacingError("Migrated project file is missing");
      files.push({ key, hash: await hash(blob.bytes), mime: blob.mime });
    }
    const operation = { sourceDirectory: project.directory ?? await realpath(workspace.root), id: projectId, directory: prepared.directory, records, files, project, phase: "prepared" as const };
    await verifyProjectMigration(source, operation);
    await verifyMigrationDestination(destination, operation);
    await workspace.put("project-migrations", projectId, operation);
    return operation;
  });
}
