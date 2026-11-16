import { UserFacingError } from "./user-facing-error";
import { z } from "zod";

export const aspectRatios = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] as const;
export const sizeIntentSchema = z.object({
  aspectRatio: z.enum(aspectRatios).optional(),
  width: z.number().int().min(256).max(4096).optional(),
  height: z.number().int().min(256).max(4096).optional(),
}).refine(value => (value.width === undefined) === (value.height === undefined), "Provide both width and height")
  .refine(value => value.aspectRatio !== undefined || value.width !== undefined, "Provide aspect ratio or dimensions");

const queueDimensions: Record<typeof aspectRatios[number], readonly [number, number]> = {
  "1:1": [1024,1024], "3:2": [1536,1024], "2:3": [1024,1536],
  "4:3": [1440,1080], "3:4": [1080,1440], "16:9": [1920,1080],
  "9:16": [1080,1920], "21:9": [2520,1080],
};
export function resolveQueueSize(input: z.infer<typeof sizeIntentSchema>) {
  const intent = sizeIntentSchema.parse(input);
  if (intent.width !== undefined && intent.height !== undefined) {
    if (intent.aspectRatio) {
      const [a,b] = intent.aspectRatio.split(":").map(Number);
      if (intent.width * b !== intent.height * a) throw new UserFacingError("Dimensions do not match the requested aspect ratio");
    }
    return {width:intent.width,height:intent.height};
  }
  const [width,height] = queueDimensions[intent.aspectRatio!];
  return {width,height};
}

const positiveInteger = z.number().int().positive();
export const sizeProfileSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fixed"),
    sizes: z.array(z.object({ width: positiveInteger, height: positiveInteger })).min(1),
  }),
  z.object({
    mode: z.literal("dimensions"),
    minSide: positiveInteger,
    maxSide: positiveInteger,
    multiple: positiveInteger,
    minPixels: positiveInteger,
    maxPixels: positiveInteger,
    minRatio: z.number().positive(),
    maxRatio: z.number().positive(),
  }),
  z.object({
    mode: z.literal("aspect-ratio"),
    ratios: z.array(z.string().regex(/^[1-9]\d*:[1-9]\d*$/)).min(1),
    levels: z.array(z.string().trim().min(1)),
  }),
]).refine(profile => profile.mode !== "dimensions" || (
  profile.minSide <= profile.maxSide &&
  profile.minPixels <= profile.maxPixels &&
  profile.minRatio <= profile.maxRatio
), "Profile limits must be ordered");
export type SizeProfile = z.infer<typeof sizeProfileSchema>;

export function resolveModelSize(profile: SizeProfile, input: z.infer<typeof sizeIntentSchema> & {resolution?:string}) {
  sizeProfileSchema.parse(profile);
  let target = resolveQueueSize(input);
  const ratio = target.width / target.height;
  if (profile.mode === "aspect-ratio") {
    const aspectRatio = input.aspectRatio ?? profile.ratios.find(value => {
      const [widthUnit, heightUnit] = value.split(":").map(Number);
      return target.width * heightUnit === target.height * widthUnit;
    });
    if (!aspectRatio || !profile.ratios.includes(aspectRatio)) throw new UserFacingError("Unsupported aspect ratio for this model");
    if (input.resolution !== undefined && !profile.levels.includes(input.resolution)) throw new UserFacingError("Unsupported resolution level");
    return {target, parameters:{aspectRatio,resolution:input.resolution}, requiresResize:input.width !== undefined};
  }
  if (input.resolution !== undefined) {
    throw new UserFacingError("This model does not support resolution levels");
  }
  if (profile.mode === "dimensions") {
    const pixels=target.width*target.height;
    if (target.width < profile.minSide || target.height < profile.minSide ||
        target.width > profile.maxSide || target.height > profile.maxSide) {
      throw new UserFacingError(`This model's limits require each side between ${profile.minSide} and ${profile.maxSide} pixels`);
    }
    if (target.width % profile.multiple || target.height % profile.multiple) {
      throw new UserFacingError(`This model's limits require dimensions divisible by ${profile.multiple}`);
    }
    if (pixels < profile.minPixels || pixels > profile.maxPixels) {
      throw new UserFacingError(`This model's limits require between ${profile.minPixels} and ${profile.maxPixels} total pixels`);
    }
    if (ratio < profile.minRatio || ratio > profile.maxRatio) {
      throw new UserFacingError(`This model's limits require width/height between ${profile.minRatio} and ${profile.maxRatio}`);
    }
    return {target,parameters:{size:`${target.width}x${target.height}`},requiresResize:false};
  }
  const hasExactDimensions = input.width !== undefined;
  const candidates = profile.sizes.filter(size =>
    !hasExactDimensions || (size.width >= target.width && size.height >= target.height)
  );
  if (!candidates.length) throw new UserFacingError("No native size can cover the requested dimensions without upscaling");
  candidates.sort((a,b)=> Math.abs(Math.log(a.width/a.height/ratio))-Math.abs(Math.log(b.width/b.height/ratio)) || a.width*a.height-b.width*b.height);
  const native=candidates[0];
  if (!hasExactDimensions) {
    const [widthUnit, heightUnit] = input.aspectRatio!.split(":").map(Number);
    const scale = Math.floor(Math.min(native.width / widthUnit, native.height / heightUnit));
    if (scale < 1) throw new UserFacingError("No native size can represent the requested aspect ratio");
    target = { width: widthUnit * scale, height: heightUnit * scale };
  }
  return {target,parameters:{size:`${native.width}x${native.height}`},requiresResize:native.width!==target.width || native.height!==target.height};
}
