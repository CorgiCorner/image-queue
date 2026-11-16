import { expect, it } from "vitest";
import { queryGallery } from "../src/core/gallery-query";
import type { Job } from "../src/core/schema";
const jobs = [
  { id: "a", projectId: "p", topicId: "t", prompt: "Blue sky", createdAt: "2026-01-02", tags: [{ tag: "blue" }] },
  { id: "b", projectId: "p", prompt: "Forest", createdAt: "2026-01-01" },
  { id: "c", projectId: "p", prompt: "Blue sky", createdAt: "2026-01-03", trashedAt: "now" },
] as Job[];
it("filters project/topic/tag/search while excluding trash", () => {
  expect(queryGallery(jobs, { projectId: "p", topicId: "t", tag: " BLUE ", query: "SKY" }).items.map(job => job.id)).toEqual(["a"]);
});
it("paginates in stable newest-first order", () => {
  const first = queryGallery(jobs, { limit: 1 });
  expect(first.items[0].id).toBe("a");
  expect(first.nextOffset).toBe(1);
  expect(queryGallery(jobs, { limit: 1, offset: 1 }).nextOffset).toBeNull();
  expect(queryGallery(jobs, { offset: 10 }).items).toEqual([]);
});
it("rejects invalid page sizes", () => {
  expect(() => queryGallery(jobs, { limit: 0 })).toThrow();
  expect(() => queryGallery(jobs, { offset: -1 })).toThrow();
});

it("returns compact metadata without prompt bodies or storage paths", () => {
  const result = queryGallery([{ ...jobs[0], status: "done", prompt: "x".repeat(12000), outputPath: "/private/image.png" }], {});
  expect(result.items[0].title).toHaveLength(160);
  expect(result.items[0]).not.toHaveProperty("prompt");
  expect(result.items[0]).not.toHaveProperty("outputPath");
  expect(result.items[0].thumbnailUri).toBe("image-queue://thumbnail/a");
});

it("keeps pagination stable for equal timestamps and searches original filenames", () => {
  const images: Job[] = [
    { ...jobs[0], id: "b", originalName: "Studio portrait.png" },
    { ...jobs[0], id: "a", originalName: "Studio landscape.png" },
    { ...jobs[0], id: "c", originalName: "Studio archive.png", archivedAt: "2026-01-04" },
  ];

  const first = queryGallery(images, { query: " STUDIO ", limit: 1 });
  expect(first.items.map(({ id, title }) => ({ id, title }))).toEqual([
    { id: "a", title: "Studio landscape.png" },
  ]);
  expect(first.total).toBe(2);
  expect(first.nextOffset).toBe(1);
  const second = queryGallery(images, { query: "studio", limit: 1, offset: 1 });
  expect(second.items.map(({ id }) => id)).toEqual(["b"]);
  expect(second.nextOffset).toBeNull();
});
