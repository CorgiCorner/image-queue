import { UserFacingError } from "../core/user-facing-error";
import type { Storage } from "./types";
import { hash, idSchema, type Job } from "../core/schema";
import { validateReference } from "../core/reference-validation";
import { configuredQueueRoot, queueOutput } from "../sources/queue";

export async function importProjectImages(store: Storage, projectId: string) {
  idSchema.parse(projectId);
  const jobs = (await store.list<Job>("jobs")).filter(job => job.projectId === projectId && job.status === "done" && !job.blobKey);
  let imported = 0;
  for (const candidate of jobs) {
    await store.lock(candidate.id, async () => {
      const job = await store.get<Job>("jobs", candidate.id);
      if (!job || job.projectId !== projectId || job.status !== "done" || job.blobKey) return;
      if (job.source !== "queue") throw new UserFacingError("Original image is unavailable");
      const bytes = await queueOutput(await configuredQueueRoot(), job);
      validateReference("image/png", bytes);
      const blobKey = `results/${await hash(bytes)}`;
      await store.putBlob(blobKey, bytes, "image/png");
      const saved = await store.getBlob(blobKey);
      if (!saved || await hash(saved.bytes) !== await hash(bytes)) throw new UserFacingError("Imported image verification failed");
      await store.put("jobs", job.id, { ...job, blobKey });
      imported++;
    });
  }
  return imported;
}
