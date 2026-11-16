import { UserFacingError } from "./user-facing-error";

export function requireReleaseProvider(provider: string) {
  if (provider !== "openai")
    throw new UserFacingError("Version 0.1.0 supports OpenAI only.");
}
