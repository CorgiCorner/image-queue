import { z } from "zod";
import { idSchema } from "./ids";
import { tickHybridClock } from "./hybrid-clock";
import { machineId } from "./machine";
import type { Storage } from "../storage/types";

import { replicaKindSchema, type ReplicaKind, type ReplicaIdentity } from "./replica-model";
export { replicaKindSchema, replicaIdentitySchema, replicaIdentityFields, type ReplicaKind, type ReplicaIdentity } from "./replica-model";
const localRecordIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,256}$/);

/** A separate namespace preserves IDs used in existing queue claims and output paths. */
export async function globalRecordId(kind: ReplicaKind, originMachine: string, localId: string) {
  replicaKindSchema.parse(kind);
  idSchema.parse(originMachine);
  localRecordIdSchema.parse(localId);
  const bytes = new TextEncoder().encode(JSON.stringify(["image-queue", 1, kind, originMachine, localId]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `G-${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createRecordIdentity(store: Storage, kind: ReplicaKind, localId: string): Promise<ReplicaIdentity> {
  const originMachine = idSchema.parse(await machineId(store));
  const globalId = await globalRecordId(kind, originMachine, localId);
  return { globalId, originMachine, createdVersion: await tickHybridClock(store, originMachine) };
}
