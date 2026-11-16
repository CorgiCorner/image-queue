import { configuration } from "@/core/config";

/** Inspect actual pixels rather than treating every PNG as transparent. */
export async function hasTransparentPixels(bytes: Uint8Array): Promise<boolean | undefined> {
  if (configuration("STORAGE_DRIVER") === "cloudflare") return undefined;
  const sharp = (await import("sharp")).default;
  try { return !(await sharp(bytes).stats()).isOpaque; }
  catch { return undefined; }
}
