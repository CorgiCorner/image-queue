import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { tagImage, editTag } from "../src/core/tags";
it("preserves user tags during agent tagging and supports global rename", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", tags: [] });
  await tagImage(store, "one", ["Forest"], "user");
  await tagImage(store, "one", ["forest", "green"], "agent");
  expect(
    (await store.get<any>("jobs", "one")).tags.find(
      (t: any) => t.tag === "forest",
    ).source,
  ).toBe("user");
  await editTag(store, "green", "nature");
  expect(
    (await store.get<any>("jobs", "one")).tags.map((t: any) => t.tag),
  ).toEqual(["forest", "nature"]);
  await editTag(store, "nature");
  expect((await store.get<any>("jobs", "one")).tags).toHaveLength(1);
});
it("accepts agent suggestions as user-owned tags", async () => {
  const { acceptTag } = await import("../src/core/tags");
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one" });
  await tagImage(store, "one", ["blue"], "agent");
  await acceptTag(store, "one", "blue");
  expect((await store.get<any>("jobs", "one")).tags[0].source).toBe("user");
});
it("keeps provenance on a no-op rename and promotes merge targets to user ownership", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one" });
  await tagImage(store, "one", ["forest"], "user");
  await tagImage(store, "one", ["nature"], "agent");
  const before = await store.get("jobs", "one");
  await editTag(store, "forest", "forest");
  expect(await store.get("jobs", "one")).toEqual(before);
  await editTag(store, "forest", "nature");
  const result = await store.get<{ tags: { tag: string; source: string }[] }>(
    "jobs",
    "one",
  );
  expect(result?.tags).toEqual([
    expect.objectContaining({ tag: "nature", source: "user" }),
  ]);
});
it("counts each image once per tag and orders by frequency", async () => {
  const { tagCounts } = await import("../src/core/tags");
  expect(
    tagCounts([
      { tags: [{ tag: "blue" }, { tag: "blue" }, { tag: "forest" }] as any },
      { tags: [{ tag: "blue" }] as any },
      {},
    ]),
  ).toEqual([
    { tag: "blue", count: 2 },
    { tag: "forest", count: 1 },
  ]);
});

it("enforces the image tag limit across successive writes without partial changes", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one"});
  await tagImage(store,"one",Array.from({length:50},(_,index)=>`tag-${index}`),"user");
  const before = await store.get("jobs","one");
  await expect(tagImage(store,"one",["extra"],"agent")).rejects.toThrow("at most 50");
  expect(await store.get("jobs","one")).toEqual(before);
  await expect(tagImage(store,"one",["tag-1"],"agent")).resolves.toBeTruthy();
});

it("normalizes accepted tags and rejects missing suggestions without changing the image", async () => {
  const {acceptTag} = await import("../src/core/tags");
  const store = new MemoryStorage();
  await store.put("jobs","one",{id:"one"});
  await tagImage(store,"one",["blue"],"agent");
  await acceptTag(store,"one"," BLUE ");
  const before = await store.get("jobs","one");
  expect((before as any).tags[0].source).toBe("user");
  await expect(acceptTag(store,"one","missing")).rejects.toThrow("Tag does not exist");
  expect(await store.get("jobs","one")).toEqual(before);
});

it("resumes idle tagging only after generation clears across all projects", async () => {
  const { untaggedImages } = await import("../src/core/tags");
  const complete = { id: "image", status: "done", projectId: "first", prompt: "Studio image" } as import("../src/core/schema").Job;
  const pending = { id: "pending", status: "queued", projectId: "second" } as import("../src/core/schema").Job;
  expect(untaggedImages([complete, pending], 1)).toEqual([]);
  expect(untaggedImages([complete, { ...pending, status: "running" }], 1)).toEqual([]);
  expect(untaggedImages([complete, { ...pending, status: "done", tags: [{ tag: "done", source: "user", createdAt: "2026-11-15" }] }], 1))
    .toEqual([{ id: "image", projectId: "first", prompt: "Studio image", thumbnailUrl: "/api/asset?job=image&thumb=640" }]);
  expect(untaggedImages([{ ...complete, archivedAt: "2026-11-15" }], 1)).toEqual([]);
});

it("removes a tag from only the selected image", async () => {
  const { removeImageTag } = await import("../src/core/tags");
  const store = new MemoryStorage();
  for (const id of ["one", "two"]) {
    await store.put("jobs", id, { id });
    await tagImage(store, id, ["shared", "retained"], "user");
  }
  const updated = await removeImageTag(store, "one", " SHARED ");
  expect(updated.tags.map(t => t.tag)).toEqual(["retained"]);
  expect((await store.get<any>("jobs", "two")).tags).toHaveLength(2);
});
