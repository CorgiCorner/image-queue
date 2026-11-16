import type { Storage } from "./types";

/** Read a collection across project stores without silently choosing conflicting records. */
export async function readProjectRecords<T>(stores: Storage[], collection: string) {
  const records = new Map<string, T>();
  for (const store of stores) {
    for (const entry of await store.entries<T>(collection)) {
      if (records.has(entry.id) && JSON.stringify(records.get(entry.id)) !== JSON.stringify(entry.value))
        throw new Error(`Conflicting project record: ${collection}/${entry.id}`);
      records.set(entry.id, entry.value);
    }
  }
  return [...records].map(([id, value]) => ({ id, value }));
}
