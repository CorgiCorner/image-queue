import { applyVerifiedModelProfiles } from "./model-profiles";
import { UserFacingError } from "./user-facing-error";
import { requireReleaseProvider } from "./release-providers";
import { configuration } from "@/core/config";
import { resolveModelSize, sizeProfileSchema } from "./size-intent";
import { storage } from "../storage";
import { StorageLockBusy, type Storage } from "../storage/types";
import type { Job, Model, Reference } from "./schema";
import { ImageService } from "./service";
import { readKey } from "./settings";
export async function service() {
  const store = await storage();
  try {
    await (await import("./purge")).recoverPurges(store);
  } catch (error) {
    if (!(error instanceof StorageLockBusy) || error.key !== "stacks") throw error;
  }
  await (await import("./metadata-operation")).recoverMetadata(store);
  return new ImageService(store);
}
export async function retryImageJob(id: string, acknowledgeUncertain = false) {
  const api = await service();
  const original = await api.store.get<Job>("jobs", id);
  return original?.source === "queue"
    ? retryBlockedQueueJob(id, acknowledgeUncertain)
    : api.retryImage(id, acknowledgeUncertain);
}
export async function retryBlockedQueueJob(id: string, acknowledgeUncertain = false) {
  const api = await service();
  if (configuration("STORAGE_DRIVER") === "cloudflare")
    throw new UserFacingError("Codex queue requires the local companion");
  return api.store.lock(`retry-${id}`, async () => {
    const original = await api.store.get<Job>("jobs", id);
    if (!original || !["blocked", "uncertain", "failed"].includes(original.status) || original.source !== "queue" || original.archivedAt || original.trashedAt)
      throw new UserFacingError("Select a blocked or interrupted Codex queue request");
    if(original.status === "uncertain" && !acknowledgeUncertain)throw new UserFacingError("The original worker may have generated an image. Confirm before sending again.");
    const { pathSettings } = await import("./paths");
    const { hash } = await import("./schema");
    const { appendQueue, prepareBlockedQueueRetry } = await import("../sources/queue");
    const settings = await pathSettings(api.store);
    const { references, ...request } = await prepareBlockedQueueRetry(
      settings.queueDirectory,
      id,
      settings.referenceDirectories,
      original.status !== "blocked",
    );
    const job = await api.create({
      ...request,
      projectId: original.projectId,
      topicId: original.topicId,
      source: "queue",
      provider: original.provider,
      model: original.model,
      referenceIds: [],
      idempotencyKey: `retry-${await hash(id)}`,
    });
    return api.store.lock(job.id, async () => {
      const current = await api.store.get<Job>("jobs", job.id);
      if (!current) throw new UserFacingError("Retry request is missing");
      if (current.outputPath || current.status !== "queued") return current;
      const outputPath = await api.store.lock("path-settings", async () => {
        const latest = await pathSettings(api.store);
        if (JSON.stringify(latest) !== JSON.stringify(settings))
          throw new UserFacingError("Directory settings changed. Try again.");
        return appendQueue(settings.queueDirectory, current, references);
      });
      const queued = { ...current, outputPath, updatedAt: new Date().toISOString() };
      await api.store.put("jobs", queued.id, queued);
      return queued;
    });
  });
}

