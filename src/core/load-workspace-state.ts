import { platformSupport } from "./platform-support";
import { applyVerifiedModelProfiles } from "./model-profiles";
import { configuration } from "@/core/config";
import { localMcpLaunch } from "./mcp-launch";
import { type Pulse, poolConfig } from "@/core/pool";
import { refreshedJobs, service } from "@/core/runtime";
import type { Model, Reference } from "@/core/schema";
import type { ImageNote } from "./notes";
import type { Pin, Topic } from "./organization";

export async function loadWorkspaceState() {
  const api = await service();
  const { store } = api;
  const cloud = configuration("STORAGE_DRIVER") === "cloudflare";
  const { importExistingQueue } = await import("@/core/import-queue");
  await importExistingQueue(store);

  const [
    projects, jobs, references, models, metadata, topics,
    paths, pool, pulses, notes, stackCounters, pins,
  ] = await Promise.all([
    api.projects(),
    refreshedJobs(api),
    store.list<Reference>("references"),
    store.list<Model[]>("models"),
    store.list<{ id: string; dominantColor: string }>("asset-meta"),
    store.list<Topic>("topics"),
    cloud ? undefined : import("./paths").then(({ pathSettings }) => pathSettings(store)),
    poolConfig(store),
    store.list<Pulse>("pulses"),
    store.list<ImageNote>("notes"),
    store.list<{ id: string; lastVersion: number }>("stack-counters"),
    store.list<Pin & { removed?: boolean }>("pins"),
  ]);
  const colors = new Map(metadata.map(entry => [entry.id, entry.dominantColor]));

  const localRunner=(globalThis as typeof globalThis & {imageQueueLocalRunner?: {status():{mode:string;running:number;enabled:number;desiredWorkers?:number;paused?:boolean;blockedReason?:string;blockedJobId?:string;canResume?:boolean;resumeAt?:string}}}).imageQueueLocalRunner?.status();
  return {
    localRunner,
    providerCheckedAt: (await store.get<{checkedAt?:string}>("connection-checks","openai"))?.checkedAt,
    codexConnection: await store.get<{login:string;checkedAt:string}>("connection-checks","codex"),
    processing: cloud ? undefined : await (await import("./processing")).processingStatus(store),
    generationSource: await (await import("./generation-preference")).readGenerationPreference(store),
    platformSupport: cloud ? undefined : platformSupport(process.platform, process.arch),
    mcpLaunch: cloud || !paths ? undefined : localMcpLaunch(paths, await (await import("../storage/node-executable")).nodeExecutable()),
    paths,
    pool: localRunner ? {...pool,workers:localRunner.desiredWorkers??localRunner.enabled} : pool,
    pulses,
    notes,
    stackCounters,
    topics: topics.filter(topic => !topic.deleted),
    pins: pins.filter(pin => !pin.removed),
    projects,
    jobs: jobs.map(job => ({ ...job, dominantColor: colors.get(job.id) })),
    references,
    models: applyVerifiedModelProfiles(models.flat()),
    cloud,
  };
}
