import { z } from "zod";
import { waitForLock } from "../storage/wait-for-lock";
import type { Storage } from "../storage/types";
import { MAX_WORKERS, poolConfig, type Pulse } from "./pool";
import { UserFacingError } from "./user-facing-error";
import { configuration } from "./config";

const sources = z.enum(["queue", "api"]);
export type ProcessingSource = z.infer<typeof sources>;
export const failurePolicy = z.object({
  limit: z.number().int().min(0).max(100),
  windowMinutes: z.number().int().min(1).max(10080),
});
export const processingInput = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("all"), paused: z.boolean() }),
  z.strictObject({
    source: sources,
    paused: z.boolean().optional(),
    workers: z.number().int().min(1).max(MAX_WORKERS).optional(),
    policy: failurePolicy.optional(),
  }),
]);
export type ProcessingChange = z.infer<typeof processingInput>;
const controls = z
  .object({
    workers: z.number().int().min(0).max(MAX_WORKERS),
    paused: z.boolean().optional(),
    blockedReason: z.string().optional(),
    blockedJobId: z.string().optional(),
    resumeAt: z.iso.datetime().optional(),
    policy: failurePolicy.optional(),
    failures: z.array(z.object({ id: z.string(), at: z.number() })).optional(),
    lastError: z.string().optional(),
    lastDelivery: z.string().optional(),
  })
  .passthrough();
const record = (source: ProcessingSource) =>
  source === "api" ? "api-runner" : "local-runner";
export const processingLock = <T>(store: Storage, work: () => Promise<T>) =>
  waitForLock(store, "processing-control", work, 30000);
export async function sourceControls(store: Storage, source: ProcessingSource) {
  const saved = controls.parse(
    (await store.get("settings", record(source))) ?? {
      workers: 1,
      paused: source === "queue",
    },
  );
  return {
    ...saved,
    workers: saved.workers || 1,
    paused: saved.paused ?? !saved.workers,
  };
}
export async function globalPause(store: Storage) {
  return (
    (await store.get<{ paused: boolean }>("settings", "processing"))?.paused ===
    true
  );
}
export async function admitted(store: Storage, source: ProcessingSource) {
  const state = await sourceControls(store, source);
  return !state.paused && !state.blockedReason && !(await globalPause(store));
}
export async function changeProcessing(
  store: Storage,
  input: ProcessingChange,
) {
  const change = processingInput.parse(input);
  if (configuration("STORAGE_DRIVER") === "cloudflare")
    throw new UserFacingError(
      "Queue processing controls require the local dashboard.",
    );
  if (configuration("EXECUTOR") === "scheduled" && change.source === "queue")
    throw new UserFacingError(
      "Manage scheduled Codex slots under Worker pool.",
    );
  await processingLock(store, async () => {
    if (change.source === "all") {
      await store.put("settings", "processing", { paused: change.paused });
      return;
    }
    const state = await sourceControls(store, change.source);
    if (change.paused === false) {
      delete state.blockedReason;
      delete state.blockedJobId;
      delete state.resumeAt;
      delete state.failures;
    }
    if (change.paused !== undefined) state.paused = change.paused;
    if (change.workers !== undefined) state.workers = change.workers;
    if (change.policy) {
      state.policy = change.policy;
      state.blockedReason ??= thresholdReason(state, Date.now());
    }
    await store.put("settings", record(change.source), state);
  });
}

function thresholdReason(state: z.infer<typeof controls>, now: number) {
  const policy = state.policy;
  if (!policy?.limit) return;
  const count =
    state.failures?.filter(
      (event) => event.at > now - policy.windowMinutes * 60000,
    ).length ?? 0;
  if (count >= policy.limit)
    return `${count} requests failed within ${policy.windowMinutes} minutes. Inspect the failures and resume this source.`;
}
export async function recordFailure(
  store: Storage,
  source: ProcessingSource,
  message: string,
  options: { id?: string; stop?: boolean; resumeAt?: string } = {},
  now = Date.now(),
) {
  return processingLock(store, async () => {
    const state = await sourceControls(store, source);
    state.lastError = message;
    if (options.id) {
      const recent = (state.failures ?? []).filter(
        (event) => event.at > now - 10080 * 60000 && event.id !== options.id,
      );
      state.failures = [...recent, { id: options.id, at: now }].slice(-100);
    }
    const budgetStop = thresholdReason(state, now);
    // A rolling-budget stop or credential rejection requires an explicit resume,
    // even if another active request receives a rate limit with a reset time.
    if (budgetStop && (!state.blockedReason || state.resumeAt)) {
      state.blockedReason = budgetStop;
      state.blockedJobId = options.id;
      delete state.resumeAt;
    } else if (
      options.stop &&
      (!state.blockedReason ||
        !options.resumeAt ||
        (state.resumeAt &&
          Date.parse(options.resumeAt) >= Date.parse(state.resumeAt)))
    ) {
      state.blockedReason = message;
      state.blockedJobId = options.id;
      state.resumeAt = options.resumeAt;
    }
    await store.put("settings", record(source), state);
    return state.blockedReason;
  });
}
export async function recordDelivery(
  store: Storage,
  source: ProcessingSource,
  deliveredAt = new Date().toISOString(),
) {
  await processingLock(store, async () => {
    const state = await sourceControls(store, source);
    await store.put("settings", record(source), {
      ...state,
      lastDelivery:
        state.lastDelivery && state.lastDelivery > deliveredAt
          ? state.lastDelivery
          : deliveredAt,
    });
  });
}
export async function resumeAfterReset(
  store: Storage,
  source: ProcessingSource,
  expected: string,
) {
  return processingLock(store, async () => {
    const state = await sourceControls(store, source);
    if (
      state.paused ||
      (await globalPause(store)) ||
      state.resumeAt !== expected ||
      Date.parse(expected) > Date.now()
    )
      return false;
    delete state.resumeAt;
    delete state.blockedReason;
    delete state.blockedJobId;
    await store.put("settings", record(source), state);
    return true;
  });
}
export async function processingStatus(store: Storage) {
  const paused = await globalPause(store);
  const read = async (source: ProcessingSource) => {
    const state = await sourceControls(store, source);
    const pulse = await store.get<{
      at: number;
      running: number;
      blockedReason?: string;
    }>("processing-heartbeats", source);
    const online = !!pulse && Date.now() - pulse.at < 30000;
    return {
      paused: state.paused,
      workers: state.workers,
      policy: state.policy ?? { limit: 0, windowMinutes: 60 },
      online,
      running: online ? pulse.running : 0,
      blockedReason:
        state.blockedReason ?? (online ? pulse.blockedReason : undefined),
      resumeAt: state.resumeAt,
      lastError: state.lastError,
      lastDelivery: state.lastDelivery,
    };
  };
  const queue = await read("queue");
  const scheduled = configuration("EXECUTOR") === "scheduled";
  if (scheduled) {
    const pool = await poolConfig(store);
    const pulses = await store.list<Pulse>("pulses");
    queue.workers = pool.workers;
    queue.paused = !pool.workers;
    queue.online = pulses.some(
      (p) =>
        p.slot <= pool.workers && Date.now() - Date.parse(p.lastWake) < 90000,
    );
    queue.blockedReason = undefined;
    queue.resumeAt = undefined;
  }
  return {
    paused,
    mode: scheduled ? ("scheduled" as const) : ("local" as const),
    queue,
    api: await read("api"),
  };
}
export type ProcessingStatus = Awaited<ReturnType<typeof processingStatus>>;
