import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import type { Storage } from "@/storage/types";
export const MAX_WORKERS = 5;
export const workerModels = [
  { value: "gpt-6.1-sol", label: "Sol 6.1" },
  { value: "gpt-6.1-terra", label: "Terra 6.1" },
  { value: "gpt-6-luna", label: "Luna 6" },
] as const;
export const workerEfforts = ["low", "medium", "high", "xhigh"] as const;
export const poolSchema = z
  .object({
    workers: z.number().int().min(0).max(MAX_WORKERS),
    idleMinutes: z.number().int().min(1).max(60),
    activeMinutes: z.number().int().min(1).max(60),
    activityWindowMinutes: z.number().int().min(1).max(120),
    workerModel: z.enum(["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]).optional(),
    workerEffort: z.enum(workerEfforts).optional(),
  })
  .refine(
    (value) => value.activeMinutes <= value.idleMinutes,
    "Active interval must not exceed idle interval",
  );
export type PoolConfig = z.infer<typeof poolSchema>;
export function workerConfigurationPrompt(config: PoolConfig) {
  const checked = poolSchema.parse(config);
  return `Update my existing image-queue worker chats to model ${checked.workerModel ?? "gpt-6.1-sol"}, reasoning effort ${checked.workerEffort ?? "low"}, Fast (priority). Keep at most ${checked.workers} worker slots active. Preserve each chat's identity, schedule, shared WORKER.md prompt and notification settings. Finish existing reservations before disabling a slot; never delete or reset claims. Do not create extra workers or start generation for this configuration change. Read back the resulting schedules and verify the actual chat model and effort. If a model is unavailable, report it instead of substituting another model.`;
}
export type Pulse = {
  workerInstructionsVersion?: string;
  slot: number;
  workerId: string;
  lastWake: string;
  lastRun?: string;
  lastClaim?: string;
  queueHash: string;
  activeUntil: number;
  allowed: boolean;
  draining: boolean;
  nextEligible: number;
  mode: "active" | "idle" | "disabled";
};
export const defaultPool: PoolConfig = {
  workers: 4,
  idleMinutes: 5,
  activeMinutes: 1,
  activityWindowMinutes: 10,
};
export async function poolConfig(store: Storage) {
  return poolSchema.parse(
    (await store.get("settings", "worker-pool")) ?? defaultPool,
  );
}
export async function savePoolConfig(store: Storage, input: unknown) {
  const config = poolSchema.parse(input);
  await store.put("settings", "worker-pool", config);
  return config;
}
export async function tickPool(
  store: Storage,
  input: {
    slot: number;
    workerId: string;
    queueHash: string;
    hasReservation: boolean;
    workerInstructionsVersion?: string;
    now: number;
  },
) {
  if (
    !Number.isInteger(input.slot) ||
    input.slot < 1 ||
    input.slot > MAX_WORKERS
  )
    throw new UserFacingError("Invalid worker slot");
  return store.lock(`pool-slot-${input.slot}`, async () => {
    const config = await poolConfig(store);
    const previous = await store.get<Pulse>("pulses", String(input.slot));
    if (previous && previous.workerId !== input.workerId)
      throw new UserFacingError("Slot belongs to another worker");
    const changed =
      previous !== undefined && previous.queueHash !== input.queueHash;
    const activeUntil = changed
      ? input.now + config.activityWindowMinutes * 60000
      : (previous?.activeUntil ?? 0);
    const globallyPaused = (await store.get<{paused:boolean}>("settings","processing"))?.paused === true;
    const enabled = !globallyPaused && input.slot <= config.workers;
    const interval =
      activeUntil > input.now ? config.activeMinutes : config.idleMinutes;
    const nextEligible = previous?.lastRun
      ? Date.parse(previous.lastRun) + interval * 60000
      : 0;
    const allowed =
      input.hasReservation || (enabled && input.now >= nextEligible);
    const pulse: Pulse = {
      ...previous,
      ...(input.workerInstructionsVersion ? { workerInstructionsVersion: z.string().regex(/^image-queue-worker-v\d+$/).parse(input.workerInstructionsVersion) } : {}),
      slot: input.slot,
      workerId: input.workerId,
      lastWake: new Date(input.now).toISOString(),
      queueHash: input.queueHash,
      activeUntil,
      allowed,
      draining: !enabled && input.hasReservation,
      nextEligible: allowed ? input.now + interval * 60000 : nextEligible,
      mode: enabled
        ? activeUntil > input.now
          ? "active"
          : "idle"
        : "disabled",
      ...(allowed ? { lastRun: new Date(input.now).toISOString() } : {}),
    };
    await store.put("pulses", String(input.slot), pulse);
    return pulse;
  });
}
export async function finishPool(
  store: Storage,
  input: {
    slot: number;
    workerId: string;
    queueHash: string;
    claimedAt?: string;
    now: number;
  },
) {
  return store.lock(`pool-slot-${input.slot}`, async () => {
    const pulse = await store.get<Pulse>("pulses", String(input.slot));
    if (!pulse || pulse.workerId !== input.workerId)
      throw new UserFacingError("Slot belongs to another worker");
    const config = await poolConfig(store);
    const updated = {
      ...pulse,
      queueHash: input.queueHash,
      ...(input.claimedAt && input.claimedAt !== pulse.lastClaim
        ? {
            lastClaim: input.claimedAt,
            activeUntil: input.now + config.activityWindowMinutes * 60000,
            nextEligible: input.now + config.activeMinutes * 60000,
          }
        : {}),
    };
    await store.put("pulses", String(input.slot), updated);
    return updated;
  });
}
