import { outputMime } from "../core/image-format";
import { UserFacingError } from "../core/user-facing-error";
import { imageSize } from "image-size";
import { configuration } from "@/core/config";
import { planImageFit } from "@/core/image-fit";

type RasterFormat = "png" | "webp" | "jpeg" | "gif";

export async function fitImage(
  bytes: Uint8Array,
  target: { width: number; height: number },
  format: RasterFormat = "png",
) {
  if (format === "gif") return fitGif(bytes, target);
  const dimensions = imageSize(bytes);
  if (!dimensions.width || !dimensions.height) throw new UserFacingError("Cannot read generated image dimensions");
  const plan = planImageFit({ width: dimensions.width, height: dimensions.height }, target);
  const mime = outputMime[format];
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const images = (env as unknown as { IMAGES: {
      input(stream: ReadableStream): {
        transform(options: { width: number; height: number; fit: string; gravity: string }): {
          output(options: { format: string }): Promise<{ response(): Response }>;
        };
      };
    } }).IMAGES;
    const output = await images.input(new Blob([bytes as BlobPart]).stream())
      .transform({ ...target, fit: "cover", gravity: "center" }).output({ format: mime });
    const response = output.response();
    if (!response.ok) throw new Error(`Image transformation failed (HTTP ${response.status})`);
    const fittedBytes = new Uint8Array(await response.arrayBuffer());
    const fittedDimensions = imageSize(fittedBytes);
    if (fittedDimensions.width !== target.width || fittedDimensions.height !== target.height) {
      throw new UserFacingError("Image transformation returned unexpected dimensions");
    }
    return { bytes: fittedBytes, mime };
  }
  const sharp = (await import("sharp")).default;
  const pipeline = sharp(bytes).extract(plan.extract).resize(plan.resize);
  const encoded = format === "webp" ? pipeline.webp() : format === "jpeg" ? pipeline.jpeg() : pipeline.png();
  return { bytes: new Uint8Array(await encoded.toBuffer()), mime };
}

/** Keep every GIF frame. Refuse an upscale; leave exact fitting failures to the caller. */
async function fitGif(bytes: Uint8Array, target: { width: number; height: number }) {
  const dimensions = imageSize(bytes);
  if (!dimensions.width || !dimensions.height) throw new UserFacingError("Cannot read generated image dimensions");
  const plan = planImageFit({ width: dimensions.width, height: dimensions.height }, target);
  if (configuration("STORAGE_DRIVER") === "cloudflare")
    throw new UserFacingError("The generated GIF could not be fitted to the requested dimensions while keeping the animation.");
  const sharp = (await import("sharp")).default;
  const before = await sharp(bytes, { animated: true }).metadata();
  const pages = before.pages ?? 1;
  let fitted: Buffer;
  try {
    fitted = await sharp(bytes, { animated: true }).extract(plan.extract).resize(plan.resize).gif().toBuffer();
  } catch {
    throw new UserFacingError("The generated GIF could not be fitted to the requested dimensions while keeping the animation.");
  }
  const after = await sharp(fitted, { animated: true }).metadata();
  const frameHeight = after.pageHeight ?? after.height;
  if (after.width !== target.width || frameHeight !== target.height || (after.pages ?? 1) !== pages)
    throw new UserFacingError("The generated GIF could not be fitted to the requested dimensions while keeping the animation.");
  return { bytes: new Uint8Array(fitted), mime: outputMime.gif };
}
