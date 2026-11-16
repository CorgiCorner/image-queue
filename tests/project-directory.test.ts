import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectDirectory } from "../src/storage/project-directory";
it("creates and reopens a project-owned folder and rejects a second owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-directory-"));
  try {
    const directory = join(root, "images");
    const store = await projectDirectory(directory, "project-one");
    await store.put("jobs", "one", { id: "one" });
    expect(await (await projectDirectory(directory, "project-one")).get("jobs", "one")).toEqual({ id: "one" });
    await expect(projectDirectory(directory, "project-two")).rejects.toThrow("another project");
    const alias = join(root, "alias");
    await symlink(directory, alias);
    await expect(projectDirectory(alias, "project-two")).rejects.toThrow("another project");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects relative folders before creating them", async () => {
  await expect(projectDirectory("relative", "project")).rejects.toThrow("absolute");
  await expect(projectDirectory("/tmp/example", "../project")).rejects.toThrow();
});

it("refuses to claim an unmarked folder containing another project", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-directory-existing-"));
  try {
    const { FileStorage } = await import("../src/storage/fs");
    const existing = new FileStorage(root);
    await existing.put("projects", "existing", { id: "existing" });
    await expect(projectDirectory(root, "new-project")).rejects.toThrow("another project's data");
    expect(await existing.get("settings", "project-owner")).toBeUndefined();
    expect(await existing.get("projects", "existing")).toEqual({ id: "existing" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("allows only one project to claim an empty folder concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-directory-race-"));
  try {
    const results = await Promise.allSettled([
      projectDirectory(root, "first"),
      projectDirectory(root, "second"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const { FileStorage } = await import("../src/storage/fs");
    const owner = await new FileStorage(root).get<{ projectId: string }>("settings", "project-owner");
    expect(["first", "second"]).toContain(owner?.projectId);
    const other = owner?.projectId === "first" ? "second" : "first";
    await expect(projectDirectory(root, other)).rejects.toThrow("another project");
  } finally { await rm(root, { recursive: true, force: true }); }
});
