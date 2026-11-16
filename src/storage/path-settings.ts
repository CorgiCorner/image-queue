import { UserFacingError } from "../core/user-facing-error";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { configuration } from "../core/config";
import type { PathSettings } from "../core/paths";
export function defaultPaths(): PathSettings {
  return {
    queueDirectory:
      configuration("QUEUE_DIR", "CODEX_QUEUE_DIR") ??
      path.join(process.cwd(), "image-queue"),
    referenceDirectories: (
      configuration("REFERENCE_ROOTS") || process.cwd()
    ).split(path.delimiter),
  };
}
export async function canonicalPaths(
  settings: PathSettings,
): Promise<PathSettings> {
  const directory = async (value: string) => {
    const canonical = await realpath(value);
    if (!(await stat(canonical)).isDirectory())
      throw new UserFacingError("Select an existing directory");
    return canonical;
  };
  return {
    queueDirectory: await directory(settings.queueDirectory),
    referenceDirectories: await Promise.all(
      settings.referenceDirectories.map(directory),
    ),
  };
}
