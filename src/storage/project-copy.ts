import { UserFacingError } from "../core/user-facing-error";
import { existingProjectThumbnails } from "./project-thumbnails";
import type { Storage } from "./types";
import { hash, idSchema, type Job, type Project, type Reference } from "../core/schema";

/** Copy first and verify before the caller switches the project's storage. */
export async function copyProject(source: Storage, destination: Storage, projectId: string) {
  idSchema.parse(projectId);
  const project = await source.get<Project>("projects", projectId);
  if (!project) throw new UserFacingError("Project does not exist");
  const jobs = (await source.list<Job>("jobs")).filter(job => job.projectId === projectId);
  const allReferences = await source.list<Reference>("references");
  const referencesById = new Map(allReferences.map(reference => [reference.id, reference]));
  const requiredReferences = new Set(jobs.flatMap(job => job.referenceIds ?? []));
  for (const reference of allReferences) if (reference.projectId === projectId) requiredReferences.add(reference.id);
  const imageIds = new Set(jobs.map(job => job.id));
  for (const collection of ["prepared-corrections", "correction-intents"]) {
    for (const { value } of await source.entries<{ imageId?: string; referenceIds?: string[]; request?: { referenceIds?: string[] } }>(collection)) {
      if (value.imageId && imageIds.has(value.imageId)) {
        for (const id of value.referenceIds ?? value.request?.referenceIds ?? []) requiredReferences.add(id);
      }
    }
  }
  for (const id of requiredReferences) {
    const reference = referencesById.get(id);
    if (!reference) throw new UserFacingError("Project reference is missing");
    if (reference.parentId) requiredReferences.add(reference.parentId);
  }
  const references = allReferences.filter(reference => requiredReferences.has(reference.id));
  if (jobs.some(job => job.status === "done" && !job.blobKey))
    throw new UserFacingError("Import external image files before copying the project");
  const jobIds = new Set(jobs.map(job => job.id));
  const records: { collection: string; id: string; value: unknown }[] = [
    { collection: "projects", id: project.id, value: project },
    ...jobs.map(job => ({ collection: "jobs", id: job.id, value: job })),
    ...references.map(reference => ({ collection: "references", id: reference.id, value: reference })),
  ];
  const relatedMembership = new Map<string, string[]>();
  for (const collection of ["topics", "notes"] as const) {
    const values = await source.entries<{ projectId?: string; imageId?: string }>(collection);
    relatedMembership.set(collection, values.filter(({ value }) => value.projectId === projectId || (value.imageId && jobIds.has(value.imageId))).map(entry => entry.id).sort());
    for (const { id, value } of values) {
      if (value.projectId === projectId || (value.imageId && jobIds.has(value.imageId)))
        records.push({ collection, id, value });
    }
  }
  for (const job of jobs) {
    for (const collection of ["asset-meta", "correction-intents", "prepared-corrections"] as const) {
      const id = collection === "asset-meta" ? job.id : job.idempotencyKey;
      if (!id) continue;
      const value = await source.get(collection, id);
      if (value !== undefined) records.push({ collection, id, value });
    }
  }
  for (const collection of ["correction-intents", "prepared-corrections"] as const) {
    const pending = await source.entries<{ imageId: string }>(collection);
    relatedMembership.set(collection, pending.filter(entry => jobIds.has(entry.value.imageId)).map(entry => entry.id).sort());
    for (const { id, value } of pending) {
      if (id && jobIds.has(value.imageId) && !records.some(record => record.collection === collection && record.id === id))
        records.push({ collection, id, value });
    }
  }
  for (const stackId of new Set(jobs.flatMap(job => job.stackId ? [job.stackId] : []))) {
    const value = await source.get("stack-counters", stackId);
    if (value !== undefined) records.push({ collection: "stack-counters", id: stackId, value });
  }
  const blobKeys = new Set([
    ...jobs.flatMap(job => [job.blobKey, job.thumbnailKey].filter((key): key is string => !!key)),
    ...references.map(reference => reference.blobKey),
    ...await existingProjectThumbnails(source, records.filter(record => record.collection === "asset-meta").map(record => record.value)),
  ]);
  for (const record of records) {
    const existing = await destination.get(record.collection, record.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record.value))
      throw new UserFacingError("Destination contains conflicting project records");
  }
  const verifiedCopies = new Set<string>();
  for (const key of blobKeys) {
    const original = await source.getBlob(key);
    if (!original) throw new UserFacingError("Project file is missing");
    const existing = await destination.getBlob(key);
    if (existing) {
      if (existing.mime !== original.mime || await hash(existing.bytes) !== await hash(original.bytes))
        throw new UserFacingError("Destination contains conflicting project files");
      verifiedCopies.add(key);
    }
  }
  for (const key of blobKeys) {
    if (verifiedCopies.has(key)) continue;
    const blob = await source.getBlob(key);
    if (!blob) throw new UserFacingError("Project file is missing");
    await destination.putBlob(key, blob.bytes, blob.mime);
    const copied = await destination.getBlob(key);
    if (!copied || copied.mime !== blob.mime || await hash(copied.bytes) !== await hash(blob.bytes))
      throw new UserFacingError("Project file verification failed");
  }
  for (const record of records) {
    await destination.put(record.collection, record.id, record.value);
    const copied = await destination.get(record.collection, record.id);
    if (JSON.stringify(copied) !== JSON.stringify(record.value)) throw new UserFacingError("Project record verification failed");
  }
  const currentJobs = (await source.list<Job>("jobs")).filter(job => job.projectId === projectId);
  const currentReferences = (await source.list<Reference>("references")).filter(reference => reference.projectId === projectId || requiredReferences.has(reference.id));
  const identifiers = (values: { id: string }[]) => JSON.stringify(values.map(value => value.id).sort());
  if (identifiers(currentJobs) !== identifiers(jobs) || identifiers(currentReferences) !== identifiers(references))
    throw new UserFacingError("Project changed during copy. Retry before switching folders");
  for (const [collection, originalIds] of relatedMembership) {
    const values = await source.entries<{ projectId?: string; imageId?: string }>(collection);
    const currentIds = values.filter(({ value }) => value.projectId === projectId || (value.imageId && jobIds.has(value.imageId))).map(entry => entry.id).sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(originalIds))
      throw new UserFacingError("Project changed during copy. Retry before switching folders");
  }
  for (const record of records) {
    const current = await source.get(record.collection, record.id);
    if (JSON.stringify(current) !== JSON.stringify(record.value))
      throw new UserFacingError("Project changed during copy. Retry before switching folders");
  }
  for (const key of blobKeys) {
    const [current, copied] = await Promise.all([source.getBlob(key), destination.getBlob(key)]);
    if (!current || !copied || current.mime !== copied.mime || await hash(current.bytes) !== await hash(copied.bytes))
      throw new UserFacingError("Project file changed during copy. Retry before switching folders");
  }
  return { records: records.length, files: blobKeys.size };
}
