import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { pathSettings, savePaths } from "../src/core/paths";
let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
it("persists canonical paths and protects jobs linked to an existing queue", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-paths-"));
  const other = path.join(root, "other");
  await mkdir(other);
  vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", root);
  const store = new MemoryStorage();
  await savePaths(store, {
    queueDirectory: root,
    referenceDirectories: [root],
  });
  expect((await pathSettings(store)).queueDirectory).toBe(await realpath(root));
  await store.put("jobs", "one", {
    source: "queue",
    outputPath: path.join(root, "out.png"),
  });
  await expect(
    savePaths(store, { queueDirectory: other, referenceDirectories: [root] }),
  ).rejects.toThrow("separate workspace");
  await expect(
    savePaths(store, {
      queueDirectory: path.join(root, "missing"),
      referenceDirectories: [root],
    }),
  ).rejects.toThrow();
});
it("accepts unchanged queue paths and new reference roots", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-paths-"));
  vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", root);
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    source: "queue",
    outputPath: path.join(root, "out.png"),
  });
  await expect(
    savePaths(store, { queueDirectory: root, referenceDirectories: [root] }),
  ).resolves.toBeDefined();
});
it("validates empty paths and file paths", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-paths-"));
  const { writeFile } = await import("node:fs/promises");
  const file = path.join(root, "file");
  await writeFile(file, "x");
  const store = new MemoryStorage();
  await expect(
    savePaths(store, { queueDirectory: "", referenceDirectories: [root] }),
  ).rejects.toThrow();
  await expect(
    savePaths(store, { queueDirectory: file, referenceDirectories: [root] }),
  ).rejects.toThrow("directory");
});
it("replaces an unavailable unused queue directory", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-paths-"));
  vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", path.join(root, "missing"));
  const store = new MemoryStorage();
  await expect(
    savePaths(store, { queueDirectory: root, referenceDirectories: [root] }),
  ).resolves.toBeDefined();
});
