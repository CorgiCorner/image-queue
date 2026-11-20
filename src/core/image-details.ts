import { UserFacingError } from "./user-facing-error";
import { idSchema, type Job } from "./schema";
import type { ImageNote } from "./notes";
import { orderedVersions } from "./version-order";
import { nextVersionMode } from "./image-format";
import type { Storage } from "../storage/types";

/** Compact read model shared by conversational image views. */
export async function imageDetails(store: Storage, imageId: string) {
  idSchema.parse(imageId);
  const image = await store.get<Job>("jobs", imageId);
  if (!image || image.trashedAt) throw new UserFacingError("Image is unavailable");
  const [jobs, notes] = await Promise.all([
    store.list<Job>("jobs"),
    store.list<ImageNote>("notes"),
  ]);
  const versions = orderedVersions(jobs.filter(job =>
    !job.trashedAt && (image.stackId ? job.stackId === image.stackId : job.id === image.id)));
  return {
    image: {
      id: image.id, prompt: image.prompt, status: image.status, archivedAt: image.archivedAt,
      width: image.width, height: image.height, projectId: image.projectId, topicId: image.topicId,
      aspectRatio: image.aspectRatio,
      source: image.source, provider: image.provider, model: image.model, outputFormat: image.outputFormat,
      nextVersion: nextVersionMode(image),
      resolution: image.resolution,
      requestedSize: image.exactDimensions === false ? undefined : image.requestedSize,
      providerSizeParameters: image.providerSizeParameters,
      providerResultSize: image.providerResultSize,
      generatedSize: image.generatedSize,
    },
    notes: notes.filter(note => note.imageId === image.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(note => ({
      id: note.id, text: note.text, x: note.x, y: note.y, w: note.w, h: note.h, sentInJobId: note.sentInJobId,
    })),
    versions: versions.map(job => ({ id: job.id, versionNumber: job.versionNumber, status: job.status, isMain: job.isMain })),
  };
}
