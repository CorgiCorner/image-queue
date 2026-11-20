import { UserFacingError } from "./user-facing-error";
import { aspectRatios } from "./size-intent";
import { idSchema } from "./schema";
import { nextVersionMode } from "./image-format";
import { createRecordIdentity, type ReplicaIdentity } from "./replica-identity";
import { z } from "zod";
import type { Storage } from "../storage/types";
export const noteInput = z
  .object({
    imageId: idSchema,
    text: z.string().trim().min(1).max(4000),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    w: z.number().positive().max(1).optional(),
    h: z.number().positive().max(1).optional(),
  })
  .refine(
    (value) => (value.x === undefined) === (value.y === undefined),
    "Both coordinates are required",
  )
  .refine(
    (value) => (value.w === undefined) === (value.h === undefined),
    "Both region dimensions are required",
  )
  .refine(
    (value) =>
      value.w === undefined ||
      (value.x !== undefined &&
        value.y !== undefined &&
        value.x + value.w <= 1 &&
        value.y + value.h! <= 1),
    "Region must fit within the image",
  );
export type ImageNote = z.infer<typeof noteInput> & Partial<ReplicaIdentity> & {
  id: string;
  createdAt: string;
  updatedAt?: string;
  machineId?: string;
  sentInJobId?: string;
};
export async function addNote(
  store: Storage,
  input: z.infer<typeof noteInput>,
) {
  const value = noteInput.parse(input);
  return store.lock(value.imageId, async () => {
    if (!(await store.get("jobs", value.imageId)))
      throw new UserFacingError("Image does not exist");
    const id = crypto.randomUUID();
    const identity = await createRecordIdentity(store, "notes", id);
    const note = {
      ...value,
      ...identity,
      id,
      machineId: identity.originMachine,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await store.put("notes", note.id, note);
    return note;
  });
}

export async function markNotesSent(
  store: Storage,
  imageId: string,
  jobId: string,
  noteIds?: string[],
  snapshot?: ImageNote[],
) {
  idSchema.parse(imageId);
  idSchema.parse(jobId);
  if (noteIds) z.array(idSchema).parse(noteIds);
  return store.lock(imageId, async () => {
    const job = await store.get<import("./schema").Job>("jobs", jobId);
    if (!job || job.parentVersionId !== imageId)
      throw new UserFacingError("Correction job does not belong to this image");
    if (!(await store.get("jobs", imageId))) throw new UserFacingError("Image does not exist");
    const notes = await store.list<ImageNote>("notes");
    for (const note of notes.filter(
      (note) =>
        note.imageId === imageId &&
        !note.sentInJobId &&
        (!noteIds || noteIds.includes(note.id)),
    )) {
      const sentVersion = snapshot?.find(item => item.id === note.id);
      if (snapshot && (!sentVersion || sentVersion.text !== note.text || sentVersion.x !== note.x || sentVersion.y !== note.y || sentVersion.w !== note.w || sentVersion.h !== note.h)) continue;
      await store.put("notes", note.id, { ...note, sentInJobId: jobId });
    }
  });
}

const changesHeader = "Requested changes:";

/**
 * The prompt of a version that is generated again rather than edited: the earlier
 * prompt with the requested changes listed under it. A later version adds to the
 * same list, so every change asked for so far stays in force.
 */
export function revisedPrompt(prompt: string, changes: string[]) {
  const at = prompt.lastIndexOf(`\n\n${changesHeader}\n`);
  const earlier = at < 0 ? 0 : prompt.slice(at).split("\n").filter(line => /^\d+\. /.test(line)).length;
  const list = changes.map((change, index) => `${earlier + index + 1}. ${change.replace(/\s*\n\s*/g, " ")}`).join("\n");
  return at < 0 ? `${prompt}\n\n${changesHeader}\n${list}` : `${prompt}\n${list}`;
}

export async function createCorrection(
  api: import("./service").ImageService,
  input: {
    imageId: string;
    referenceIds: string[];
    idempotencyKey: string;
    instruction?: string;
    generation?: { source: "queue" | "api"; provider: import("./schema").Provider; model: string };
    originalOnly?: boolean;
    noteIds?: string[];
    noteSnapshot?: ImageNote[];
  },
) {
  idSchema.parse(input.imageId);
  idSchema.max(96).parse(input.idempotencyKey);
  z.array(idSchema).parse(input.referenceIds);
  if (input.noteIds) z.array(idSchema).parse(input.noteIds);
  if (input.noteSnapshot) {
    for (const note of input.noteSnapshot) {
      noteInput.parse(note);
      idSchema.parse(note.id);
      if (note.imageId !== input.imageId || !input.noteIds?.includes(note.id))
        throw new UserFacingError("Invalid prepared note snapshot");
    }
    if (input.noteSnapshot.length !== input.noteIds?.length ||
        new Set(input.noteSnapshot.map(note => note.id)).size !== input.noteSnapshot.length)
      throw new UserFacingError("Incomplete prepared note snapshot");
  }
  return api.store.lock(`correction-${input.imageId}`, async () => {
    const instruction = z
      .string()
      .trim()
      .max(12000)
      .parse(input.instruction ?? "");
    const original = await api.store.get<import("./schema").Job>(
      "jobs",
      input.imageId,
    );
    if (!original) throw new UserFacingError("Image does not exist");
    const availableNotes = (await api.store.list<ImageNote>("notes")).filter(
      (note) => note.imageId === input.imageId && !note.sentInJobId,
    );
    const notes = input.noteIds
      ? input.noteIds.flatMap(id => availableNotes.filter(note => note.id === id))
      : availableNotes;
    // An animation has no reference: its next version is generated again from its prompt.
    const regenerate = nextVersionMode(original) === "regenerate";
    if (
      input.referenceIds.length !== (regenerate ? 0 : input.originalOnly ? 1 : 2) ||
      new Set(input.referenceIds).size !== input.referenceIds.length
    )
      throw new UserFacingError("Duplicate or missing correction references");
    const intentId = input.idempotencyKey;
    const intent = await api.store.get<{
      imageId: string;
      referenceIds: string[];
      noteIds?: string[];
      instruction?: string;
      request?: import("./schema").ImageRequest;
      noteSnapshot?: ImageNote[];
    }>("correction-intents", intentId);
    if (
      intent &&
      (intent.imageId !== input.imageId ||
        JSON.stringify(intent.referenceIds) !==
          JSON.stringify(input.referenceIds) ||
        (intent.instruction ?? "") !== instruction ||
        (input.generation && intent.request && (intent.request.source !== input.generation.source || intent.request.provider !== input.generation.provider || intent.request.model !== input.generation.model)))
    )
      throw new UserFacingError("Correction key belongs to a different request");
    const existing = await api.store.get<import("./schema").Job>(
      "jobs",
      `IMG-${input.idempotencyKey}`,
    );
    if (existing) {
      if (!intent) throw new UserFacingError("Correction key belongs to another request");
      if (existing.parentVersionId && existing.parentVersionId !== original.id)
        throw new UserFacingError("Correction key belongs to another image");
      const linked = existing.parentVersionId
        ? existing
        : await (
            await import("./stacks")
          ).joinStack(api.store, original.id, existing.id);
      await markNotesSent(
        api.store,
        original.id,
        existing.id,
        intent.noteIds ?? [],
        intent.noteSnapshot,
      );
      return linked;
    }
    if (input.noteIds && (new Set(input.noteIds).size !== input.noteIds.length || notes.length !== input.noteIds.length))
      throw new UserFacingError("Prepared correction notes are unavailable");
    if (original.archivedAt || original.trashedAt) throw new UserFacingError("Restore the image before requesting a correction");
    if (original.status !== "done") throw new UserFacingError("Wait for the image to finish before requesting a correction");
    if (!intent && !notes.length && !instruction)
      throw new UserFacingError("Add an unsent note first");
    const selectedNotes = intent
      ? notes.filter((note) => intent.noteIds?.includes(note.id))
      : input.noteSnapshot
        ? input.noteIds!.map(id => input.noteSnapshot!.find(note => note.id === id)!)
        : notes;
    if (
      intent &&
      !intent.request &&
      selectedNotes.length !== intent.noteIds?.length
    )
      throw new UserFacingError("Saved correction notes are unavailable");
    let transparent = original.transparent;
    const correctionSource = input.generation?.source ?? (original.imported ? "queue" : original.source);
    if (!intent?.request && correctionSource === "api" && original.imported && !original.opacityVerified) {
      const blob = original.blobKey ? await api.store.getBlob(original.blobKey) : undefined;
      if (!blob) throw new UserFacingError("Original image is unavailable");
      const { hasTransparentPixels } = await import("../sources/image-opacity");
      const actual = await hasTransparentPixels(blob.bytes);
      if (actual === undefined)
        throw new UserFacingError("Could not verify the original image's transparency. Re-import it before editing.");
      transparent = actual;
    }
    const request = intent?.request ?? {
      projectId: original.projectId,
      topicId: original.topicId,
      prompt: regenerate
        ? revisedPrompt(original.prompt, [...selectedNotes.map(note => note.text), instruction].filter(Boolean))
        : [
          ...selectedNotes.map((note, index) => `${index + 1}. ${note.text}`),
          instruction,
        ]
          .filter(Boolean)
          .join("\n\n"),
      source: correctionSource,
      provider: input.generation?.provider ?? original.provider,
      model: input.generation?.model ?? original.model,
      aspectRatio: aspectRatios.find(ratio => {
        const [width, height] = ratio.split(":").map(Number);
        return original.width * height === original.height * width;
      }),
      width: original.width,
      height: original.height,
      transparent,
      ...(regenerate ? {
        quality: original.quality, complexity: original.complexity, outputFormat: original.outputFormat,
        frameCount: original.frameCount, frameDurationMs: original.frameDurationMs,
      } : {}),
      referenceIds: input.referenceIds,
      idempotencyKey: input.idempotencyKey,
    };
    if (request.prompt.length > 12000)
      throw new UserFacingError("The prompt with these changes is too long. Shorten the changes.");
    if (request.source === "api") {
      const { applyVerifiedModelProfiles } = await import("./model-profiles");
      const models = await api.store.get<import("./schema").Model[]>("models", request.provider);
      const profile = applyVerifiedModelProfiles(models ?? []).find(model => model.id === request.model);
      if (profile && request.referenceIds.length && !profile.references)
        throw new UserFacingError("Choose a model that supports reference images.");
      if (profile && request.transparent && !profile.transparency)
        throw new UserFacingError("This image has transparency. Choose a source that supports transparent images.");
    }
    const noteIds = intent?.noteIds ?? selectedNotes.map((note) => note.id);
    await api.store.put("correction-intents", intentId, {
      id: intentId,
      imageId: input.imageId,
      referenceIds: input.referenceIds,
      noteIds,
      noteSnapshot: intent?.noteSnapshot ?? input.noteSnapshot,
      instruction,
      request,
    });
    const job = await api.create(request);
    const linked = await (
      await import("./stacks")
    ).joinStack(api.store, original.id, job.id);
    await markNotesSent(api.store, original.id, job.id, noteIds, intent?.noteSnapshot ?? input.noteSnapshot);
    return linked;
  });
}
