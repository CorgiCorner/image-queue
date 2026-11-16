import { configuration } from "@/core/config";
export async function thumbnail(bytes: Uint8Array, width: number) {
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    type Images = {
      input(stream: ReadableStream): {
        transform(options: { width: number }): {
          output(options: {
            format: string;
          }): Promise<{ response(): Response }>;
        };
      };
    };
    const images = (env as unknown as { IMAGES: Images }).IMAGES;
    const output = await images
      .input(new Blob([bytes as BlobPart]).stream())
      .transform({ width })
      .output({ format: "image/webp" });
    const response = output.response();
    if (!response.ok) throw new Error(`Thumbnail transformation failed (HTTP ${response.status})`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: "image/webp",
    };
  }
  const sharp = (await import("sharp")).default;
  const { dominant } = await sharp(bytes).stats();
  return {
    bytes: new Uint8Array(
      await sharp(bytes)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer(),
    ),
    mime: "image/webp",
    dominantColor: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
  };
}
