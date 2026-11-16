import { realpath } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Storage } from "./types";
import { waitForLock } from "./wait-for-lock";

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();
/** Page loads, MCP processes and local workers share this lock; short writes wait their turn. */
export const MUTATION_LOCK_WAIT_MS = 10_000;

/** Nested writes in one operation share its lock; other operations wait a bounded time. */
export async function mutationLock<T>(store: Storage, identity: string, work: () => Promise<T>, waitMs = MUTATION_LOCK_WAIT_MS): Promise<T> {
  const root = (store as Storage & { root?: string }).root;
  const key = root ? await realpath(root) : identity;
  const held = heldLocks.getStore();
  if (held?.has(key)) return work();
  return waitForLock(store, "project-mutations", () => heldLocks.run(new Set([...(held ?? []), key]), work), waitMs);
}
