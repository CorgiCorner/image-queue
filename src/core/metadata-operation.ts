import type { Storage } from "../storage/types";

export type RecordWrite = {
  collection: string;
  id: string;
  value: unknown;
  merge?: boolean;
  unset?: string[];
};
type PendingOperation = {
  id: string;
  writes: RecordWrite[];
  complete: boolean;
};

async function pendingOperations(store: Storage) {
  return (await store.list<PendingOperation>("metadata-operations")).filter(
    (operation) => !operation.complete,
  );
}

async function applyOperation(store: Storage, operation: PendingOperation) {
  for (const write of operation.writes) {
    if (write.collection === "jobs" && await store.get("tombstones", write.id)) continue;
    let value = write.value;
    if (write.merge) {
      const current = await store.get<Record<string, unknown>>(
        write.collection,
        write.id,
      );
      const merged = { ...current, ...(value as Record<string, unknown>) };
      for (const field of write.unset ?? []) delete merged[field];
      value = merged;
    }
    await store.put(write.collection, write.id, value);
  }
  await store.put("metadata-operations", operation.id, {
    ...operation,
    writes: [],
    complete: true,
  });
}

async function lockJobs(
  store: Storage,
  writes: RecordWrite[],
  work: () => Promise<void>,
) {
  const ids = [
    ...new Set(
      writes
        .filter((write) => write.collection === "jobs")
        .map((write) => write.id),
    ),
  ].sort();
  const acquire = (index: number): Promise<void> =>
    index < ids.length
      ? store.lock(ids[index], () => acquire(index + 1))
      : work();
  return acquire(0);
}

/** Persist field patches so replay preserves independent changes made after a crash. */
export async function writeMetadata(
  store: Storage,
  writes: RecordWrite[],
  validate?: () => Promise<void>,
) {
  return store.lock("metadata-recovery", async () => {
    const pending = await pendingOperations(store);
    await lockJobs(
      store,
      [...pending.flatMap((operation) => operation.writes), ...writes],
      async () => {
        for (const operation of pending) await applyOperation(store, operation);
        await validate?.();
        const operation: PendingOperation = {
          id: crypto.randomUUID(),
          writes,
          complete: false,
        };
        await store.put("metadata-operations", operation.id, operation);
        await applyOperation(store, operation);
      },
    );
  });
}

export async function recoverMetadata(store: Storage) {
  if (!(await pendingOperations(store)).length) return;
  await store.lock("metadata-recovery", async () => {
    const pending = await pendingOperations(store);
    await lockJobs(
      store,
      pending.flatMap((operation) => operation.writes),
      async () => {
        for (const operation of pending) await applyOperation(store, operation);
      },
    );
  });
}
