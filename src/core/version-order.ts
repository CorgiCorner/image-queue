import type { Job } from "./schema";

export function orderedVersions(jobs: Job[]) {
  const numbered = jobs.every(job => job.versionNumber !== undefined);
  return [...jobs].sort((a, b) => numbered
    ? a.versionNumber! - b.versionNumber! || a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
