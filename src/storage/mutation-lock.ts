import { realpath } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Storage } from "./types";

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

/** Nested writes in one operation share its lock; other operations still contend. */
export async function mutationLock<T>(store: Storage, identity: string, work: () => Promise<T>): Promise<T> {
  const root = (store as Storage & { root?: string }).root;
  const key = root ? await realpath(root) : identity;
  const held = heldLocks.getStore();
  if (held?.has(key)) return work();
  return store.lock("project-mutations", () => heldLocks.run(new Set([...(held ?? []), key]), work));
}
