// @ts-ignore OpenNext generates this module during the Cloudflare build.
import handler from "./.open-next/worker.js";
// @ts-ignore OpenNext generates this module during the Cloudflare build.
import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { busyRetryDelaySeconds, maxBusyAttempts } from "./src/core/generation-queue";
import { maintainTrash } from "./src/core/maintenance";
import { abandonQueuedJob, runQueuedJob } from "./src/core/runtime";
import { CloudflareStorage } from "./src/storage/cloudflare";

type StorageBindings = ConstructorParameters<typeof CloudflareStorage>;
type GenerationQueue = { send(body: GenerationBody, options?: { delaySeconds?: number }): Promise<unknown> };
type GenerationBody = { jobId: string; attempt?: number };
type Environment = { DB: StorageBindings[0]; BLOBS: StorageBindings[1]; GENERATION_QUEUE?: GenerationQueue };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type GenerationMessage = { body: unknown; ack(): void };

/** Internal origin for queue work; it never receives network traffic. */
const queueOrigin = "https://generation-queue.invalid/";

export default {
  fetch: handler.fetch,
  async scheduled(event: { scheduledTime: number }, env: Environment) {
    await maintainTrash(new CloudflareStorage(env.DB, env.BLOBS), event.scheduledTime);
  },
  /**
   * Runs provider generation outside the request that created the job, so a
   * remote MCP client's time limit cannot cut an attempt short. Messages are
   * acknowledged after each attempt and never retried: a second delivery
   * could charge the provider twice.
   */
  async queue(batch: { messages: readonly GenerationMessage[] }, env: Environment, ctx: ExecutionContext) {
    for (const message of batch.messages) {
      const body = message.body as Partial<GenerationBody> | null;
      if (typeof body?.jobId === "string") {
        const jobId = body.jobId;
        const attempt = Number.isInteger(body.attempt) ? body.attempt! : 0;
        const inContext = <T>(work: () => Promise<T>) =>
          runWithCloudflareRequestContext(new Request(queueOrigin), env, ctx, work) as Promise<T>;
        if ((await inContext(() => runQueuedJob(jobId))) === "busy") {
          // Another operation holds the job. Nothing was sent to the provider,
          // so offering it again later cannot charge twice.
          if (attempt < maxBusyAttempts && env.GENERATION_QUEUE)
            await env.GENERATION_QUEUE.send({ jobId, attempt: attempt + 1 }, { delaySeconds: busyRetryDelaySeconds });
          else await inContext(() => abandonQueuedJob(jobId));
        }
      }
      message.ack();
    }
  },
};
