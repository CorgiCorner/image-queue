import { z } from "zod";
import { sizeProfileSchema, type SizeProfile } from "./size-intent";
import type { Model } from "./schema";
import { UserFacingError } from "./user-facing-error";

/** Values of the OpenAI Image API `quality` field. */
export const imageQualities = ["low", "medium", "high", "xhigh", "max", "auto"] as const;
export type ImageQuality = typeof imageQualities[number];
export const imageOutputFormats = ["png", "webp", "jpeg", "gif", "svg"] as const;
/** Values of the OpenAI Image API `complexity` field (GPT Image 2.6 only). */
export const imageComplexities = ["low", "medium", "high"] as const;
export type ImageComplexity = typeof imageComplexities[number];

export const verifiedModelProfileSchema = z.object({
  provider: z.literal("openai"),
  model: z.string().regex(/^gpt-image(?:-|$)/),
  sizeProfile: sizeProfileSchema,
  references: z.boolean(),
  transparency: z.boolean(),
  qualities: z.array(z.enum(imageQualities)).min(1),
  /** Accepted `complexity` values; empty when the model has no complexity setting. */
  complexities: z.array(z.enum(imageComplexities)),
  outputFormats: z.array(z.enum(imageOutputFormats)).min(1),
  /** Capabilities taken from the official documentation that no generation receipt has confirmed yet. */
  documentedOnly: z.array(z.string().trim().min(1)),
  documentation: z.string().url(),
  /** Date of the newest receipt, or of the documentation check for an entry without receipts. */
  verifiedAt: z.iso.datetime(),
  /** Receipts of a paid generation and reference edit; null when only documentation backs the entry. */
  evidence: z.object({
    generation: z.string().min(1),
    referenceEdit: z.string().min(1),
  }).nullable(),
}).refine(
  profile => profile.evidence !== null ||
    (profile.documentedOnly.includes("generation") && profile.documentedOnly.includes("reference edit")),
  { message: "A profile without receipts must list generation and reference edit as documentedOnly", path: ["documentedOnly"] },
);
export type VerifiedModelProfile = z.infer<typeof verifiedModelProfileSchema>;

// https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
// and the `size` field of https://developers.openai.com/api/reference/resources/images/methods/generate
const customSizes = (): SizeProfile => ({
  mode: "dimensions", minSide: 16, maxSide: 3840, multiple: 16,
  minPixels: 655_360, maxPixels: 8_294_400, minRatio: 1 / 3, maxRatio: 3,
});
const standardSizes = (): SizeProfile => ({
  mode: "fixed", sizes: [{ width: 1024, height: 1024 }, { width: 1024, height: 1536 }, { width: 1536, height: 1024 }],
});
const checkedAt = "2026-11-19T09:00:00Z";
const docs = (model: string) => `https://developers.openai.com/api/docs/models/${model}`;
const unreceipted = ["generation", "reference edit"];

/** GPT Image 2.6: complexity, SVG and GIF output; documented in the guide section "GPT-Image-2.6". */
const gptImage26 = (model: "gpt-image-2.6-sunburst" | "gpt-image-2.6-flare", receipts: VerifiedModelProfile["evidence"], documentedOnly: string[]): VerifiedModelProfile => ({
  provider: "openai", model, references: true, transparency: true, sizeProfile: customSizes(),
  qualities: ["low", "medium", "high", "xhigh", "max", "auto"],
  complexities: ["low", "medium", "high"],
  outputFormats: ["png", "webp", "jpeg", "gif", "svg"],
  documentedOnly, documentation: docs(model),
  verifiedAt: receipts ? "2026-11-15T22:53:22.827169Z" : checkedAt, evidence: receipts,
});
/** GPT Image 2.5 and its 2026-09-08 snapshot: xhigh/max quality, no complexity, raster formats only. */
const gptImage25 = (model: string, family: string): VerifiedModelProfile => ({
  provider: "openai", model, references: true, transparency: true, sizeProfile: customSizes(),
  qualities: ["low", "medium", "high", "xhigh", "max", "auto"], complexities: [],
  outputFormats: ["png", "webp", "jpeg"],
  documentedOnly: [...unreceipted, "sizes above 2560x1440 (experimental)"],
  documentation: docs(family), verifiedAt: checkedAt, evidence: null,
});
/** GPT Image 2 (deprecated) and its 2026-04-21 snapshot: custom sizes, quality up to high, transparency in preview. */
const gptImage2 = (model: string): VerifiedModelProfile => ({
  provider: "openai", model, references: true, transparency: true, sizeProfile: customSizes(),
  qualities: ["low", "medium", "high", "auto"], complexities: [],
  outputFormats: ["png", "webp", "jpeg"],
  documentedOnly: [...unreceipted, "transparent background (preview)"],
  documentation: docs("gpt-image-2"), verifiedAt: checkedAt, evidence: null,
});

