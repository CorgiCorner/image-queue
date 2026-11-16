import { UserFacingError } from "../core/user-facing-error";
import { configuration } from "../core/config";
import { imageSize } from "image-size";
import { annotationOverlay } from "../core/annotation-overlay";
import type { ImageNote } from "../core/notes";

export async function annotatedImage(bytes: Uint8Array, notes: ImageNote[]) {
  const { width, height } = imageSize(bytes);
  if (!width || !height) throw new UserFacingError("Cannot read image dimensions");
  const overlay = annotationOverlay(width, height, notes);
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    type ImageChain = {
      draw(overlay: ReadableStream, options: { left: number; top: number }): ImageChain;
      output(options: { format: string }): Promise<{ response(): Response }>;
    };
    const images = (env as unknown as { IMAGES: { input(stream: ReadableStream): ImageChain } }).IMAGES;
    const output = await images.input(new Blob([bytes as BlobPart]).stream())
      .draw(new Blob([overlay], { type: "image/svg+xml" }).stream(), { left: 0, top: 0 })
      .output({ format: "image/png" });
    const response = output.response();
    if (!response.ok) throw new Error(`Image annotation failed (HTTP ${response.status})`);
    const result = new Uint8Array(await response.arrayBuffer());
    const dimensions = imageSize(result);
    if (dimensions.width !== width || dimensions.height !== height) throw new UserFacingError("Annotation changed image dimensions");
    return { bytes: result, mime: "image/png" };
  }
  const sharp = (await import("sharp")).default;
  return {
    bytes: new Uint8Array(await sharp(bytes).composite([{ input: Buffer.from(overlay) }]).png().toBuffer()),
    mime: "image/png",
  };
}
