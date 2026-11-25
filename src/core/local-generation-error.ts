import { configuration } from "./config";
import { UserFacingError } from "./user-facing-error";

export const maxCodexReferences = 5;

export function codexReferenceLimitError(count: number) {
  if (count > maxCodexReferences)
    return `Local Codex accepts at most ${maxCodexReferences} reference images (got ${count}). Remove references and submit a new request.`;
}

export function localQueueReferenceLimitError(count: number) {
  if (configuration("EXECUTOR") !== "scheduled") return codexReferenceLimitError(count);
}

/** Carries the evidence available about whether Codex started generation. */
export class LocalGenerationError extends UserFacingError {
  constructor(
    readonly code: "reference_limit" | "missing_image",
    message: string,
    readonly uncertain = true,
  ) {
    super(message);
  }
}
