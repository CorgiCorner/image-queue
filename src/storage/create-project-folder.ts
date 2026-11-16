import { UserFacingError } from "../core/user-facing-error";
import { sep, dirname, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { FileStorage } from "./fs";
import { projectDirectory } from "./project-directory";
import { openProjectStorage } from "./open-project-storage";
import { validateProjectDirectory } from "./prepare-project-directory";
import type { Project } from "../core/schema";

/** Publish registration only after the project record has been verified on disk. */
export async function createProjectFolder(workspace: FileStorage, project: Project) {
  return workspace.lock("project-directories", async () => {
    const directory = project.directory ?? join(dirname(resolve(workspace.root)), "projects", project.id);
    await workspace.list("projects");
    const target = await validateProjectDirectory(workspace.root, directory);
    for (const existing of await workspace.list<{ id: string; directory: string }>("project-directories")) {
      if (existing.id === project.id) continue;
      const root = await realpath(existing.directory);
      if (target === root || target.startsWith(root + sep) || root.startsWith(target + sep))
        throw new UserFacingError("Choose a folder separate from other projects");
    }
    const registered = await workspace.get<{ id: string; directory: string }>("project-directories", project.id);
    if (registered && (registered.id !== project.id || registered.directory !== target))
      throw new UserFacingError("Project already has a different folder");
    const folder = await projectDirectory(directory, project.id);
    const registration = { id: project.id, directory: folder.root };
    const saved = { ...project, directory: folder.root };
    const current = await folder.get("projects", project.id);
    if (current && JSON.stringify(current) !== JSON.stringify(saved))
      throw new UserFacingError("Folder contains a different project record");
    await folder.put("projects", project.id, saved);
    if (JSON.stringify(await folder.get("projects", project.id)) !== JSON.stringify(saved))
      throw new UserFacingError("Project record verification failed");
    await workspace.put("project-directories", project.id, registration);
    try {
      await openProjectStorage(workspace);
    } catch (error) {
      if (!registered) await workspace.delete("project-directories", project.id);
      throw error;
    }
    return saved;
  });
}
