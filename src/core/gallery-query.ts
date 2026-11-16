import { z } from "zod";
import { idSchema, type Job } from "./schema";

export const galleryQuerySchema = z.object({
  projectId: idSchema.optional(),
  topicId: idSchema.optional(),
  tag: z.string().trim().toLowerCase().min(1).max(60).optional(),
  query: z.string().trim().max(500).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(40),
});

export function queryGallery(jobs: Job[], input: z.input<typeof galleryQuerySchema>) {
  const filter = galleryQuerySchema.parse(input);
  const phrase = filter.query?.toLocaleLowerCase();
  const matches = jobs.filter(job => !job.archivedAt && !job.trashedAt &&
    (!filter.projectId || job.projectId === filter.projectId) &&
    (!filter.topicId || job.topicId === filter.topicId) &&
    (!filter.tag || job.tags?.some(tag => tag.tag === filter.tag)) &&
    (!phrase || `${job.prompt} ${job.originalName ?? ""}`.toLocaleLowerCase().includes(phrase)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const items = matches.slice(filter.offset, filter.offset + filter.limit).map(job => ({
    id: job.id,
    title: (job.originalName || job.prompt).slice(0, 160),
    projectId: job.projectId,
    topicId: job.topicId,
    status: job.status,
    width: job.width,
    height: job.height,
    createdAt: job.createdAt,
    thumbnailUri: job.status === "done" ? `image-queue://thumbnail/${encodeURIComponent(job.id)}` : undefined,
  }));
  return { items, total: matches.length, nextOffset: filter.offset + items.length < matches.length ? filter.offset + items.length : null };
}
