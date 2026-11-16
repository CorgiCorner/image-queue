import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import { idSchema, type Job } from "./schema";
import { createCorrection, type ImageNote } from "./notes";
import { readKey } from "./settings";
import type { ImageService } from "./service";
import { annotatedImage } from "../sources/annotated-image";

const inputSchema = z.object({
  imageId: idSchema,
  idempotencyKey: idSchema.max(96),
  instruction: z.string().trim().max(12000).default(""),
});

export async function prepareCorrection(api: ImageService, input: z.input<typeof inputSchema>) {
  const value = inputSchema.parse(input);
  return api.store.lock(`prepare-${value.idempotencyKey}`, async () => {
    const saved = await api.store.get<{ imageId: string; instruction: string; referenceIds: string[]; noteIds: string[]; notes?: ImageNote[] }>("prepared-corrections", value.idempotencyKey);
    if (saved) {
      if (saved.imageId !== value.imageId || saved.instruction !== value.instruction)
        throw new UserFacingError("Correction key belongs to a different request");
      if (saved.referenceIds.length === 2) {
        const existing = await api.store.get("jobs", `IMG-${value.idempotencyKey}`);
        if (!existing && saved.notes) {
          for (const note of saved.notes) {
            const current = await api.store.get<ImageNote>("notes", note.id);
            if (!current || current.text !== note.text || current.x !== note.x || current.y !== note.y || current.w !== note.w || current.h !== note.h)
              throw new UserFacingError("Prepared notes changed. Start a new correction");
          }
        }
        return createCorrection(api, { ...value, referenceIds: saved.referenceIds, noteIds: saved.noteIds, noteSnapshot: saved.notes });
      }
    }
    const job = await api.store.get<Job>("jobs", value.imageId);
    if (!job || job.trashedAt || job.archivedAt || job.status !== "done")
      throw new UserFacingError("A ready, active image is required");
    if (job.source === "api" && !job.imported) {
      if (!job.model) throw new UserFacingError("Choose an available image model");
      await readKey(api.store, job.provider);
    }
    const notes = saved?.notes ?? (await api.store.list<ImageNote>("notes")).filter(note => note.imageId === job.id && !note.sentInJobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (!notes.length && !value.instruction) throw new UserFacingError("Add an unsent note first");
    let blob = job.blobKey ? await api.store.getBlob(job.blobKey) : undefined;
    if (!blob && job.source === "queue") {
      const { queueOutput, configuredQueueRoot } = await import("../sources/queue");
      blob = { bytes: await queueOutput(await configuredQueueRoot(), job), mime: "image/png" };
    }
    if (!blob) throw new UserFacingError("Original image is unavailable");
    const annotated = await annotatedImage(blob.bytes, notes);
    const referenceIds = [...(saved?.referenceIds ?? [])];
    const noteIds = notes.map(note => note.id);
    const saveProgress = () => api.store.put("prepared-corrections", value.idempotencyKey, {
      id: value.idempotencyKey, imageId: value.imageId, instruction: value.instruction, referenceIds, noteIds, notes,
    });
    if (!saved?.notes) await saveProgress();
    if (!referenceIds[0]) {
      const original = await api.addReference(job.projectId, "original", blob.mime, blob.bytes, undefined, undefined, `correction-${value.idempotencyKey}-original`);
      referenceIds.push(original.id);
      await saveProgress();
    }
    if (!referenceIds[1]) {
      const reference = await api.addReference(job.projectId, "notes.png", annotated.mime, annotated.bytes, undefined, undefined, `correction-${value.idempotencyKey}-notes`);
      referenceIds.push(reference.id);
      await saveProgress();
    }
    return createCorrection(api, { ...value, referenceIds, noteIds, noteSnapshot: notes });
  });
}
