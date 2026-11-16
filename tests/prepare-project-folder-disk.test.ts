import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "../src/storage/fs";
import { prepareProjectFolder } from "../src/storage/prepare-project-folder";
import { png } from "./fixtures";
afterEach(() => vi.unstubAllEnvs());
it("copies actual guarded queue output into the project folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-queue-copy-"));
  try {
    const queue = join(root, "queue");
    const output = join(queue, "out", "IMG-one", "image.png");
    await mkdir(join(queue, "out", "IMG-one"), { recursive: true });
    await writeFile(output, png);
    vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", queue);
    vi.stubEnv("IMAGE_QUEUE_STORAGE_DIR", join(root, "workspace"));
    const source = new FileStorage(join(root, "workspace"));
    const destination = new FileStorage(join(root, "project"));
    await source.put("projects", "p", { id: "p", name: "Project" });
    await source.put("jobs", "IMG-one", { id: "IMG-one", projectId: "p", status: "done", source: "queue", outputPath: output });
    const result = await prepareProjectFolder(source, destination, "p");
    expect(result.imported).toBe(1);
    const job = await destination.get<{ blobKey: string }>("jobs", "IMG-one");
    expect((await destination.getBlob(job!.blobKey))?.bytes).toEqual(png);
    expect(new Uint8Array(await readFile(output))).toEqual(png);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects a worker output path outside its job directory without copying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-queue-escape-"));
  try {
    const queue = join(root, "queue");
    await mkdir(queue, { recursive: true });
    const outside = join(root, "outside.png");
    await writeFile(outside, png);
    vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", queue);
    vi.stubEnv("IMAGE_QUEUE_STORAGE_DIR", join(root, "workspace"));
    const source = new FileStorage(join(root, "workspace"));
    const destination = new FileStorage(join(root, "project"));
    await source.put("projects", "p", { id: "p" });
    await source.put("jobs", "IMG-one", { id: "IMG-one", projectId: "p", status: "done", source: "queue", outputPath: outside });
    await expect(prepareProjectFolder(source, destination, "p")).rejects.toThrow("escapes job directory");
    expect(await destination.list("jobs")).toEqual([]);
    expect(await source.get("jobs", "IMG-one")).not.toHaveProperty("blobKey");
    expect(new Uint8Array(await readFile(outside))).toEqual(png);
  } finally { await rm(root, { recursive: true, force: true }); }
});
