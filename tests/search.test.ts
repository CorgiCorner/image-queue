import { expect, it } from "vitest";
import { ImageIndex } from "../src/core/search";
import type { Job } from "../src/core/schema";
it("searches metadata and intersects words", () => {
  const jobs = [
    {
      id: "one",
      prompt: "Green forest",
      projectId: "p",
      tags: [{ tag: "watercolor" }],
      width: 1024,
      height: 1024,
    },
    {
      id: "two",
      prompt: "Blue ocean",
      projectId: "p",
      width: 1024,
      height: 1024,
    },
  ] as Job[];
  const index = new ImageIndex(jobs, [
    { id: "p", name: "Landscapes", createdAt: "" },
  ]);
  expect([...index.search("green watercolor")]).toEqual(["one"]);
  expect(index.search("landscapes").size).toBe(2);
  expect(index.search("").size).toBe(2);
  expect(index.snapshot().length).toBeGreaterThan(0);
});
it("persists a rebuildable index snapshot", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { rebuildIndex } = await import("../src/core/search");
  const store = new MemoryStorage();
  await store.put("jobs", "a", {
    id: "a",
    prompt: "Cloud",
    projectId: "p",
    width: 1,
    height: 1,
  });
  expect((await rebuildIndex(store)).search("cloud").has("a")).toBe(true);
  expect(await store.get("indexes", "images")).toMatchObject({ version: 1 });
});
it("restores a persisted index without rescanning records", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { loadIndex } = await import("../src/core/search");
  const store = new MemoryStorage();
  await store.put("indexes", "images", {
    version: 1,
    words: [["forest", ["one"]]],
  });
  store.list = async () => {
    throw new Error("Unexpected rescan");
  };
  const index = await loadIndex(store);
  expect([...index.search("fore")]).toEqual(["one"]);
  expect([...index.search("")]).toEqual(["one"]);
});
it("rebuilds a malformed index from authoritative records", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { loadIndex } = await import("../src/core/search");
  const store = new MemoryStorage();
  await store.put("indexes", "images", { version: 99, words: null });
  await store.put("jobs", "one", {
    id: "one",
    prompt: "Forest",
    width: 1024,
    height: 1024,
  });
  expect((await loadIndex(store)).search("forest").has("one")).toBe(true);
});
it("refreshes the cached index after metadata changes", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { currentIndex } = await import("../src/core/search");
  const store = new MemoryStorage();
  const jobs = [
    { id: "one", prompt: "Forest", width: 1024, height: 1024 },
  ] as Job[];
  const first = await currentIndex(store, jobs, [], []);
  expect(await currentIndex(store, jobs, [], [])).toEqual(first);
  const updated = await currentIndex(
    store,
    [{ ...jobs[0], prompt: "Ocean" }],
    [],
    [],
  );
  expect(ImageIndex.restore(updated).search("forest").size).toBe(0);
  expect(ImageIndex.restore(updated).search("ocean").has("one")).toBe(true);
});
it("repairs a matching revision with corrupt index words", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { currentIndex } = await import("../src/core/search");
  const store = new MemoryStorage();
  const jobs = [
    { id: "one", prompt: "Forest", width: 1024, height: 1024 },
  ] as Job[];
  const saved = await currentIndex(store, jobs, [], []);
  await store.put("indexes", "images", { ...saved, words: null });
  expect(
    ImageIndex.restore(await currentIndex(store, jobs, [], []))
      .search("forest")
      .has("one"),
  ).toBe(true);
});
