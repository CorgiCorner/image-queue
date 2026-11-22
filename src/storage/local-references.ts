import { UserFacingError } from "../core/user-facing-error";
import { configuration } from "@/core/config";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ImageService } from "../core/service";
export async function addLocalReference(
  api: ImageService,
  projectId: string,
  filePath: string,
) {
  if (configuration("STORAGE_DRIVER") === "cloudflare")
    throw new UserFacingError("The hosted image-queue cannot read local files or files attached to the chat. Call upload_reference so the user can choose the image in a card.");
  const { pathSettings } = await import("../core/paths");
  const roots = (await pathSettings(api.store)).referenceDirectories;
  const file = await realpath(filePath);
  const allowed = await Promise.all(roots.map((root) => realpath(root)));
  if (!allowed.some((root) => file.startsWith(root + path.sep)))
    throw new UserFacingError("Reference path is outside REFERENCE_ROOTS");
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const mime = types[path.extname(file).toLowerCase()];
  if (!mime) throw new UserFacingError("Unsupported reference format");
  const size = await stat(file);
  if (!size.isFile() || size.size > 20 * 1024 * 1024)
    throw new UserFacingError("Reference must be a file no larger than 20 MB");
  return api.addReference(
    projectId,
    path.basename(file),
    mime,
    new Uint8Array(await readFile(file)),
  );
}
