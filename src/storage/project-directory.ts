import { UserFacingError } from "../core/user-facing-error";
import { realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { FileStorage } from "./fs";
import { idSchema, projectSchema } from "../core/schema";

export async function projectDirectory(directory: string, projectId: string) {
  idSchema.parse(projectId);
  projectSchema.shape.directory.unwrap().parse(directory);
  if (!path.isAbsolute(directory)) throw new UserFacingError("Project directory must be absolute on this machine");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  const store = new FileStorage(root);
  await store.lock("project-owner", async () => {
    const owner = await store.get<{ projectId: string }>("settings", "project-owner");
    if (owner && owner.projectId !== projectId)
      throw new UserFacingError("This folder already belongs to another project");
    if (!owner) {
      const projects = await store.list<{ id: string }>("projects");
      if (projects.some(project => project.id !== projectId))
        throw new UserFacingError("This folder contains another project's data");
      await store.put("settings", "project-owner", { projectId });
    }
  });
  return store;
}
