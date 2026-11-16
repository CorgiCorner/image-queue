import { StorageLockBusy, type Storage } from "./types";

/**
 * Waits a bounded time for a busy lock instead of failing at once.
 * Only acquisition of `key` is retried: once `work` has started, anything it
 * throws, including a busy nested lock, propagates unchanged and `work` never
 * runs twice. After `waitMs` the last StorageLockBusy is thrown.
 */
export async function waitForLock<T>(
  store: Pick<Storage, "lock">,
  key: string,
  work: () => Promise<T>,
  waitMs: number,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (let attempt = 0; ; attempt++) {
    let started = false;
    try {
      return await store.lock(key, () => {
        started = true;
        return work();
      });
    } catch (error) {
      if (started || !(error instanceof StorageLockBusy) || error.key !== key) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw error;
      // Jitter keeps several waiters from retrying in lockstep.
      const ceiling = Math.min(5 * 2 ** Math.min(attempt, 5), 100);
      await new Promise(resolve => setTimeout(resolve, Math.min(remaining, ceiling / 2 + Math.random() * (ceiling / 2))));
    }
  }
}
