import { UserFacingError } from "../core/user-facing-error";
import type { Storage } from "./types";
import { projectMigrationSchema, verifyProjectMigration } from "./verify-project-migration";

/** Verify ownership and the same complete manifest on the prepared copy. */
export async function verifyMigrationDestination(destination: Storage, input: unknown) {
  const operation = projectMigrationSchema.parse(input);
  const owner = await destination.get<{ projectId: string }>("settings", "project-owner");
  if (owner?.projectId !== operation.id) throw new UserFacingError("Migration destination ownership changed");
  return verifyProjectMigration(destination, operation);
}
