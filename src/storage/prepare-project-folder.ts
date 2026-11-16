import { UserFacingError } from "../core/user-facing-error";
import type { Storage } from "./types";
import { idSchema } from "../core/schema";
import { importProjectImages } from "./import-project-images";
import { copyProject } from "./project-copy";

/** Prepare a verified destination before changing the workspace's routing. */
export async function prepareProjectFolder(source: Storage, destination: Storage, projectId: string) {
  idSchema.parse(projectId);
  if (source === destination) throw new UserFacingError("Choose a different project destination");
  if (!(await source.get("projects", projectId))) throw new UserFacingError("Project does not exist");
  const imported = await importProjectImages(source, projectId);
  const copied = await copyProject(source, destination, projectId);
  return { ...copied, imported };
}
