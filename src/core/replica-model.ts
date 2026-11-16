import { z } from "zod";
import { idSchema } from "./ids";
import { versionStampSchema } from "./hybrid-clock";

// Explicitly classified domain records; credentials, indexes and operation journals are excluded.
export const replicaKindSchema = z.enum(["projects", "jobs", "references", "topics", "notes", "pins"]);
export type ReplicaKind = z.infer<typeof replicaKindSchema>;
export const replicaIdentitySchema = z.object({
  globalId: z.string().regex(/^G-[a-f0-9]{64}$/),
  originMachine: idSchema,
  createdVersion: versionStampSchema,
});
export const replicaIdentityFields = replicaIdentitySchema.partial();
export type ReplicaIdentity = z.infer<typeof replicaIdentitySchema>;

