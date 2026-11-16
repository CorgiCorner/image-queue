import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import type { Storage } from "../storage/types";
import type { Job } from "./schema";
export const MAX_TAG_LENGTH = 60;
export const tagSchema = z.string().trim().toLowerCase().min(1).max(MAX_TAG_LENGTH);
export type ImageTag = {
  tag: string;
  source: "user" | "agent" | "auto";
  createdAt: string;
  acceptedAt?: string;
};
export async function tagImage(
  store: Storage,
  id: string,
  tags: string[],
  source: ImageTag["source"],
) {
  const parsed = z.array(tagSchema).max(50).parse(tags);
  return store.lock(id, async () => {
    const job = await store.get<Job>("jobs", id);
    if (!job) throw new UserFacingError("Image does not exist");
    const existing = job.tags ?? [];
    const merged = [...existing];
    for (const tag of parsed) {
      const index = merged.findIndex((item) => item.tag === tag);
      if (index >= 0 && merged[index].source === "user") continue;
      const value = { tag, source, createdAt: new Date().toISOString() };
      if (index < 0) merged.push(value);
      else merged[index] = value;
    }
    if (merged.length > 50 && merged.length > existing.length)
      throw new UserFacingError("An image can have at most 50 tags");
    const updated = {
      ...job,
      tags: merged,
      updatedAt: new Date().toISOString(),
    };
    await store.put("jobs", id, updated);
    return updated;
  });
}
/** Remove a tag from one image; library-wide editing is a separate operation. */
export async function removeImageTag(store: Storage, id: string, tag: string) {
  const normalized = tagSchema.parse(tag);
  return store.lock(id, async () => {
    const job = await store.get<Job>("jobs", id);
    if (!job) throw new UserFacingError("Image does not exist");
    const updated = { ...job, tags: (job.tags ?? []).filter(item => item.tag !== normalized), updatedAt: new Date().toISOString() };
    await store.put("jobs", id, updated);
    return updated;
  });
}

export async function editTag(store: Storage, from: string, to?: string) {
  const source = tagSchema.parse(from);
  const target = to === undefined ? undefined : tagSchema.parse(to);
  if (source === target) return;
  for (const job of await store.list<Job>("jobs")) {
    if (!job.tags?.some((item) => item.tag === source)) continue;
    await store.lock(job.id, async () => {
      const current = await store.get<Job>("jobs", job.id);
      if (!current) return;
      const tags = (current.tags ?? []).filter((item) => item.tag !== source);
      const existingTarget = target
        ? tags.find((item) => item.tag === target)
        : undefined;
      if (existingTarget) {
        existingTarget.source = "user";
        existingTarget.acceptedAt = new Date().toISOString();
      }
      if (target && !existingTarget)
        tags.push({
          tag: target,
          source: "user",
          createdAt: new Date().toISOString(),
        });
      await store.put("jobs", job.id, {
        ...current,
        tags,
        updatedAt: new Date().toISOString(),
      });
    });
  }
}

export async function acceptTag(store: Storage, id: string, tag: string) {
  const normalized = tagSchema.parse(tag);
  return store.lock(id, async () => {
    const job = await store.get<Job>("jobs", id);
    if (!job) throw new UserFacingError("Image does not exist");
    if (!job.tags?.some(item => item.tag === normalized))
      throw new UserFacingError("Tag does not exist on this image");
    const tags = job.tags.map((item) =>
      item.tag === normalized
        ? {
            ...item,
            source: "user" as const,
            acceptedAt: new Date().toISOString(),
          }
        : item,
    );
    await store.put("jobs", id, {
      ...job,
      tags,
      updatedAt: new Date().toISOString(),
    });
  });
}

export function tagCounts(jobs: Pick<Job, "tags">[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    for (const tag of new Set((job.tags ?? []).map((item) => item.tag))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Generation takes priority over an idle worker's tagging batch. */
export function untaggedImages(jobs: Job[], limit = 20, afterId?: string) {
  const visible = jobs.filter(job => !job.archivedAt && !job.trashedAt);
  if (visible.some(job => job.status === "queued" || job.status === "running"))
    return [];
  return visible
    .filter(job => job.status === "done" && !job.tags?.length && (!afterId || job.id.localeCompare(afterId) > 0))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(job => ({
      id: job.id,
      projectId: job.projectId,
      prompt: job.prompt,
      thumbnailUrl: `/api/asset?job=${encodeURIComponent(job.id)}&thumb=640`,
    }));
}
