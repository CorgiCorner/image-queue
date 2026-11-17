import type { Job } from "./schema";
export function isSizeMismatchError(error?: string) {
  return /too small.*(?:size|upscaling)|could not be fitted.*dimensions/i.test(error ?? "");
}
export const sizeMismatchRecoveryMessage = "An image was generated, but it does not meet the requested dimensions. Inspect the retained original. Resuming the queue will not repair this image; do not repeat the unchanged request. A new API request may be used with explicit approval for another charge.";
/** Give clients a concrete recovery path without guessing whether generation happened. */
export function jobRecovery(job: Pick<Job, "status" | "error"> & Partial<Pick<Job,"requestedSize"|"generatedSize"|"providerResultSize"|"width"|"height">>) {
  if (["uncertain", "failed", "blocked"].includes(job.status) && isSizeMismatchError(job.error)) return {
    action: "inspect_size_mismatch", generationCompleted: true, automaticRetryAllowed: false,
    requestedSize: job.requestedSize ?? (job.width && job.height ? {width:job.width,height:job.height} : undefined),
    actualSize: job.providerResultSize ?? job.generatedSize,
    message: sizeMismatchRecoveryMessage,
  };
  if (job.status === "uncertain") return { action: "inspect_result", automaticRetryAllowed: false, message: "Generation may have happened. Inspect the existing result and obtain acknowledgement before retry_image with acknowledgeUncertain." };
  if (job.status === "blocked" && /reference.*(?:not a supported|missing|unsupported)|unsupported reference/i.test(job.error ?? "")) return {
    action: "repair_references", automaticRetryAllowed: true,
    message: "This request was blocked before generation. Repair missing references or convert unsupported files to real PNG, JPEG or WebP. Import the corrected files with add_reference and submit a corrected request once with a new idempotencyKey. Do not retry the unchanged invalid references or duplicate a replacement already queued.",
  };
  if (job.status === "blocked" || job.status === "failed") return { action: "inspect_error", automaticRetryAllowed: false, message: "Read the error and fix its cause before retrying. Do not repeat an unchanged failing request." };
  return undefined;
}
