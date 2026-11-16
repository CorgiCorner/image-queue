import { UserFacingError } from "./user-facing-error";
export function planImageFit(
  source: { width: number; height: number },
  target: { width: number; height: number },
) {
  for (const dimension of [source.width, source.height, target.width, target.height]) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new UserFacingError("Image dimensions must be positive integers");
    }
  }
  if (source.width < target.width || source.height < target.height) {
    throw new UserFacingError("The generated image is too small for the requested size without upscaling");
  }
  const scale = Math.min(source.width / target.width, source.height / target.height);
  const width = Math.min(source.width, Math.round(target.width * scale));
  const height = Math.min(source.height, Math.round(target.height * scale));
  return {
    extract: {
      left: Math.floor((source.width - width) / 2),
      top: Math.floor((source.height - height) / 2),
      width,
      height,
    },
    resize: { width: target.width, height: target.height },
  };
}
