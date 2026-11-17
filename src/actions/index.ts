"use server";
import { generationPreferenceSchema, saveGenerationPreference } from "@/core/generation-preference";
import { UserFacingError, publicErrorMessage } from "@/core/user-facing-error";
import { requireReleaseProvider } from "@/core/release-providers";
import { applyVerifiedModelProfiles } from "@/core/model-profiles";
import { purgeInput } from "@/core/purge-plan";
import { retentionInput } from "@/core/retention";
import { noteInput } from "@/core/notes";
import { pathsSchema, savePaths } from "@/core/paths";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";
import { verifyAccess } from "@/core/access";
import { localRequestDenied } from "@/core/local-request";
import { poolSchema, savePoolConfig } from "@/core/pool";
import { enqueue, retryBlockedQueueJob, retryImageJob, service } from "@/core/runtime";
import { idSchema, projectSchema, requestSchema, retryImageSchema, settingsSchema, type Job, type Model } from "@/core/schema";
import { saveKey, removeKey, readKey } from "@/core/settings";
import { reservationRecoveryInput, inspectReservedResult } from "@/core/reservation-recovery";
import { MAX_TAG_LENGTH } from "@/core/tags";

import { discoverModels } from "@/sources/providers";
import { resolveModelSize, sizeProfileSchema } from "@/core/size-intent";

const action = createSafeActionClient({
  handleServerError: publicErrorMessage,
}).use(async ({ next }) => {
  const requestHeaders = await headers();
  if (localRequestDenied(new Request("http://localhost", { headers: requestHeaders })))
    throw new UserFacingError("Access denied");
  await verifyAccess(requestHeaders.get("cf-access-jwt-assertion"));
  return next();
});
async function submit(job: Job, api: Awaited<ReturnType<typeof service>>) {
  if (job.source === "queue") return enqueue(job.id);
  after(async () => {
    try {
      await enqueue(job.id);
    } catch (error) {
      await api.store.lock(job.id, async () => {
        const current = await api.store.get<Job>("jobs", job.id);
        if (current?.status !== "queued") return;
        await api.store.put("jobs", job.id, {
          ...current,
          status: "failed",
          error: error instanceof UserFacingError ? error.message : "Generation failed",
          updatedAt: new Date().toISOString(),
        });
      });
    }
  });
}

export const createProjectAction = action
  .inputSchema(z.object({ name: z.string().trim().min(1).max(100), directory: projectSchema.shape.directory }))
  .action(async ({ parsedInput }) => {
    const project = await (await service()).createProject(parsedInput.name, parsedInput.directory);
    revalidatePath("/");
    return project;
  });
export const moveProjectAction = action
  .inputSchema(z.object({ id: idSchema, directory: projectSchema.shape.directory.unwrap() }))
  .action(async ({ parsedInput }) => {
    const project = await (await service()).moveProject(parsedInput.id, parsedInput.directory);
    revalidatePath("/");
    revalidatePath(`/p/${project.id}`);
    return project;
  });
export const generationSourceAction = action
  .inputSchema(generationPreferenceSchema)
  .action(async ({parsedInput})=>{
    const saved=await saveGenerationPreference((await service()).store,parsedInput);
    revalidatePath('/');return saved;
  });

export const requestImageAction = action
  .inputSchema(requestSchema)
  .action(async ({ parsedInput }) => {
    const api = await service();
    if (parsedInput.source === "api") {
      requireReleaseProvider(parsedInput.provider);
      const models = applyVerifiedModelProfiles((await api.store.get<Model[]>("models", parsedInput.provider)) ?? []);
      const profile = sizeProfileSchema.safeParse(models?.find(model => model.id === parsedInput.model)?.sizeProfile);
      if (!profile.success)
        throw new UserFacingError("This model has no valid size profile. Choose another model or refresh its configuration.");
      resolveModelSize(profile.data, parsedInput);
      await readKey(api.store, parsedInput.provider);
    }
    const job = await api.create(parsedInput);
    await submit(job, api);
    revalidatePath("/");
    return job;
  });
export const retryBlockedQueueAction = action
  .inputSchema(z.object({ ids: z.array(idSchema).min(1).max(1000) }))
  .action(async ({ parsedInput }) => {
    const queued: string[] = [];
    const failures: { id: string; message: string }[] = [];
    for (const id of new Set(parsedInput.ids)) {
      try {
        await retryBlockedQueueJob(id);
        queued.push(id);
      } catch (error) {
        failures.push({ id, message: error instanceof Error ? error.message : "Retry failed" });
      }
    }
    revalidatePath("/");
    return { queued, failures };
  });
