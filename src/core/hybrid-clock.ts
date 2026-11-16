import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import { idSchema } from "./ids";
import type { Storage } from "../storage/types";
import { StorageLockBusy } from "../storage/types";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const hybridClockSchema = z.object({ wallTime: integer, logical: integer }).strict();
export type HybridClock = z.infer<typeof hybridClockSchema>;
export const versionStampSchema = z.object({ clock: hybridClockSchema, changedBy: idSchema }).strict();
export type VersionStamp = z.infer<typeof versionStampSchema>;

/** Advance after all observed events, even when the local wall clock moves backwards. */
export function nextHybridClock(now: number, previous?: HybridClock, observed?: HybridClock): HybridClock {
  integer.parse(now);
  if (previous) hybridClockSchema.parse(previous);
  if (observed) hybridClockSchema.parse(observed);
  const wallTime = Math.max(now, previous?.wallTime ?? 0, observed?.wallTime ?? 0);
  const logical = Math.max(
    previous?.wallTime === wallTime ? previous.logical : -1,
    observed?.wallTime === wallTime ? observed.logical : -1,
  ) + 1;
  if (logical <= Number.MAX_SAFE_INTEGER) return { wallTime, logical };
  if (wallTime === Number.MAX_SAFE_INTEGER) throw new UserFacingError("Hybrid clock is exhausted");
  return { wallTime: wallTime + 1, logical: 0 };
}

export function compareVersions(left: VersionStamp, right: VersionStamp) {
  versionStampSchema.parse(left);
  versionStampSchema.parse(right);
  if (left.clock.wallTime !== right.clock.wallTime) return left.clock.wallTime < right.clock.wallTime ? -1 : 1;
  if (left.clock.logical !== right.clock.logical) return left.clock.logical < right.clock.logical ? -1 : 1;
  return left.changedBy === right.changedBy ? 0 : left.changedBy < right.changedBy ? -1 : 1;
}

/** The clock is local configuration, never a replica record or a provider request. */
export async function tickHybridClock(store: Storage, changedBy: string, observed?: HybridClock, now = Date.now()): Promise<VersionStamp> {
  idSchema.parse(changedBy);
  if (observed) hybridClockSchema.parse(observed);
  for (let attempt = 0; ; attempt++) {
    try {
      return await store.lock("sync-clock", async () => {
        const stored = await store.get<unknown>("settings", "sync-clock");
        const previous = stored === undefined ? undefined : hybridClockSchema.parse(stored);
        const clock = nextHybridClock(now, previous, observed);
        await store.put("settings", "sync-clock", clock);
        return { clock, changedBy };
      });
    } catch (error) {
      if (!(error instanceof StorageLockBusy) || error.key !== "sync-clock" || attempt >= 19) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(2 ** attempt, 20)));
    }
  }
}