export async function enqueue(id: string) {
  const store = await storage();
  await store.lock(id, async () => {
    const job = await store.get<Job>("jobs", id);
    if (job?.status !== "queued") return;
    if (job.source === "queue") {
      if (job.outputPath) return;
      if (configuration("STORAGE_DRIVER") === "cloudflare")
        throw new UserFacingError("Codex queue requires the local companion");
      await store.lock("path-settings", async () => {
        const { appendQueue, configuredQueueRoot } = await import(
          "../sources/queue"
        );
        const { exportQueueReferences } = await import("../sources/queue");
        const root = await configuredQueueRoot();
        const references = await Promise.all(
          job.referenceIds.map(async (refId) => {
            const ref = await store.get<Reference>("references", refId);
            const blob = ref && (await store.getBlob(ref.blobKey));
            if (!blob) throw new UserFacingError("Reference file is missing");
            return { id: refId, ...blob };
          }),
        );
        const refs = await exportQueueReferences(root, job.id, references);
        const outputPath = await appendQueue(root, job, refs);
        await store.put("jobs", job.id, {
          ...job,
          outputPath,
          updatedAt: new Date().toISOString(),
        });
      });
      const runner = (globalThis as typeof globalThis & {imageQueueLocalRunner?: {wake():Promise<void>}}).imageQueueLocalRunner;
      await runner?.wake();
      return;
    }
    requireReleaseProvider(job.provider);
    const key = await readKey(store, job.provider);
    const models = applyVerifiedModelProfiles((await store.get<Model[]>("models", job.provider)) ?? []);
    const profile = models.find((m) => m.id === job.model);
    if (!profile)
      throw new UserFacingError("Refresh provider models and select an available model");
    if (job.referenceIds.length && !profile.references)
      throw new UserFacingError("Selected model does not support image references");
    if (job.transparent && !profile.transparency)
      throw new UserFacingError("Selected model does not support transparency");
    const parsedProfile = sizeProfileSchema.safeParse(profile.sizeProfile);
    if (!parsedProfile.success)
      throw new UserFacingError("This model has no valid size profile. Choose another model or refresh its configuration.");
    const sizeParameters = resolveModelSize(parsedProfile.data, job).parameters;
    const providerDimensions = sizeParameters.size?.split("x").map(Number);
    const attempt = {
      ...job,
      status: "running" as const,
      requestedSize: job.requestedSize ?? { width: job.width, height: job.height },
      providerSize: providerDimensions
        ? { width: providerDimensions[0], height: providerDimensions[1] }
        : undefined,
      providerSizeParameters: sizeParameters,
      attemptId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.put("jobs", id, attempt);
    try {
      const refs = await Promise.all(
        job.referenceIds.map(async (refId) => {
          const ref = await store.get<Reference>("references", refId);
          const blob = ref && (await store.getBlob(ref.blobKey));
          if (!blob) throw new UserFacingError("Reference file is missing");
          return blob.bytes;
        }),
      );
      const { generate } = await import("../sources/providers");
      const result = await generate(job, key, refs, parsedProfile.data);
      const blobKey = `results/${await import("./schema").then((schema) => schema.hash(result.bytes))}`;
      await store.putBlob(blobKey, result.bytes, result.mime);
      await store.put("jobs", id, {
        ...attempt,
        status: result.adaptationError ? "blocked" : "done",
        error: result.adaptationError,
        requestedSize: job.requestedSize ?? {width:job.width,height:job.height},
        generatedSize: {width:result.width ?? job.width,height:result.height ?? job.height},
        providerResultSize: result.generatedDimensions,
        width: result.width ?? job.width,
        height: result.height ?? job.height,
        blobKey,
        updatedAt: new Date().toISOString(),
        provenance: JSON.stringify(
          {
            prompt: job.prompt,
            provider: job.provider,
            model: job.model,
            requestedSize: attempt.requestedSize,
            requestedAspectRatio: job.aspectRatio,
            providerSize: attempt.providerSize,
            providerSizeParameters: attempt.providerSizeParameters,
            providerResultSize: result.generatedDimensions,
            generatedSize: { width: result.width ?? job.width, height: result.height ?? job.height },
            usage: result.usage,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      });
    } catch {
      await store.put("jobs", id, {
        ...attempt,
        status: "uncertain",
        error:
          "Generation did not complete locally. Check the provider before creating another request; it may have been charged.",
        updatedAt: new Date().toISOString(),
      });
    }
  });
}
async function applyObserved(
  store: Storage,
  snapshot: Job,
  patch: Partial<Job>,
) {
  try {
    return await store.lock(snapshot.id, async () => {
      const current = await store.get<Job>("jobs", snapshot.id);
      if (!current || current.status !== snapshot.status)
        return current ?? snapshot;
      const updated = { ...current, ...patch };
      if (JSON.stringify(current) !== JSON.stringify(updated))
        await store.put("jobs", snapshot.id, updated);
      return updated;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("operation is in progress")
    )
      return snapshot;
    throw error;
  }
}
export async function refreshedJobs(existingService?: ImageService) {
  const api = existingService ?? await service();
  const jobs = await api.jobs();
  const localQueue = configuration("STORAGE_DRIVER") !== "cloudflare";
  let inspector: Promise<(job: Job) => Promise<Partial<Job>>> | undefined;
  const observeQueue = async () => {
    const [{ queueInspector }, { pathSettings }] = await Promise.all([
      import("../sources/queue"),
      import("./paths"),
    ]);
    return queueInspector((await pathSettings(api.store)).queueDirectory);
  };
  const observed = await Promise.all(
    jobs.map(async (job) => {
      if (
        job.source === "api" &&
        job.status === "running" &&
        Date.now() - Date.parse(job.startedAt!) > 300000
      ) {
        const updated: Job = {
          ...job,
          status: "uncertain",
          error:
            "Execution was interrupted. Verify the provider result before retrying.",
        };
        return { job, patch: { status: updated.status, error: updated.error } };
      }
      if (
        ["done", "cancelled", "uncertain", "failed"].includes(job.status) ||
        job.source !== "queue" ||
        !job.outputPath ||
        !localQueue
      )
        return { job, patch: undefined };
      inspector ??= observeQueue();
      const change = await (await inspector)(job);
      if(job.attemptId && job.startedAt && change.claim?.reserved)change.claim={...change.claim,reserved:undefined};
      return { job, patch: Object.keys(change).length > 0 ? change : undefined };
    }),
  );
  const results: Job[] = [];
  for (const { job, patch } of observed) {
    results.push(patch ? await applyObserved(api.store, job, patch) : job);
  }
  return results;
}
