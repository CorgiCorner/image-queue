import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import { idSchema, type Job, type Reference } from "./schema";

export const purgeInput = z.object({
  ids: z.array(idSchema).min(1).max(1000),
  removeExternal: z.boolean().optional(),
});

export function planPurge(jobs: Job[], references: Reference[], ids: string[]) {
  const selectedIds = new Set(purgeInput.parse({ ids }).ids);
  const selected = jobs.filter(job => selectedIds.has(job.id));
  if (selected.length !== selectedIds.size) throw new UserFacingError("Selected image no longer exists");
  if (selected.some(job => !job.trashedAt || ["queued", "running"].includes(job.status))) {
    throw new UserFacingError("Only terminal jobs in Trash can be permanently deleted");
  }
  const retainedKeys = new Set([
    ...jobs.filter(job => !selectedIds.has(job.id)).flatMap(job => [job.blobKey, job.thumbnailKey]),
    ...references.map(reference => reference.blobKey),
  ].filter((key): key is string => Boolean(key)));
  const blobKeys = [...new Set(selected.flatMap(job => [job.blobKey, job.thumbnailKey]))]
    .filter((key): key is string => Boolean(key) && !retainedKeys.has(key!));
  return { ids: selected.map(job => job.id), blobKeys };
}
