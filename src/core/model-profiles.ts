import { z } from "zod";
import { sizeProfileSchema } from "./size-intent";
import type { Model } from "./schema";

export const verifiedModelProfileSchema = z.object({
  provider: z.literal("openai"),
  model: z.string().regex(/^gpt-image(?:-|$)/),
  sizeProfile: sizeProfileSchema,
  references: z.boolean(),
  transparency: z.boolean(),
  documentation: z.string().url(),
  verifiedAt: z.iso.datetime(),
  evidence: z.object({
    generation: z.string().min(1),
    referenceEdit: z.string().min(1),
  }),
});
export type VerifiedModelProfile = z.infer<typeof verifiedModelProfileSchema>;

// Add entries only after generation and reference editing have both been verified.
export const verifiedModelProfiles: readonly VerifiedModelProfile[] = [{
  provider: "openai", model: "gpt-image-2.6-flare",
  references: true, transparency: false,
  sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
  documentation: "https://developers.openai.com/api/docs/models/gpt-image-2.6-flare",
  verifiedAt: "2026-11-15T22:53:22.827169Z",
  evidence: { generation: "docs/verification/gpt-image-2.6-flare.md#generation", referenceEdit: "docs/verification/gpt-image-2.6-flare.md#reference-edit" },
}, {
  provider: "openai", model: "gpt-image-1.5",
  references: true, transparency: true,
  sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }, { width: 1024, height: 1536 }] },
  documentation: "https://developers.openai.com/api/docs/models/gpt-image-1.5",
  verifiedAt: "2026-11-17T17:17:00Z",
  evidence: { generation: "docs/verification/gpt-image-1.5.md#generation", referenceEdit: "docs/verification/gpt-image-1.5.md#reference-edit" },
}];

export function applyVerifiedModelProfiles(
  models: Model[],
  profiles: readonly VerifiedModelProfile[] = verifiedModelProfiles,
): Model[] {
  const verified = profiles.map(profile => verifiedModelProfileSchema.parse(profile));
  return models.map(model => {
    const profile = verified.find(entry => entry.provider === model.provider && entry.model === model.id);
    if (profile) return { ...model, sizeProfile: profile.sizeProfile, references: profile.references, transparency: profile.transparency };
    // Cached discovery records are not evidence of supported generation options.
    const { sizeProfile: _unverifiedSizeProfile, ...unverified } = model;
    return unverified;
  });
}
