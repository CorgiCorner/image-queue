import type { Job } from "./schema";
/** Give clients a concrete recovery path without guessing whether generation happened. */
export function jobRecovery(job: Pick<Job, "status" | "error">) {
  if (job.status === "uncertain") return { action: "inspect_result", automaticRetryAllowed: false, message: "Generation may have happened. Inspect the existing result and obtain acknowledgement before retry_image with acknowledgeUncertain." };
  if (job.status === "blocked" && /reference.*(?:not a supported|missing|unsupported)|unsupported reference/i.test(job.error ?? "")) return {
    action: "repair_references", automaticRetryAllowed: true,
    message: "This request was blocked before generation. Repair missing references or convert unsupported files to real PNG, JPEG or WebP. Import the corrected files with add_reference and submit a corrected request once with a new idempotencyKey. Do not retry the unchanged invalid references or duplicate a replacement already queued.",
  };
  if (job.status === "blocked" || job.status === "failed") return { action: "inspect_error", automaticRetryAllowed: false, message: "Read the error and fix its cause before retrying. Do not repeat an unchanged failing request." };
  return undefined;
}
