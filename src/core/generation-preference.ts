import { z } from "zod";
import type { Storage } from "../storage/types";
import type { Model } from "./schema";
import { applyVerifiedModelProfiles } from "./model-profiles";
import { modelsWithSizeProfiles } from "./model-catalog";
import { UserFacingError } from "./user-facing-error";
import { configuration } from "./config";

export const queueUnavailableMessage =
  "The Codex queue runs only in a local installation. This server generates with the API: use source \"api\".";

export const generationPreferenceSchema = z.object({
  source: z.enum(["queue", "api"]),
  provider: z.literal("openai").default("openai"),
  model: z.string().min(1).max(200).optional(),
});
export type GenerationPreference = z.infer<typeof generationPreferenceSchema>;

const hosted = () => configuration("STORAGE_DRIVER") === "cloudflare";

/** Configured OpenAI models with a verified size profile, preferred model first. */
async function verifiedModels(store: Storage) {
  return modelsWithSizeProfiles(applyVerifiedModelProfiles(await store.get<Model[]>("models", "openai") ?? []));
}

/**
 * The saved default for new requests. A Cloudflare deployment cannot run the
 * local Codex queue, so without a saved choice it defaults to the API and the
 * preferred configured model.
 */
export async function readGenerationPreference(store: Storage): Promise<GenerationPreference | undefined> {
  const parsed = generationPreferenceSchema.safeParse(await store.get("settings", "generation-source"));
  if (parsed.success && !(hosted() && parsed.data.source === "queue")) return parsed.data;
  if (!hosted()) return undefined;
  const model = (await verifiedModels(store))[0]?.id;
  return { source: "api", provider: "openai", ...(model ? { model } : {}) };
}

/** Changes the default for new requests only; never submits, resumes or retries work. */
export async function saveGenerationPreference(store: Storage, input: GenerationPreference) {
  const parsed = generationPreferenceSchema.parse(input);
  if (hosted() && parsed.source === "queue")
    throw new UserFacingError(queueUnavailableMessage);
  const previous = await readGenerationPreference(store);
  // Ordered by the registry, so the preferred model (gpt-image-2.6-sunburst) is the fallback.
  const models = await verifiedModels(store);
  if (parsed.model && !models.some(model => model.id === parsed.model)) {
    throw new UserFacingError("Choose a configured OpenAI image model with a verified size profile.");
  }
  const model = parsed.model ?? (models.some(model => model.id === previous?.model) ? previous?.model : models[0]?.id);
  const value = { ...parsed, ...(model ? { model } : {}) };
  await store.put("settings", "generation-source", value);
  return value;
}
