import type { Storage } from "./types";
import type { Job } from "../core/schema";

/** Resolve ownership without using caller-supplied filesystem paths. */
export async function recordProject(store: Storage, collection: string, id: string, value: unknown): Promise<string | undefined> {
  if (collection === "projects") return id;
  if (!value || typeof value !== "object") return undefined;
  const record = value as { projectId?: unknown; imageId?: unknown };
  if (["jobs", "references", "topics"].includes(collection) && typeof record.projectId === "string")
    return record.projectId;
  if (["notes", "correction-intents", "prepared-corrections"].includes(collection) && typeof record.imageId === "string")
    return (await store.get<Job>("jobs", record.imageId))?.projectId;
  if (collection === "asset-meta") return (await store.get<Job>("jobs", id))?.projectId;
  if (collection === "stack-counters") {
    const projects = new Set((await store.list<Job>("jobs")).filter(job => job.stackId === id).map(job => job.projectId));
    if (projects.size === 1) return [...projects][0];
  }
  return undefined;
}
