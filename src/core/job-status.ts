import type { Job } from "./schema";

export const jobStatusLabels: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Generating",
  done: "Ready",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
  uncertain: "Result uncertain",
};

export function isReserved(job: Pick<Job, "source" | "status" | "claim">) {
  return job.source === "queue" && job.status === "running" && job.claim?.reserved === true;
}

/**
 * A finished image, or a generated one that could not be adapted to the
 * requested size: that file was saved and blocked only for review.
 */
export function hasSavedResult(job: Pick<Job, "status" | "blobKey">) {
  return job.status === "done" || (job.status === "blocked" && Boolean(job.blobKey));
}
