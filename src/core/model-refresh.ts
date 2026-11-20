import { discoverModels } from "../sources/providers";
import type { Storage } from "../storage/types";
import { modelsWithSizeProfiles } from "./model-catalog";
import { applyVerifiedModelProfiles } from "./model-profiles";
import type { Model, Provider } from "./schema";
import { readKey } from "./settings";
import { UserFacingError } from "./user-facing-error";

/**
 * Rediscovers the provider's image models with the server's configured key and
 * saves the catalog. Sizes saved earlier are kept for models that have no
 * verified profile. Nothing is generated and no key is returned.
 */
export async function refreshModelCatalog(store: Storage, provider: Provider) {
  const discovered = await discoverModels(provider, await readKey(store, provider));
  if (!discovered.length)
    throw new UserFacingError("The provider answered, but no supported image models are available for this key.");
  const previous = await store.get<Model[]>("models", provider);
  const storedProfiles = new Map(previous?.map(model => [model.id, model.sizeProfile]));
  const models = applyVerifiedModelProfiles(discovered.map(model => ({
    ...model,
    sizeProfile: model.sizeProfile ?? storedProfiles.get(model.id),
  })));
  await store.put("models", provider, models);
  return modelsWithSizeProfiles(models);
}
