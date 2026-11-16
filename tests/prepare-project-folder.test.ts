import { expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { png } from "./fixtures";
import { prepareProjectFolder } from "../src/storage/prepare-project-folder";
vi.mock("../src/sources/queue", () => ({ configuredQueueRoot: async () => "/queue", queueOutput: async () => png }));

it("imports external queue output and copies a verified project in one operation", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Project" });
  await source.put("jobs", "image", { id: "image", projectId: "p", status: "done", source: "queue", outputPath: "/queue/out/image/result.png" });
  expect(await prepareProjectFolder(source, destination, "p")).toEqual({ imported: 1, records: 2, files: 1 });
  const job = await destination.get<{ blobKey: string }>("jobs", "image");
  expect((await destination.getBlob(job!.blobKey))?.bytes).toEqual(png);
  expect(await prepareProjectFolder(source, destination, "p")).toEqual({ imported: 0, records: 2, files: 1 });
});
it("rejects a missing project or identical store before preparing files", async () => {
  const source = new MemoryStorage();
  await expect(prepareProjectFolder(source, source, "p")).rejects.toThrow("different");
  await expect(prepareProjectFolder(source, new MemoryStorage(), "p")).rejects.toThrow("does not exist");
});

it("preserves the original project when destination verification fails", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Original" });
  await source.put("jobs", "image", { id: "image", projectId: "p", status: "done", source: "queue" });
  const write = destination.putBlob.bind(destination);
  destination.putBlob = async (key, _bytes, mime) => write(key, new Uint8Array([9]), mime);
  await expect(prepareProjectFolder(source, destination, "p")).rejects.toThrow("verification failed");
  expect(await source.get("projects", "p")).toMatchObject({ name: "Original" });
  const image = await source.get<{ blobKey: string }>("jobs", "image");
  expect((await source.getBlob(image!.blobKey))?.bytes).toEqual(png);
});

it("resumes a copy after destination metadata fails following a verified image write", async () => {
  const source = new MemoryStorage();
  const destination = new MemoryStorage();
  await source.put("projects", "p", { id: "p", name: "Original" });
  await source.put("jobs", "image", { id: "image", projectId: "p", status: "done", source: "queue" });
  const put = vi.spyOn(destination, "put").mockRejectedValueOnce(new Error("Destination write interrupted"));
  const putBlob = vi.spyOn(destination, "putBlob");

  await expect(prepareProjectFolder(source, destination, "p")).rejects.toThrow("Destination write interrupted");
  expect(await destination.get("projects", "p")).toBeUndefined();
  expect(await source.get("projects", "p")).toMatchObject({ name: "Original" });

  await expect(prepareProjectFolder(source, destination, "p")).resolves.toEqual({ imported: 0, records: 2, files: 1 });
  const image = await destination.get<{ blobKey: string }>("jobs", "image");
  expect((await destination.getBlob(image!.blobKey))?.bytes).toEqual(png);
  expect(putBlob).toHaveBeenCalledOnce();
  put.mockRestore();
  putBlob.mockRestore();
});
