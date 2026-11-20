import { z } from "zod";
import { UserFacingError } from "./user-facing-error";

/** How many independent jobs one submission creates. Not stored on the job. */
export const requestCountSchema = z.number().int().min(1).max(10);
export const maxBatchImages = 20;

export function requestsForCount<T extends { idempotencyKey: string }>(request: T, count = 1): T[] {
  const parsed = requestCountSchema.safeParse(count);
  if (!parsed.success) throw new UserFacingError("Image count must be an integer from 1 to 10.");
  return Array.from({ length: parsed.data }, (_, index) => index === 0 ? request : {
    ...request,
    idempotencyKey: `${request.idempotencyKey}-${index + 1}`,
  });
}