export const retryImageAction = action
  .inputSchema(retryImageSchema)
  .action(async ({ parsedInput }) => {
    const api = await service();
    const job = await retryImageJob(parsedInput.id, parsedInput.acknowledgeUncertain);
    await submit(job, api);
    revalidatePath("/");
    return job;
  });
export const markUncertainFailedAction = action
  .inputSchema(z.object({ id: idSchema }))
  .action(async ({ parsedInput }) => {
    const job = await (await service()).markUncertainFailed(parsedInput.id);
    revalidatePath("/");
    return job;
  });
export const openAgentConfigDirectoryAction = action
  .inputSchema(z.object({client:z.enum(['Codex','Claude Code'])}))
  .action(async({parsedInput})=>{
    const h=await headers();const origin=h.get('origin');const url=origin?new URL(origin):undefined;
    if(!url||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.host!==h.get('host')||(await import('@/core/config')).configuration('STORAGE_DRIVER')==='cloudflare')
      throw new UserFacingError('Open configuration folders from the local workspace');
    await (await import('@/storage/open-agent-config-directory')).openAgentConfigDirectory(parsedInput.client);
  });
export const revealQueueImageAction = action
  .inputSchema(z.object({ id: idSchema }))
  .action(async ({ parsedInput }) => {
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    const url = origin ? new URL(origin) : undefined;
    if (process.platform !== "darwin" || !url ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.host !== requestHeaders.get("host") ||
        (await import("@/core/config")).configuration("STORAGE_DRIVER") === "cloudflare")
      throw new UserFacingError("Finder is available from the local Mac workspace");
    const api = await service();
    const job = await api.store.get<import("@/core/schema").Job>("jobs", parsedInput.id);
    if (job?.source !== "queue" || job.status !== "done" || !job.outputPath)
      throw new UserFacingError("This request has no local queue output");
    const { configuredQueueRoot, queueOutputPath } = await import("@/sources/queue");
    const file = await queueOutputPath(await configuredQueueRoot(), job);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    try {
      await promisify(execFile)("/usr/bin/open", ["-R", file], { timeout: 5000 });
    } catch {
      throw new UserFacingError("Finder could not reveal this image");
    }
  });
export const connectAction = action
  .inputSchema(settingsSchema)
  .action(async ({ parsedInput }) => {
    requireReleaseProvider(parsedInput.provider);
    const api = await service();
    const discovered = await discoverModels(
      parsedInput.provider,
      parsedInput.apiKey,
    );
    if (!discovered.length)
      throw new UserFacingError("No supported image models available for this key");
    const previous = await api.store.get<Model[]>("models", parsedInput.provider);
    const storedProfiles = new Map(previous?.map(model => [model.id, model.sizeProfile]));
    const models = applyVerifiedModelProfiles(discovered.map(model => ({
      ...model,
      sizeProfile: model.sizeProfile ?? storedProfiles.get(model.id),
    })));
    await saveKey(api.store, parsedInput.provider, parsedInput.apiKey);
    await api.store.put("models", parsedInput.provider, models);
    revalidatePath("/");
    return models;
  });
/** Check a connected provider with its stored key; the key and the saved catalog stay as they are. */
export const testConnectionAction = action
  .inputSchema(settingsSchema.pick({ provider: true }))
  .action(async ({ parsedInput }) => {
    requireReleaseProvider(parsedInput.provider);
    const api = await service();
    const discovered = await discoverModels(parsedInput.provider, await readKey(api.store, parsedInput.provider));
    if (!discovered.length)
      throw new UserFacingError("The provider answered, but no supported image models are available for this key.");
    return { models: discovered.length };
  });
export const moveJobAction = action
  .inputSchema(z.object({ id: idSchema, projectId: idSchema }))
  .action(async ({ parsedInput }) => {
    await (await service()).moveJob(parsedInput.id, parsedInput.projectId);
    revalidatePath("/");
  });
export const cancelAction = action
  .inputSchema(z.object({ id: idSchema }))
  .action(async ({ parsedInput }) => {
    await (await service()).cancelJob(parsedInput.id);
    revalidatePath("/");
  });
/** Recheck local installation/login without changing the saved parallel count. */
export const recheckLocalRunnerAction = action
  .inputSchema(z.object({}))
  .action(async () => {
    await service();
    const runner=(globalThis as typeof globalThis & {imageQueueLocalRunner?: {wake(resume?:boolean):Promise<void>}}).imageQueueLocalRunner;
    await runner?.wake(true);
    revalidatePath("/");
  });