// Capabilities are stored per model ID, never inherited across a family. An entry with
// receipts lists in documentedOnly what the receipts do not cover; an entry without
// receipts (evidence null) rests on the official documentation alone. Order sets the
// default: the first entry is preferred when no model is chosen.
export const verifiedModelProfiles: readonly VerifiedModelProfile[] = [
  gptImage26("gpt-image-2.6-sunburst", null, [...unreceipted]),
  gptImage26("gpt-image-2.6-flare", {
    generation: "docs/verification/gpt-image-2.6-flare.md#generation",
    referenceEdit: "docs/verification/gpt-image-2.6-flare.md#reference-edit",
  }, ["sizes other than 1024x1024", "transparent background", "quality xhigh and max", "complexity", "gif and svg output"]),
  gptImage25("gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst"),
  gptImage25("gpt-image-2.5-sunburst-2026-09-08", "gpt-image-2.5-sunburst"),
  gptImage25("gpt-image-2.5-flare", "gpt-image-2.5-flare"),
  gptImage25("gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-flare"),
  gptImage2("gpt-image-2"),
  gptImage2("gpt-image-2-2026-04-21"),
  {
    provider: "openai", model: "gpt-image-1.5",
    references: true, transparency: true, sizeProfile: standardSizes(),
    qualities: ["low", "medium", "high", "auto"], complexities: [],
    outputFormats: ["png", "webp", "jpeg"],
    documentedOnly: ["landscape 1536x1024"],
    documentation: docs("gpt-image-1.5"),
    verifiedAt: "2026-11-17T17:17:00Z",
    evidence: { generation: "docs/verification/gpt-image-1.5.md#generation", referenceEdit: "docs/verification/gpt-image-1.5.md#reference-edit" },
  },
  {
    provider: "openai", model: "gpt-image-1-mini",
    references: true, transparency: true, sizeProfile: standardSizes(),
    qualities: ["low", "medium", "high", "auto"], complexities: [],
    outputFormats: ["png", "webp", "jpeg"],
    documentedOnly: [...unreceipted, "transparent background"],
    documentation: docs("gpt-image-1-mini"), verifiedAt: checkedAt, evidence: null,
  },
];

export function applyVerifiedModelProfiles(
  models: Model[],
  profiles: readonly VerifiedModelProfile[] = verifiedModelProfiles,
): Model[] {
  const verified = profiles.map(profile => verifiedModelProfileSchema.parse(profile));
  return models.map(model => {
    const profile = verified.find(entry => entry.provider === model.provider && entry.model === model.id);
    if (profile) return {
      ...model,
      sizeProfile: profile.sizeProfile,
      references: profile.references,
      transparency: profile.transparency,
      qualities: profile.qualities,
      complexities: profile.complexities,
      outputFormats: profile.outputFormats,
      documentedOnly: profile.documentedOnly,
      generationVerified: profile.evidence !== null,
    };
    // Cached discovery records are not evidence of supported generation options.
    const {
      sizeProfile: _unverifiedSizeProfile, qualities: _qualities, complexities: _complexities,
      outputFormats: _outputFormats, documentedOnly: _documentedOnly, generationVerified: _verified, ...unverified
    } = model;
    return unverified;
  });
}

export type ImageOutputFormat = typeof imageOutputFormats[number];

/** Refuses options the selected model cannot honour instead of silently dropping them. */
export function assertModelOptions(
  model: Model,
  request: {
    transparent?: boolean;
    quality?: ImageQuality;
    complexity?: ImageComplexity;
    referenceIds?: readonly string[];
    outputFormat?: ImageOutputFormat;
    frameCount?: number;
    frameDurationMs?: number;
  },
) {
  if (request.referenceIds?.length && !model.references)
    throw new UserFacingError("Selected model does not support image references");
  if (request.transparent && !model.transparency)
    throw new UserFacingError("Selected model does not support transparency");
  if (request.quality !== undefined && !model.qualities?.includes(request.quality))
    throw new UserFacingError(
      `Selected model does not support quality "${request.quality}". Supported: ${(model.qualities ?? []).join(", ") || "none"}.`,
    );
  if (request.complexity !== undefined && !model.complexities?.includes(request.complexity))
    throw new UserFacingError(
      `Selected model does not support complexity "${request.complexity}". Supported: ${(model.complexities ?? []).join(", ") || "none"}.`,
    );
  const format = request.outputFormat ?? "png";
  if (request.outputFormat !== undefined && !model.outputFormats?.includes(request.outputFormat))
    throw new UserFacingError(
      `Selected model does not support output format "${request.outputFormat}". Supported: ${(model.outputFormats ?? []).join(", ") || "none"}.`,
    );
  if (request.transparent && format !== "png" && format !== "webp")
    throw new UserFacingError("Transparent background requires PNG or WebP output.");
  if (format === "svg" && request.referenceIds?.length)
    throw new UserFacingError("SVG output cannot be combined with reference images.");
  if (format === "gif" && request.referenceIds?.length)
    throw new UserFacingError("GIF output with reference images is not supported by this application yet.");
  if ((request.frameCount !== undefined || request.frameDurationMs !== undefined) && format !== "gif")
    throw new UserFacingError("Frame count and duration apply only to GIF output.");
}
