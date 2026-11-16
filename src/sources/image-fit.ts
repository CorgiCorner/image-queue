import { UserFacingError } from "../core/user-facing-error";
import { imageSize } from "image-size";
import { configuration } from "@/core/config";
import { planImageFit } from "@/core/image-fit";

export async function fitImage(bytes: Uint8Array, target: { width: number; height: number }) {
  const dimensions = imageSize(bytes);
  if (!dimensions.width || !dimensions.height) throw new UserFacingError("Cannot read generated image dimensions");
  const plan = planImageFit({ width: dimensions.width, height: dimensions.height }, target);
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
      .transform({ ...target, fit: "cover", gravity: "center" }).output({ format: "image/png" });
    const response = output.response();
    if (!response.ok) throw new Error(`Image transformation failed (HTTP ${response.status})`);
    const fittedBytes = new Uint8Array(await response.arrayBuffer());
    const fittedDimensions = imageSize(fittedBytes);
    if (fittedDimensions.width !== target.width || fittedDimensions.height !== target.height) {
      throw new UserFacingError("Image transformation returned unexpected dimensions");
    }
    return { bytes: fittedBytes, mime: "image/png" };
  }
  const sharp = (await import("sharp")).default;
  return {
    bytes: new Uint8Array(await sharp(bytes).extract(plan.extract).resize(plan.resize).png().toBuffer()),
    mime: "image/png",
  };
}