export const pauseLocalRunnerAction = action
  .inputSchema(z.object({paused:z.boolean()}))
  .action(async ({parsedInput})=>{
    const store=(await service()).store;
    const {readLocalRunnerSettings}=await import('@/core/local-runner-settings');
    const config=await readLocalRunnerSettings(store);
    await store.put('settings','local-runner',{...config,workers:config?.workers??1,paused:parsedInput.paused});
    const runner=(globalThis as typeof globalThis & {imageQueueLocalRunner?:{wake(resume?:boolean):Promise<void>}}).imageQueueLocalRunner;
    await runner?.wake(!parsedInput.paused);
    revalidatePath('/');
  });
export const poolConfigAction = action
  .inputSchema(poolSchema)
  .action(async ({ parsedInput }) => {
    const store=(await service()).store;
    const runner=(globalThis as typeof globalThis & {imageQueueLocalRunner?: {wake(resume?:boolean):Promise<void>}}).imageQueueLocalRunner;
    const config = await savePoolConfig(store, runner ? {...parsedInput,workers:0} : parsedInput);
    if(runner){const {readLocalRunnerSettings}=await import('@/core/local-runner-settings');const current=await readLocalRunnerSettings(store);await store.put('settings','local-runner',{...current,workers:Math.max(1,parsedInput.workers),paused:current?.paused??true});await runner.wake();}
    revalidatePath("/");
    return config;
  });

export const disconnectAction = action
  .inputSchema(
    z.object({
      provider: z.enum(["openai", "google", "gateway", "openrouter"]),
    }),
  )
  .action(async ({ parsedInput }) => {
    await removeKey((await service()).store, parsedInput.provider);
    revalidatePath("/");
  });

export const pathSettingsAction = action
  .inputSchema(pathsSchema)
  .action(async ({ parsedInput }) => {
    if (
      (await import("@/core/config")).configuration("STORAGE_DRIVER") ===
      "cloudflare"
    )
      throw new UserFacingError("Local directory settings require a local workspace");
    return savePaths((await service()).store, parsedInput);
  });

export const createTopicAction = action
  .inputSchema(
    z.object({ projectId: idSchema, name: z.string().trim().min(1).max(100) }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).createTopic(
      (await service()).store,
      parsedInput.projectId,
      parsedInput.name,
    ),
  );
export const pinAction = action
  .inputSchema(
    z.object({
      targetType: z.enum(["project", "topic"]),
      targetId: idSchema,
      pinned: z.boolean(),
    }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).pinTarget(
      (await service()).store,
      parsedInput.targetType,
      parsedInput.targetId,
      parsedInput.pinned,
    ),
  );
export const moveToTopicAction = action
  .inputSchema(
    z.object({ ids: z.array(idSchema).min(1).max(1000), topicId: idSchema }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).moveToTopic(
      (await service()).store,
      parsedInput.ids,
      parsedInput.topicId,
    ),
  );
export const reorderAction = action
  .inputSchema(
    z.object({
      collection: z.enum(["projects", "topics", "pins"]),
      id: idSchema,
      direction: z.union([z.literal(-1), z.literal(1)]),
    }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).reorderItem(
      (await service()).store,
      parsedInput.collection,
      parsedInput.id,
      parsedInput.direction,
    ),
  );
export const moveTopicAction = action
  .inputSchema(z.object({ id: idSchema, projectId: idSchema }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).moveTopic(
      (await service()).store,
      parsedInput.id,
      parsedInput.projectId,
    ),
  );

export const tagImageAction = action
  .inputSchema(
    z.object({
      id: idSchema,
      tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(50),
    }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/tags")).tagImage(
      (await service()).store,
      parsedInput.id,
      parsedInput.tags,
      "user",
    ),
  );
