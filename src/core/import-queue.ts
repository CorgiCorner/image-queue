import { createRecordIdentity } from "./replica-identity";
import { configuration } from "@/core/config";
import { StorageLockBusy, type Storage } from "@/storage/types";
import { hash, type Job } from "./schema";

const importedVersions = new Map<string, string>();
const pendingImports = new Map<string, Promise<void>>();
export async function importExistingQueue(store: Storage) {
  if (configuration("STORAGE_DRIVER") === "cloudflare") return;
  const { configuredQueueRoot, parseQueue, queueBlockReason, readQueueDimensions, readQueueSnapshot } = await import(
    "@/sources/queue"
  );
  const root = await configuredQueueRoot(store);
  const cacheKey = `${root}:${configuration("STORAGE_DIR") ?? process.cwd()}`;
  const pending = pendingImports.get(cacheKey);
  if (pending) return pending;
  const importing = importSnapshot();
  pendingImports.set(cacheKey, importing);
  try { await importing; }
  finally { pendingImports.delete(cacheKey); }

  async function importSnapshot() {
    const snapshot = await readQueueSnapshot(root);
    if (!snapshot) return;
    const { text } = snapshot;
    const version = await hash(text);
    if (importedVersions.get(cacheKey) === version) return;
    const entries = parseQueue(text);
    if (!entries.length) {
      importedVersions.set(cacheKey, version);
      return;
    }
    // Preserve an established import destination without naming a user's project.
    const existingJobs = await store.list<Job>("jobs");
    const existingDestination = entries.map(entry => existingJobs.find(job => job.id === entry.id && job.source === "queue")?.projectId).find(Boolean);
    const id = existingDestination ?? "queue-import";
    if (!(await store.get("projects", id)))
      await store.put("projects", id, {
        ...await createRecordIdentity(store, "projects", id),
        id,
        name: "Imported queue",
        createdAt: new Date().toISOString(),
      });
    let complete = true;
    for (const entry of entries) {
      try {
        await store.lock(entry.id, async () => {
          if (await store.get("tombstones", entry.id)) return;
          const reason = queueBlockReason(entry.status);
          const existing = await store.get<Job>("jobs", entry.id);
          if (existing) {
            if (existing.source === "queue" && existing.status === "done" &&
                !existing.generatedSize && !existing.blobKey && existing.outputPath === entry.outputPath) {
              const dimensions = await readQueueDimensions(root, existing);
              if (dimensions) await store.put("jobs", existing.id, { ...existing, ...dimensions });
            } else if (existing.source === "queue" && existing.status === "blocked" &&
                !existing.outputPath && reason && existing.error !== reason) {
              await store.put("jobs", existing.id, { ...existing, error: reason });
            }
            return;
          }
          const block = entry.body;
          const size = block.match(/^- Size: (\d+)[x×](\d+)/m);
          const createdAt =
            block.match(/^- Filed: (.+)/m)?.[1] ?? "2026-10-01T00:00:00Z";
          const status =
            entry.status === "pending"
              ? "queued"
              : entry.status === "in-progress"
                ? "running"
                : entry.status.startsWith("blocked")
                  ? "blocked"
                  : entry.status;
          if (
            !["queued", "running", "done", "blocked", "cancelled"].includes(status)
          )
            return;
          const identity = await createRecordIdentity(store, "jobs", entry.id);
          const job: Job = {
            ...identity,
            machineId: identity.originMachine,
            id: entry.id,
            idempotencyKey: entry.id.slice(4),
            projectId: id,
            prompt: entry.prompt || entry.id,
            source: "queue",
            provider: "openai",
            model: "",
            width: Number(size?.[1] ?? 1024),
            height: Number(size?.[2] ?? 1024),
            transparent: block.includes("- Background: transparent"),
            referenceIds: [],
            createdAt,
            updatedAt: createdAt,
            status: status as Job["status"],
            error: reason,
            outputPath: entry.outputPath,
            requestHash: await hash(entry.prompt),
          };
          const dimensions = job.status === "done" ? await readQueueDimensions(root, job) : undefined;
          await store.put("jobs", job.id, { ...job, ...dimensions });
        });
      } catch (error) {
        if (!(error instanceof StorageLockBusy) || error.key !== entry.id) throw error;
        complete = false;
      }
    }
    if (complete) importedVersions.set(cacheKey, version);
  }
}
