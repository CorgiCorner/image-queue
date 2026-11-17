import {
  admitted,
  processingLock,
  recordDelivery,
  recordFailure,
  resumeAfterReset,
  sourceControls,
} from "./processing";
import { executeImageJob, mergeApiResult } from "./runtime";
import { hash, type Job } from "./schema";
import { UserFacingError } from "./user-facing-error";
import { StorageLockBusy, type Storage } from "../storage/types";

interface Ticket {
  id: string;
  createdAt: string;
}
export async function waitingApiCount(store: Storage) {
  const waiting = (job: Job | undefined) =>
    job?.source === "api" &&
    job.status === "queued" &&
    !job.trashedAt &&
    !job.archivedAt;
  // Older installations can be inspected before the dashboard has migrated them.
  if (!(await store.get("settings", "api-ticket-migration")))
    return (await store.list<Job>("jobs")).filter(waiting).length;
  const tickets = await store.list<Ticket>("api-pending");
  let count = 0;
  for (let i = 0; i < tickets.length; i += 32) {
    const batch = await Promise.all(
      tickets.slice(i, i + 32).map(({ id }) => store.get<Job>("jobs", id)),
    );
    count += batch.filter(waiting).length;
  }
  return count;
}

export async function startApiRunner(store: Storage, pollMs = 2000) {
  const active = new Map<string, Promise<void>>();
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let backlog: Ticket[] = [];
  let cursor = 0;
  let heartbeatAt = 0;
  const generating = new Set<string>();
  let ready!: () => void;
  let startupFailed!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve;
    startupFailed = reject;
  });
  let release!: () => void;
  const ending = new Promise<void>((resolve) => {
    release = resolve;
  });

  async function reconcile(id: string, error?: unknown) {
    await store.lock(id, async () => {
      let job = await store.get<Job>("jobs", id);
      if (
        job?.source === "api" &&
        (job.status === "running" ||
          (job.status === "queued" && (job.startedAt || job.attemptId)))
      ) {
        const result = await store.get<Job>("api-results", id);
        const blob =
          result?.attemptId === job.attemptId &&
          result?.id === job.id &&
          result?.blobKey
            ? await store.getBlob(result.blobKey)
            : undefined;
        if (
          result &&
          blob &&
          result.blobKey === `results/${await hash(blob.bytes)}`
        ) {
          job = mergeApiResult(job, result);
        } else {
          const message =
            "Execution was interrupted. Verify the provider result before retrying.";
          await recordFailure(store, "api", message, { id });
          job = {
            ...job,
            status: "uncertain",
            error: message,
            updatedAt: new Date().toISOString(),
          };
        }
        await store.put("jobs", id, job);
      }
      if (job?.status === "queued" && !job.archivedAt && !job.trashedAt) {
        if (error === undefined) {
          await store.delete("api-inflight", id);
          return;
        }
        if (!(error instanceof UserFacingError)) throw error;
        await recordFailure(store, "api", error.message, {
          id,
          stop: /credential store|connect this provider/i.test(error.message),
        });
        job = {
          ...job,
          status: "blocked",
          error: error.message,
          updatedAt: new Date().toISOString(),
        };
        await store.put("jobs", id, job);
      }
      if (job?.status === "done")
        await recordDelivery(store, "api", job.updatedAt);
      await store.delete("api-inflight", id);
      await store.delete("api-pending", id);
      await store.delete("api-results", id);
    });
  }

  async function run(id: string) {
    try {
      await executeImageJob(id, store, {
        admit: (commit) =>
          processingLock(store, async () => {
            if (
              stopped ||
              !(await admitted(store, "api")) ||
              active.size > (await sourceControls(store, "api")).workers
            )
              return false;
            await store.put("api-inflight", id, { id });
            await commit();
            generating.add(id);
            return true;
          }),
        failed: async (message, stop, resumeAt) => {
          await recordFailure(store, "api", message, { id, stop, resumeAt });
        },
      });
      await reconcile(id);
    } catch (error) {
      // The producer or another job action can still hold this particular record.
      // Keep its ticket and retry acquisition on a later pass.
      if (error instanceof StorageLockBusy) return;
      try {
        await reconcile(id, error);
      } catch (storageError) {
        if (!(storageError instanceof StorageLockBusy))
          await recordFailure(
            store,
            "api",
            "API processing could not save queue state. Check storage, then resume.",
            { stop: true },
          );
      }
    }
  }

  async function scan() {
    if (stopped || busy) return;
    busy = true;
    try {
      if (Date.now() - heartbeatAt >= 5000) {
        heartbeatAt = Date.now();
        await store.put("processing-heartbeats", "api", {
          at: heartbeatAt,
          running: generating.size,
        });
      }
      const config = await sourceControls(store, "api");
      if (config.resumeAt && Date.parse(config.resumeAt) <= Date.now())
        await resumeAfterReset(store, "api", config.resumeAt);
      if (active.size >= config.workers || !(await admitted(store, "api")))
        return;
      if (cursor >= backlog.length) {
        backlog = (await store.list<Ticket>("api-pending")).sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
        cursor = 0;
      }
      while (
        !stopped &&
        active.size < config.workers &&
        cursor < backlog.length
      ) {
        const { id } = backlog[cursor++];
        if (active.has(id)) continue;
        active.set(
          id,
          run(id)
            .catch(() =>
              console.error("Could not record API processing status."),
            )
            .finally(() => {
              generating.delete(id);
              active.delete(id);
              if (cursor < backlog.length) wake();
            }),
        );
      }
    } finally {
      busy = false;
    }
  }
  function wake() {
    void scan().catch(() =>
      console.error("Could not inspect API queue. Will check again."),
    );
  }

  const lifetime = store.lock("api-executor", async () => {
    // Upgrade old installations once. Subsequent submissions persist a ticket under
    // the job lock before writing the job. Existing attempts never become new sends.
    if (!(await store.get("settings", "api-ticket-migration"))) {
      const localMachine = await (await import("./machine")).machineId(store);
      for (const job of await store.list<Job>("jobs")) {
        if (
          job.source === "api" &&
          !job.imported &&
          (!job.originMachine || job.originMachine === localMachine) &&
          ["queued", "running"].includes(job.status)
        ) {
          if (!(await store.get("api-pending", job.id)))
            await store.put("api-pending", job.id, {
              id: job.id,
              createdAt: job.createdAt,
            });
          if (job.status === "running" || job.attemptId || job.startedAt)
            await store.put("api-inflight", job.id, { id: job.id });
        }
      }
      await store.put("settings", "api-ticket-migration", { version: 1 });
    }
    // Inspect receipts even while paused. Recovery never submits a generation.
    for (const ticket of await store.list<{ id: string }>("api-inflight")) {
      try {
        await reconcile(ticket.id);
      } catch (error) {
        if (!(error instanceof StorageLockBusy)) throw error;
      }
    }
    await scan();
    timer = setInterval(wake, pollMs);
    timer.unref?.();
    ready();
    await ending;
  });
  void lifetime.catch(startupFailed);
  await started;
  return {
    wake,
    async stop() {
      stopped = true;
      clearInterval(timer);
      while (busy) await new Promise((resolve) => setTimeout(resolve, 10));
      await Promise.all(active.values());
      try {
        await store.delete("processing-heartbeats", "api");
      } finally {
        release();
        await lifetime;
      }
    },
  };
}