export const removeImageTagAction = action
  .inputSchema(z.object({ id: idSchema, tag: z.string().min(1).max(MAX_TAG_LENGTH) }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/tags")).removeImageTag((await service()).store, parsedInput.id, parsedInput.tag),
  );
export const editTagAction = action
  .inputSchema(
    z.object({
      from: z.string().min(1).max(MAX_TAG_LENGTH),
      to: z.string().min(1).max(MAX_TAG_LENGTH).optional(),
    }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/tags")).editTag(
      (await service()).store,
      parsedInput.from,
      parsedInput.to,
    ),
  );

export const joinStackAction = action
  .inputSchema(z.object({ parentId: idSchema, versionId: idSchema }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/stacks")).joinStack(
      (await service()).store,
      parsedInput.parentId,
      parsedInput.versionId,
      true,
    ),
  );
export const mainVersionAction = action
  .inputSchema(z.object({ id: idSchema }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/stacks")).mainVersion(
      (await service()).store,
      parsedInput.id,
    ),
  );
export const addNoteAction = action
  .inputSchema(noteInput)
  .action(async ({ parsedInput }) =>
    (await import("@/core/notes")).addNote(
      (await service()).store,
      parsedInput,
    ),
  );

export const markNotesAction = action
  .inputSchema(z.object({ imageId: idSchema, jobId: idSchema }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/notes")).markNotesSent(
      (await service()).store,
      parsedInput.imageId,
      parsedInput.jobId,
    ),
  );

export const acceptTagAction = action
  .inputSchema(z.object({ id: idSchema, tag: z.string().min(1).max(MAX_TAG_LENGTH) }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/tags")).acceptTag(
      (await service()).store,
      parsedInput.id,
      parsedInput.tag,
    ),
  );
export const correctionAction = action
  .inputSchema(
    z.object({
      instruction: z.string().trim().max(12000).optional(),
      generation: requestSchema.pick({ source: true, provider: true, model: true }).optional(),
      imageId: idSchema,
      referenceIds: z.array(idSchema).length(2),
      idempotencyKey: idSchema.max(96),
    }),
  )
  .action(async ({ parsedInput }) => {
    const api = await service();
    if (parsedInput.generation?.source === "api") {
      requireReleaseProvider(parsedInput.generation.provider);
      await readKey(api.store, parsedInput.generation.provider);
    }
    const job = await (
      await import("@/core/notes")
    ).createCorrection(api, parsedInput);
    await submit(job, api);
    return job;
  });
export const deleteTopicAction = action
  .inputSchema(z.object({ id: idSchema }))
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).deleteTopic(
      (await service()).store,
      parsedInput.id,
    ),
  );
export const rebuildIndexAction = action
  .inputSchema(z.object({}))
  .action(async () => {
    await (await import("@/core/search")).rebuildIndex((await service()).store);
    return { rebuilt: true };
  });
export const renameTopicAction = action
  .inputSchema(
    z.object({ id: idSchema, name: z.string().trim().min(1).max(100) }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).renameTopic(
      (await service()).store,
      parsedInput.id,
      parsedInput.name,
    ),
  );
export const placeBeforeAction = action
  .inputSchema(
    z.object({
      collection: z.enum(["projects", "topics", "pins"]),
      id: idSchema,
      beforeId: idSchema,
      afterTarget: z.boolean().optional(),
    }),
  )
  .action(async ({ parsedInput }) =>
    (await import("@/core/organization")).placeBefore(
      (await service()).store,
      parsedInput.collection,
      parsedInput.id,
      parsedInput.beforeId,
      parsedInput.afterTarget,
    ),
  );
export const iterateAction = action
  .inputSchema(
    z.object({
      parentId: idSchema,
      prompt: z.string().trim().min(3).max(12000),
      referenceId: idSchema,
      idempotencyKey: idSchema.max(96),
    }),
  )
  .action(async ({ parsedInput }) => {
    const api = await service();
    const job = await (
      await import("@/core/stacks")
    ).createIteration(api, parsedInput);
    await submit(job, api);
    return job;
  });

export const retentionAction = action
  .inputSchema(retentionInput)
  .action(async ({parsedInput}) => (await import("@/core/retention")).changeRetention((await service()).store, parsedInput));

export const undoRetentionAction = action
  .inputSchema(z.object({id:idSchema}))
  .action(async ({parsedInput}) => (await import("@/core/retention")).undoRetention((await service()).store,parsedInput.id));

export const purgeAction = action
  .inputSchema(purgeInput)
  .action(async ({ parsedInput }) => {
    const api = await service();
    let externalQueueRoot: string | undefined;
    if (parsedInput.removeExternal) {
      if ((await import("@/core/config")).configuration("STORAGE_DRIVER") === "cloudflare")
        throw new UserFacingError("External outputs can only be deleted from the local workspace");
      const { configuredQueueRoot } = await import("@/sources/queue");
      externalQueueRoot = await configuredQueueRoot();
    }
    const deleted = await (await import("@/core/purge")).purgeJobs(api.store, parsedInput.ids, externalQueueRoot);
    revalidatePath("/");
    return { deleted };
  });

export const inspectReservationAction = action.inputSchema(reservationRecoveryInput).action(async ({parsedInput})=>{
 const job=await inspectReservedResult((await service()).store,parsedInput);revalidatePath('/');return job;
});
