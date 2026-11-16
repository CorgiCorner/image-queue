import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import type { Storage } from "../storage/types";
import type { Job } from "./schema";
export const pathsSchema = z.object({
  queueDirectory: z.string().trim().min(1).max(4096),
  referenceDirectories: z
    .array(z.string().trim().min(1).max(4096))
    .min(1)
    .max(20),
});
export type PathSettings = z.infer<typeof pathsSchema>;
export async function pathSettings(store: Storage): Promise<PathSettings> {
  const { defaultPaths } = await import("../storage/path-settings");
  return pathsSchema.parse(
    (await store.get("settings", "paths")) ?? defaultPaths(),
  );
}
export async function savePaths(store: Storage, input: PathSettings) {
  const parsed = pathsSchema.parse(input);
  const { canonicalPaths } = await import("../storage/path-settings");
  return store.lock("path-settings", async () => {
    const next = await canonicalPaths(parsed);
    const configured = await pathSettings(store);
    const current = await canonicalPaths(configured).catch(() => configured);
    if (
      next.queueDirectory !== current.queueDirectory &&
      (await store.list<Job>("jobs")).some(
        (job) => job.source === "queue" && job.outputPath,
      )
    )
      throw new UserFacingError(
        "This workspace contains jobs from its current queue. Use a separate workspace storage directory to connect another queue.");
    await store.put("settings", "paths", next);
    return next;
  });
}
