import { configuration } from "@/core/config";
/** True when WebP bytes carry the animation flag of the extended header. */
export function isAnimatedWebp(bytes: Uint8Array) {
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  return bytes.length > 20 && tag(0) === "RIFF" && tag(8) === "WEBP" && tag(12) === "VP8X" && (bytes[20] & 0x02) !== 0;
}

/**
 * A WebP preview of the given width. With animated set, the frames of an
 * animated source are kept; whether they survived is reported as `animated`,
 * because the hosted image service decides that for itself.
 */
export async function thumbnail(bytes: Uint8Array, width: number, options: { animated?: boolean } = {}) {
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    type Images = {
      input(stream: ReadableStream): {
        transform(options: { width: number }): {
          output(options: {
            format: string;
            anim?: boolean;
          }): Promise<{ response(): Response }>;
        };
      };
    };
    const images = (env as unknown as { IMAGES: Images }).IMAGES;
    const transformed = await images
      .input(new Blob([bytes as BlobPart]).stream())
      .transform({ width })
      .output({ format: "image/webp", ...(options.animated ? { anim: true } : {}) });
    const response = transformed.response();
    if (!response.ok) throw new Error(`Thumbnail transformation failed (HTTP ${response.status})`);
    const output = new Uint8Array(await response.arrayBuffer());
    return { bytes: output, mime: "image/webp", animated: isAnimatedWebp(output) };
  }
  const sharp = (await import("sharp")).default;
  // The first page is the GIF frame and a rasterized SVG. Previews stay WebP.
  const { dominant } = await sharp(bytes, { pages: 1 }).stats();
  const output = new Uint8Array(
    await sharp(bytes, options.animated ? { animated: true } : { pages: 1 })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer(),
  );
  return {
    bytes: output,
    mime: "image/webp",
    animated: isAnimatedWebp(output),
    dominantColor: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
  };
}
