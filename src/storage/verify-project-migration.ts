import { UserFacingError } from "../core/user-facing-error";
import { z } from "zod";
import { hash, idSchema, projectSchema } from "../core/schema";
import { recordProject } from "./project-record";
import { safeKey, type Storage } from "./types";

const collections = ["projects", "jobs", "references", "topics", "notes", "asset-meta", "stack-counters", "correction-intents", "prepared-corrections"] as const;
export const projectMigrationSchema = z.object({
  id: idSchema,
  directory: projectSchema.shape.directory.unwrap(),
  sourceDirectory: projectSchema.shape.directory.optional(),
  phase: z.literal("prepared"),
  project: projectSchema,
  files: z.array(z.object({ key: z.string(), hash: z.string(), mime: z.string() })),
  records: z.array(z.object({ collection: z.enum(collections), id: z.string(), value: z.unknown() })),
});

export async function verifyProjectMigration(source: Storage, input: unknown) {
  const operation = projectMigrationSchema.parse(input);
  if (operation.project.id !== operation.id) throw new UserFacingError("Migration project identity does not match");
  const requiredReferences = new Set<string>();
  const references = new Map<string, { projectId?: string; parentId?: string }>();
  for (const record of operation.records) {
    const value = record.value as { projectId?: string; parentId?: string; referenceIds?: string[]; request?: { referenceIds?: string[] } } | null;
    if (record.collection === "references") {
      references.set(record.id, value ?? {});
      if (value?.projectId === operation.id) requiredReferences.add(record.id);
    } else {
      for (const id of value?.referenceIds ?? value?.request?.referenceIds ?? []) requiredReferences.add(id);
    }
  }
  for (const id of requiredReferences) {
    const reference = references.get(id);
    if (!reference) throw new UserFacingError("Migration reference manifest is incomplete");
    if (reference.parentId) requiredReferences.add(reference.parentId);
  }
  for (const id of references.keys()) {
    if (!requiredReferences.has(id)) throw new UserFacingError("Migration contains an unrelated reference");
  }
  const expected = new Map<string, unknown>();
  for (const record of operation.records) {
    safeKey(record.id);
    const key = `${record.collection}/${record.id}`;
    if (expected.has(key)) throw new UserFacingError("Duplicate migration record");
    if (record.collection !== "references" && await recordProject(source, record.collection, record.id, record.value) !== operation.id)
      throw new UserFacingError("Migration record belongs to another project");
    expected.set(key, record.value);
    if (JSON.stringify(await source.get(record.collection, record.id)) !== JSON.stringify(record.value))
      throw new UserFacingError("Project changed since migration preparation");
  }
  const manifestProject = projectSchema.safeParse(expected.get(`projects/${operation.id}`));
  if (!manifestProject.success || JSON.stringify(manifestProject.data) !== JSON.stringify(operation.project))
    throw new UserFacingError("Migration project record is missing or inconsistent");
  for (const collection of collections) {
    for (const entry of await source.entries(collection)) {
      if (await recordProject(source, collection, entry.id, entry.value) === operation.id && !expected.has(`${collection}/${entry.id}`))
        throw new UserFacingError("Project changed since migration preparation");
    }
  }
  const fileKeys = new Set<string>();
  for (const file of operation.files) {
    if (fileKeys.has(file.key)) throw new UserFacingError("Duplicate migration file");
    fileKeys.add(file.key);
    safeKey(file.key);
    const blob = await source.getBlob(file.key);
    if (!blob || blob.mime !== file.mime || await hash(blob.bytes) !== file.hash)
      throw new UserFacingError("Project file changed since migration preparation");
  }
  for (const record of operation.records) {
    if (record.collection !== "jobs" && record.collection !== "references") continue;
    const value = record.value as { blobKey?: string; thumbnailKey?: string } | null;
    for (const key of [value?.blobKey, value?.thumbnailKey]) {
      if (key && !fileKeys.has(key)) throw new UserFacingError("Migration file manifest is incomplete");
    }
  }
  return operation;
}
