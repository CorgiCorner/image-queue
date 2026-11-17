import { z } from "zod";
import type { Storage } from "../storage/types";
import type { Model } from "./schema";
import { applyVerifiedModelProfiles } from "./model-profiles";
import { UserFacingError } from "./user-facing-error";

export const generationPreferenceSchema = z.object({
  source: z.enum(["queue", "api"]),
  provider: z.literal("openai").default("openai"),
  model: z.string().min(1).max(200).optional(),
});
export type GenerationPreference = z.infer<typeof generationPreferenceSchema>;

export async function readGenerationPreference(store: Storage) {
  const parsed = generationPreferenceSchema.safeParse(await store.get("settings", "generation-source"));
  return parsed.success ? parsed.data : undefined;
}

/** Changes the default for new requests only; never submits, resumes or retries work. */
export async function saveGenerationPreference(store: Storage, input: GenerationPreference) {
  const parsed = generationPreferenceSchema.parse(input);
  const previous = await readGenerationPreference(store);
  const models = applyVerifiedModelProfiles(await store.get<Model[]>("models", "openai") ?? [])
    .filter(model => model.sizeProfile);
  if (parsed.model && !models.some(model => model.id === parsed.model)) {
    throw new UserFacingError("Choose a configured OpenAI image model with a verified size profile.");
  }
  const model = parsed.model ?? (models.some(model => model.id === previous?.model) ? previous?.model : models[0]?.id);
  const value = { ...parsed, ...(model ? { model } : {}) };
  await store.put("settings", "generation-source", value);
  return value;
}
