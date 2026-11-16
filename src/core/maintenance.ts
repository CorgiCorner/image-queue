import type { Storage } from "../storage/types";
import { purgeExpiredTrash, recoverPurges } from "./purge";

export async function maintainTrash(store: Storage, now = Date.now()) {
  await recoverPurges(store);
  return purgeExpiredTrash(store, now);
}

export function startTrashMaintenance(
  getStore: () => Promise<Storage>,
  reportFailure: () => void,
  intervalMs = 60 * 60 * 1000,
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await maintainTrash(await getStore());
    } catch {
      reportFailure();
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
