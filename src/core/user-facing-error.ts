import { ZodError } from "zod";

/** Only application-owned messages may cross a client boundary. */
export class UserFacingError extends Error {
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map(issue => issue.message).join("; ");
  return error instanceof UserFacingError
    ? error.message
    : "The operation could not be completed. Try again.";
}
