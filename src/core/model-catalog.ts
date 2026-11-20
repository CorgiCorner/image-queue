import type { Model } from "./schema";
import { sizeProfileSchema } from "./size-intent";
import { verifiedModelProfiles } from "./model-profiles";

/** Discovery alone establishes availability, not supported generation dimensions. */
export function modelsWithSizeProfiles(models: Model[]): Model[] {
  const rank = (model: Model) => {
    const index = verifiedModelProfiles.findIndex(entry => entry.model === model.id && entry.provider === model.provider);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const version = (model: Model) => /^gpt-image-(\d+(?:\.\d+)?)/.exec(model.id)?.[1];
  return models.filter(model => sizeProfileSchema.safeParse(model.sizeProfile).success)
    .sort((a, b) => {
      const aVersion = version(a), bVersion = version(b);
      if (aVersion && bVersion && aVersion !== bVersion)
        return bVersion.localeCompare(aVersion, undefined, { numeric: true });
      return rank(a) - rank(b);
    });
}

