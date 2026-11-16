import type { Job } from "./schema";

export const firstGenerationStorageKey = "image-queue-first-generation-celebrated";

const isGeneration = (job: Job) => job.status === "done" && !job.imported;

/** Ids of finished generations in a workspace snapshot. Imports do not count. */
export function finishedGenerations(jobs: readonly Job[]): Set<string> {
  return new Set(jobs.filter(isGeneration).map(job => job.id));
}

/**
 * The generation that finished between two snapshots, if the earlier snapshot had none.
 * A workspace that already held a finished generation when first seen is not a first success.
 */
export function firstFinishedGeneration(previous: ReadonlySet<string>, jobs: readonly Job[]): Job | undefined {
  if (previous.size > 0) return undefined;
  return jobs.find(isGeneration);
}
