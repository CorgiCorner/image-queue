import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import { idSchema, requestSchema, type Job } from "./schema";
import { createCorrection, noteInput, type ImageNote } from "./notes";
import { readKey } from "./settings";
import type { ImageService } from "./service";
import { annotatedImage } from "../sources/annotated-image";

const inputSchema = z.object({
  imageId: idSchema,
  idempotencyKey: idSchema.max(96),
  instruction: z.string().trim().max(12000).default(""),
});

export const workspaceCorrectionSchema = inputSchema.extend({
  generation: requestSchema.pick({source: true, provider: true, model: true}),
  selection: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    w: z.number().positive().optional(), h: z.number().positive().optional(),
  }).optional(),
});
const preparationSchema = workspaceCorrectionSchema.partial({ generation: true });
export async function prepareCorrection(api: ImageService, input: z.input<typeof preparationSchema>) {
  const value = preparationSchema.parse(input);
  const signature = JSON.stringify([value.generation, value.selection]);
  if (value.selection) noteInput.parse({imageId: value.imageId, text: value.instruction, ...value.selection});
  const numberedInstruction = (count: number) => value.selection ? `${count + 1}. ${value.instruction}` : value.instruction;
  return api.store.lock(`prepare-${value.idempotencyKey}`, async () => {
    const saved = await api.store.get<{ imageId: string; instruction: string; referenceIds: string[]; noteIds: string[]; notes?: ImageNote[]; signature?: string; referenceCount?: number }>("prepared-corrections", value.idempotencyKey);
    if (saved) {
      if (saved.imageId !== value.imageId || saved.instruction !== value.instruction || (saved.signature ?? "[null,null]") !== signature)
        throw new UserFacingError("Correction key belongs to a different request");
      if (saved.referenceIds.length === (saved.referenceCount ?? 2)) {
        const existing = await api.store.get("jobs", `IMG-${value.idempotencyKey}`);
        if (!existing && saved.notes) {
          for (const note of saved.notes) {
            const current = await api.store.get<ImageNote>("notes", note.id);
            if (!current || current.text !== note.text || current.x !== note.x || current.y !== note.y || current.w !== note.w || current.h !== note.h)
              throw new UserFacingError("Prepared notes changed. Start a new correction");
          }
        }
        return createCorrection(api, { ...value, instruction: numberedInstruction(saved.noteIds.length), originalOnly: saved.referenceCount === 1, referenceIds: saved.referenceIds, noteIds: saved.noteIds, noteSnapshot: saved.notes });
      }
    }
    const job = await api.store.get<Job>("jobs", value.imageId);
    if (!job || job.trashedAt || job.archivedAt || job.status !== "done")
      throw new UserFacingError("A ready, active image is required");
    if ((value.generation?.source ?? (job.imported ? "queue" : job.source)) === "api") {
      if (!(value.generation?.model ?? job.model)) throw new UserFacingError("Choose an available image model");
      await readKey(api.store, value.generation?.provider ?? job.provider);
    }
    const notes = saved?.notes ?? (await api.store.list<ImageNote>("notes")).filter(note => note.imageId === job.id && !note.sentInJobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (!notes.length && !value.instruction) throw new UserFacingError("Add an unsent note first");
    let blob = job.blobKey ? await api.store.getBlob(job.blobKey) : undefined;
    if (!blob && job.source === "queue") {
      const { queueOutput, configuredQueueRoot } = await import("../sources/queue");
      blob = { bytes: await queueOutput(await configuredQueueRoot(), job), mime: "image/png" };
    }
    if (!blob) throw new UserFacingError("Original image is unavailable");
    const overlays = value.selection ? [...notes, {
      imageId: job.id, text: value.instruction, id: value.idempotencyKey, createdAt: job.createdAt, ...value.selection,
    }] : notes;
    const originalOnly = !!value.generation && !overlays.some(note => note.x !== undefined);
    const referenceIds = [...(saved?.referenceIds ?? [])];
    const noteIds = notes.map(note => note.id);
    const saveProgress = () => api.store.put("prepared-corrections", value.idempotencyKey, {
      id: value.idempotencyKey, imageId: value.imageId, instruction: value.instruction, referenceIds, noteIds, notes, signature, referenceCount: originalOnly ? 1 : 2,
    });
    if (!saved?.notes) await saveProgress();
    if (!referenceIds[0]) {
      const original = await api.addReference(job.projectId, "original", blob.mime, blob.bytes, undefined, undefined, `correction-${value.idempotencyKey}-original`);
      referenceIds.push(original.id);
      await saveProgress();
    }
    if (!originalOnly && !referenceIds[1]) {
      const annotated = await annotatedImage(blob.bytes, overlays);
      const reference = await api.addReference(job.projectId, "notes.png", annotated.mime, annotated.bytes, undefined, undefined, `correction-${value.idempotencyKey}-notes`);
      referenceIds.push(reference.id);
      await saveProgress();
    }
    return createCorrection(api, { ...value, instruction: numberedInstruction(notes.length), originalOnly, referenceIds, noteIds, noteSnapshot: notes });
  });
}
