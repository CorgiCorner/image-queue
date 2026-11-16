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
