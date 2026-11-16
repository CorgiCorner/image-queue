import { UserFacingError } from "../core/user-facing-error";
import { idSchema, projectSchema } from "../core/schema";
import path from "node:path";
import { realpath } from "node:fs/promises";
import type { Storage } from "./types";
import { FileStorage } from "./fs";
import { projectDirectory } from "./project-directory";
import { prepareProjectFolder } from "./prepare-project-folder";

export async function prepareProjectDirectory(source: FileStorage, directory: string, projectId: string, records: Storage = source) {
  idSchema.parse(projectId);
  projectSchema.shape.directory.unwrap().parse(directory);
  if (!(await records.get("projects", projectId))) throw new UserFacingError("Project does not exist");
  await validateProjectDirectory(source.root, directory);
  const destination = await projectDirectory(directory, projectId);
  const result = await prepareProjectFolder(records, destination, projectId);
  return { directory: destination.root, ...result };
}

export async function validateProjectDirectory(workspaceRoot: string, directory: string) {
  projectSchema.shape.directory.unwrap().parse(directory);
  if (!path.isAbsolute(directory)) throw new UserFacingError("Project directory must be absolute on this machine");
  const sourceRoot = await realpath(workspaceRoot);
  const candidate = await realpath(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  let target = candidate;
  if (!target) {
    let ancestor = path.resolve(directory);
    const suffix: string[] = [];
    while (!target) {
      try { target = path.join(await realpath(ancestor), ...suffix); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        suffix.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
      }
    }
  }
  if (target === sourceRoot || target.startsWith(sourceRoot + path.sep) || sourceRoot.startsWith(target + path.sep))
    throw new UserFacingError("Choose a folder separate from the current workspace store");
  return target;
}
