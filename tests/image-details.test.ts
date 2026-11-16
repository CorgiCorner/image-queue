import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { imageDetails } from "../src/core/image-details";

it("returns image notes and ordered retained versions without storage paths", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", stackId: "stack", versionNumber: 1, status: "done", outputPath: "/private/result.png", createdAt: "2026-01-01" });
  await store.put("jobs", "two", { id: "two", stackId: "stack", versionNumber: 2, status: "done", createdAt: "2026-01-02" });
  await store.put("jobs", "three", { id: "three", stackId: "stack", versionNumber: 3, trashedAt: "now" });
  await store.put("notes", "note", { id: "note", imageId: "one", text: "Move left", createdAt: "2026-01-01", x: 0.2, y: 0.3 });
  await store.put("notes", "other", { id: "other", imageId: "two", text: "Other image" });
  const details = await imageDetails(store, "one");
  expect(details.versions.map(version => version.id)).toEqual(["one", "two"]);
  expect(details.notes).toHaveLength(1);
  expect(details.notes[0]).toMatchObject({ text: "Move left", x: 0.2 });
  expect(details.image).not.toHaveProperty("outputPath");
});

it("rejects unsafe, missing and trashed images", async () => {
  const store = new MemoryStorage();
  await expect(imageDetails(store, "../escape")).rejects.toThrow();
  await expect(imageDetails(store, "missing")).rejects.toThrow("unavailable");
  await store.put("jobs", "trashed", { id: "trashed", trashedAt: "now" });
  await expect(imageDetails(store, "trashed")).rejects.toThrow("unavailable");
});

it("orders notes chronologically regardless of storage order", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", createdAt: "2026-01-01" });
  await store.put("notes", "later", { id: "later", imageId: "one", text: "Later", createdAt: "2026-01-02" });
  await store.put("notes", "first", { id: "first", imageId: "one", text: "First", createdAt: "2026-01-01" });
  expect((await imageDetails(store, "one")).notes.map(note => note.id)).toEqual(["first", "later"]);
});

it("reports ratio intent and provider dimensions separately from the saved image", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "ratio", {
    id: "ratio", status: "done", createdAt: "2026-01-01",
    width: 2048, height: 1152, aspectRatio: "16:9", resolution: "2K", exactDimensions: false,
    requestedSize: { width: 1920, height: 1080 },
    providerSizeParameters: { aspectRatio: "16:9", resolution: "2K" },
    providerResultSize: { width: 2048, height: 1152 },
    generatedSize: { width: 2048, height: 1152 },
  });
  const { image } = await imageDetails(store, "ratio");
  expect(image).toMatchObject({
    width: 2048, height: 1152, aspectRatio: "16:9", resolution: "2K",
    providerSizeParameters: { aspectRatio: "16:9", resolution: "2K" },
    providerResultSize: { width: 2048, height: 1152 },
    generatedSize: { width: 2048, height: 1152 },
  });
  expect(image.requestedSize).toBeUndefined();
});

it("keeps notes in stable order when they have the same timestamp", async () => {
  const store = new MemoryStorage();
  const createdAt = "2026-01-01";
  await store.put("jobs", "one", { id: "one", createdAt });
  await store.put("notes", "first", { id: "z", imageId: "one", text: "Last", createdAt });
  await store.put("notes", "second", { id: "a", imageId: "one", text: "First", createdAt });

  expect((await imageDetails(store, "one")).notes.map(note => note.id)).toEqual(["a", "z"]);
});
