import { thumbnailWidths } from "./thumbnail-widths";
import type { Storage } from "../storage/types";
import type { Job, Reference } from "./schema";
import { expiredTrash } from "./retention";
import { planPurge, purgeInput } from "./purge-plan";

type PurgeOperation = {
  id: string;
  jobIds: string[];
  blobKeys: string[];
  thumbnailHashes?: string[];
  externalQueueRoot?: string;
  deletedAt: string;
  complete: boolean;
};

async function applyPurge(store: Storage, operation: PurgeOperation) {
  const ids = [...operation.jobIds].sort();
  const acquire = (index: number): Promise<string[]> => index < ids.length
    ? store.lock(ids[index], () => acquire(index + 1))
    : applyLockedPurge(store, operation);
  return acquire(0);
}

async function applyLockedPurge(store: Storage, operation: PurgeOperation) {
  const deletedIds = new Set<string>();
  for (const id of operation.jobIds) {
    const current = await store.get<Job>("jobs", id);
    if (current && (!current.trashedAt || ["queued", "running"].includes(current.status))) {
      continue;
    }
    if (operation.externalQueueRoot && current?.source === "queue" && current.status === "done" && current.outputPath && !current.blobKey) {
      const { deleteQueueOutput } = await import("../sources/queue");
      await deleteQueueOutput(operation.externalQueueRoot, current);
    }
    deletedIds.add(id);
    await store.put("tombstones", id, { id, deletedAt: operation.deletedAt });
    await store.delete("jobs", id);
    await store.delete("asset-meta", id);
  }
  for (const note of await store.list<{id:string;imageId:string}>("notes")) {
    if (deletedIds.has(note.imageId)) await store.delete("notes", note.id);
  }
  const jobs = await store.list<Job>("jobs");
  const references = await store.list<Reference>("references");
  const retainedKeys = new Set([
    ...jobs.flatMap(job => [job.blobKey, job.thumbnailKey]),
    ...references.map(reference => reference.blobKey),
  ]);
  const retainedMetadata = await store.list<{ hash: string }>("asset-meta");
  const retainedHashes = new Set(retainedMetadata.map(metadata => metadata.hash));
  for (const digest of operation.thumbnailHashes ?? []) {
    if (retainedHashes.has(digest)) continue;
    for (const size of thumbnailWidths) {
      await store.deleteBlob(`thumbs/${digest}/${size}.webp`);
    }
  }
  for (const key of operation.blobKeys) {
    if (!retainedKeys.has(key)) await store.deleteBlob(key);
  }
  await store.put("purge-operations", operation.id, { ...operation, complete: true });
  return [...deletedIds];
}

async function createPurge(store: Storage, ids: string[], externalQueueRoot?: string) {
  const plan = planPurge(await store.list<Job>("jobs"), await store.list<Reference>("references"), ids);
  const metadata = await Promise.all(plan.ids.map(id =>
    store.get<{ hash: string }>("asset-meta", id),
  ));
  const thumbnailHashes = [...new Set(metadata.flatMap(value => value ? [value.hash] : []))];
  const operation: PurgeOperation = {
    id: crypto.randomUUID(), jobIds: plan.ids, blobKeys: plan.blobKeys, thumbnailHashes,
    ...(externalQueueRoot ? { externalQueueRoot } : {}),
    deletedAt: new Date().toISOString(), complete: false,
  };
  await store.put("purge-operations", operation.id, operation);
  return applyPurge(store, operation);
}

export async function purgeJobs(store: Storage, ids: string[], externalQueueRoot?: string) {
  purgeInput.parse({ ids });
  return store.lock("stacks", async () => {
    const uniqueIds = [...new Set(ids)];
    await resumePendingPurges(store, new Set(uniqueIds));
    const remaining = await Promise.all(uniqueIds.map(async id => {
      if (await store.get<Job>("jobs", id)) return id;
      return await store.get("tombstones", id) ? undefined : id;
    }));
    const toPurge = remaining.filter((id): id is string => id !== undefined);
    const deleted = new Set(toPurge.length ? await createPurge(store, toPurge, externalQueueRoot) : []);
    return uniqueIds.filter((id, index) => remaining[index] === undefined || deleted.has(id));
  });
}

export async function purgeExpiredTrash(store: Storage, now = Date.now()) {
  return store.lock("stacks", async () => {
    const expired = expiredTrash(await store.list<Job>("jobs"), now);
    const deleted: string[] = [];
    for (let offset = 0; offset < expired.length; offset += 1000) {
      deleted.push(...await createPurge(store, expired.slice(offset, offset + 1000).map(job => job.id)));
    }
    return deleted;
  });
}

export async function recoverPurges(store: Storage) {
  const pending = (await store.list<PurgeOperation>("purge-operations")).some(operation => !operation.complete);
  if (!pending) return;
  return store.lock("stacks", () => resumePendingPurges(store));
}

async function resumePendingPurges(store: Storage, requestedIds?: ReadonlySet<string>) {
  for (const operation of await store.list<PurgeOperation>("purge-operations")) {
    if (operation.complete || (requestedIds && !operation.jobIds.some(id => requestedIds.has(id)))) continue;
    await applyPurge(store, operation);
  }
}
