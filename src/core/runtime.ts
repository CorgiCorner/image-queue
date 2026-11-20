import { definiteRejectionMessage } from "./api-rejection";
import { applyVerifiedModelProfiles, assertModelOptions } from "./model-profiles";
import { UserFacingError } from "./user-facing-error";
import { requireReleaseProvider } from "./release-providers";
import { configuration } from "@/core/config";
import { resolveModelSize, sizeProfileSchema } from "./size-intent";
import { storage } from "../storage";
import { StorageLockBusy, type Storage } from "../storage/types";
import type { Job, Model, Reference } from "./schema";
import { ImageService } from "./service";
import { readKey } from "./settings";
import { queueUnavailableMessage } from "./generation-preference";
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
    throw new UserFacingError(queueUnavailableMessage);
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

type GenerationQueue = { send(body: { jobId: string }): Promise<unknown> };

async function failQueuedJob(id: string, message: string) {
  const store = await storage();
  await store.lock(id, async () => {
    const current = await store.get<Job>("jobs", id);
    if (current?.status !== "queued") return;
    await store.put("jobs", id, {
      ...current,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Runs a queued provider job outside the request that created it. An error
 * raised before the provider attempt is recorded, so the job never stays
 * queued without a runner. Returns "busy" when another operation holds the
 * job's lock; nothing was attempted and the caller may try again later.
 */
export async function runQueuedJob(id: string): Promise<"finished" | "busy"> {
  try {
    await enqueue(id);
  } catch (error) {
    if (error instanceof StorageLockBusy && error.key === id) return "busy";
    await failQueuedJob(id, error instanceof UserFacingError ? error.message : "Generation failed");
  }
  return "finished";
}

/** Records a queued job that could never take its lock; no provider request was made. */
export async function abandonQueuedJob(id: string) {
  try {
    await failQueuedJob(id, "Generation could not start because the request stayed busy. No provider request was made.");
  } catch (error) {
    if (!(error instanceof StorageLockBusy)) throw error;
  }
}

/**
 * Starts generation for a new job. Cloudflare hands provider jobs to the
 * generation queue, because a remote MCP call or a browser request may end
 * before the provider responds. Elsewhere enqueue leaves durable work for the
 * local dashboard.
 */
export async function dispatch(id: string) {
  if (configuration("STORAGE_DRIVER") !== "cloudflare") return enqueue(id);
  const job = await (await storage()).get<Job>("jobs", id);
  if (job?.source !== "api" || job.status !== "queued") return enqueue(id);
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const queue = (env as unknown as { GENERATION_QUEUE?: GenerationQueue }).GENERATION_QUEUE;
  try {
    if (!queue) throw new Error("GENERATION_QUEUE binding is missing");
    await queue.send({ jobId: id });
  } catch {
    await failQueuedJob(id, "Generation could not be started. No provider request was made.");
  }
}

// Submitters only leave durable work for the local dashboard. Cloudflare has its own request lifecycle.
export async function enqueue(id: string) {
  const store = await storage();
  const job = await store.get<Job>("jobs", id);
  if (job?.status !== "queued") return;
  if (job.source === "api" && configuration("STORAGE_DRIVER") !== "cloudflare") {
    await store.put("api-pending", id, { id, createdAt: job.createdAt });
    (globalThis as typeof globalThis & {imageQueueApiRunner?: {wake():void}}).imageQueueApiRunner?.wake();
    return;
  }
  await executeImageJob(id, store);
}

export function mergeApiResult(current:Job,result:Job):Job {
  const {status,error,requestedSize,generatedSize,providerResultSize,width,height,blobKey,updatedAt,provenance}=result;
  return {...current,status,error,requestedSize,generatedSize,providerResultSize,width,height,blobKey,updatedAt,provenance};
}

export async function executeImageJob(id: string, store: Storage,
  options?: { admit(commit: () => Promise<void>): Promise<boolean>; failed(message: string, stop?: boolean, resumeAt?: string): Promise<void> }) {
  await store.lock(id, async () => {
    const job = await store.get<Job>("jobs", id);
    if (job?.status !== "queued" || job.archivedAt || job.trashedAt) return;
    if (job.source === "queue") {
      if (job.outputPath) return;
      if (configuration("STORAGE_DRIVER") === "cloudflare")
        throw new UserFacingError(queueUnavailableMessage);
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
    if(job.startedAt || job.attemptId)return;
    requireReleaseProvider(job.provider);
    const key = await readKey(store, job.provider);
    const models = applyVerifiedModelProfiles((await store.get<Model[]>("models", job.provider)) ?? []);
    const profile = models.find((m) => m.id === job.model);
    if (!profile)
      throw new UserFacingError("Refresh provider models and select an available model");
    assertModelOptions(profile, job);
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
    const refs = await Promise.all(
        job.referenceIds.map(async (refId) => {
          const ref = await store.get<Reference>("references", refId);
          const blob = ref && (await store.getBlob(ref.blobKey));
          if (!blob) throw new UserFacingError("Reference file is missing");
          return blob.bytes;
        }),
      );
    const commit = () => store.put("jobs", id, attempt);
    if (options) {
      if (!(await options.admit(commit))) return;
    } else await commit();
    const { providerFailure } = await import("./provider-failure");
    let received = false;
    try {
      const { generate } = await import("../sources/providers");
      const result = await generate(job, key, refs, parsedProfile.data);
      received = true;
      const blobKey = `results/${await import("./schema").then((schema) => schema.hash(result.bytes))}`;
      const finished: Job = {
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
            outputFormat: job.outputFormat ?? "png",
            ...(job.frameCount !== undefined ? { frameCount: job.frameCount } : {}),
            ...(job.frameDurationMs !== undefined ? { frameDurationMs: job.frameDurationMs } : {}),
            usage: result.usage,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      };
      // A restart can finish publication after the durable blob and receipt exist.
      if (options) await store.put("api-results", id, finished);
      await store.putBlob(blobKey, result.bytes, result.mime, job.projectId);
      const current=await store.get<Job>("jobs",id);
      if(current?.attemptId===attempt.attemptId)await store.put("jobs", id, mergeApiResult(current,finished));
      if (result.adaptationError) await options?.failed(result.adaptationError);
    } catch (error) {
      // Once output is received, the local runner recovers storage failures from the receipt, never resubmits.
      // Without a runner (Cloudflare) there is no receipt, so the attempt is recorded as uncertain below.
      if (received && options) throw error;
      // The source's processing state gets the short reason and whether to stop;
      // the request keeps the provider's own reason for a definite rejection.
      const failure = providerFailure(error);
      const rejection = received ? undefined : await definiteRejectionMessage(error);
      await options?.failed(failure.error, failure.stop, failure.resumeAt);
      const current=await store.get<Job>("jobs",id);
      if(current?.attemptId===attempt.attemptId)await store.put("jobs", id, {
        ...current,
        status: rejection ? "failed" : failure.status,
        error: rejection ?? failure.error,
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
export async function refreshedJobs(existingService?: ImageService, selected?: Job[]) {
  const api = existingService ?? await service();
  const jobs = selected ?? await api.jobs();
  const localQueue = configuration("STORAGE_DRIVER") !== "cloudflare";
  let inspector: Promise<(job: Job) => Promise<Partial<Job>>> | undefined;
  const observeQueue = async () => {
    const [{ queueInspector }, { pathSettings }] = await Promise.all([
      import("../sources/queue"),
      import("./paths"),
    ]);
    return queueInspector((await pathSettings(api.store)).queueDirectory);
  };
  const observe = async (job:Job) => {
      if (
        job.source === "api" &&
        job.status === "running" &&
        Date.now() - Date.parse(job.startedAt!) > 300000 &&
        !(await api.store.get("api-inflight",job.id))
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
      const changed=Object.entries(change).some(([key,value])=>JSON.stringify(job[key as keyof Job])!==JSON.stringify(value));
      return {job,patch:changed ? change : undefined};
  };
  const results: Job[] = [];
  // A gallery refresh can see thousands of reservations. Bound file descriptors
  // and avoid taking a write lock for an unchanged observation.
  for(let i=0;i<jobs.length;i+=32){
    const batch=await Promise.all(jobs.slice(i,i+32).map(observe));
    for(const {job,patch} of batch)results.push(patch ? await applyObserved(api.store,job,patch) : job);
  }
  return results;
}

export async function refreshedJob(id: string, api?: ImageService) {
  api ??= await service();
  const job = await api.store.get<Job>("jobs", id);
  return job && (await refreshedJobs(api, [job]))[0];
}
