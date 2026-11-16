import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { createTopic, pinTarget, moveToTopic } from "../src/core/organization";
it("creates topics, pins targets and moves image metadata", async () => {
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  const topic = await createTopic(store, "p", "Sketches");
  expect(topic.name).toBe("Sketches");
  await pinTarget(store, "topic", topic.id, true);
  expect((await store.list("pins")).length).toBe(1);
  await store.put("jobs", "image", { id: "image", projectId: "old" });
  await moveToTopic(store, ["image"], topic.id);
  expect(await store.get("jobs", "image")).toMatchObject({
    projectId: "p",
    topicId: topic.id,
  });
  await pinTarget(store, "topic", topic.id, false);
  expect((await store.list<{ removed: boolean }>("pins"))[0].removed).toBe(
    true,
  );
});
it("reorders topics and moves their contents between projects", async () => {
  const { reorderItem, moveTopic } = await import("../src/core/organization");
  const store = new MemoryStorage();
  await store.put("projects", "a", { id: "a" });
  await store.put("projects", "b", { id: "b" });
  const one = await createTopic(store, "a", "One");
  const two = await createTopic(store, "a", "Two");
  await reorderItem(store, "topics", one.id, -1);
  const topics = await store.list<{ id: string; order: number }>("topics");
  expect(topics.sort((a, b) => a.order - b.order)[0].id).toBe(one.id);
  await store.put("jobs", "image", {
    id: "image",
    projectId: "a",
    topicId: one.id,
  });
  await store.put("references", "attached", { id: "attached", projectId: "a", topicId: one.id });
  await store.put("references", "unrelated", { id: "unrelated", projectId: "a", topicId: two.id });
  await pinTarget(store, "topic", one.id, true);
  const pinnedBefore = await store.list("pins");
  await moveTopic(store, one.id, "b");
  expect(await store.list("pins")).toEqual(pinnedBefore);
  expect(await store.get("topics", one.id)).toMatchObject({ projectId: "b" });
  expect(await store.get("jobs", "image")).toMatchObject({ projectId: "b" });
  expect(await store.get("references", "attached")).toMatchObject({ projectId: "b", topicId: one.id });
  expect(await store.get("references", "unrelated")).toMatchObject({ projectId: "a", topicId: two.id });
  expect(await store.get("topics", two.id)).toMatchObject({ projectId: "a" });
});
it("deletes a topic while retaining image records", async () => {
  const { deleteTopic } = await import("../src/core/organization");
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  const topic = await createTopic(store, "p", "Work");
  await store.put("jobs", "a", { id: "a", projectId: "p", topicId: topic.id });
  await deleteTopic(store, topic.id);
  expect(await store.get("jobs", "a")).toMatchObject({
    id: "a",
    projectId: "p",
  });
  expect((await store.get<any>("jobs", "a")).topicId).toBeUndefined();
});
it("renames an active topic", async () => {
  const { renameTopic } = await import("../src/core/organization");
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  const topic = await createTopic(store, "p", "Old");
  await renameTopic(store, topic.id, "New");
  expect(await store.get("topics", topic.id)).toMatchObject({ name: "New" });
});
it("moves every version when a stack enters a topic", async () => {
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  const topic = await createTopic(store, "p", "Versions");
  await store.put("jobs", "a", { id: "a", stackId: "s" });
  await store.put("jobs", "b", { id: "b", stackId: "s" });
  await moveToTopic(store, ["a"], topic.id);
  expect((await store.get<any>("jobs", "b")).topicId).toBe(topic.id);
});
it("keeps an existing pin in its original position", async () => {
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  await store.put("projects", "q", { id: "q" });
  const first = await pinTarget(store, "project", "p", true);
  await pinTarget(store, "project", "q", true);
  const again = await pinTarget(store, "project", "p", true);
  expect(again.order).toBe(first.order);
});
it("places an item before a target and persists the order", async () => {
  const { placeBefore } = await import("../src/core/organization");
  const store = new MemoryStorage();
  for (const [order, id] of ["a", "b", "c"].entries())
    await store.put("projects", id, { id, order });
  await placeBefore(store, "projects", "c", "a");
  const items = await store.list<{ id: string; order: number }>("projects");
  expect(
    items.sort((a, b) => a.order - b.order).map((item) => item.id),
  ).toEqual(["c", "a", "b"]);
  await placeBefore(store, "projects", "c", "b", true);
  const moved = await store.list<{ id: string; order: number }>("projects");
  expect(moved.sort((a, b) => a.order - b.order).map(item => item.id)).toEqual(["a", "b", "c"]);
  await expect(placeBefore(store, "projects", "missing", "a")).rejects.toThrow(
    "exist",
  );
});
it("rejects moving images into deleted topics",async()=>{
 const {deleteTopic}=await import("../src/core/organization");const store=new MemoryStorage();await store.put("projects","p",{id:"p"});const topic=await createTopic(store,"p","Removed");await deleteTopic(store,topic.id);await store.put("jobs","a",{id:"a"});await expect(moveToTopic(store,["a"],topic.id)).rejects.toThrow("does not exist");
});

it("persists mixed pins placed below and above another row", async () => {
  const { placeBefore } = await import("../src/core/organization");
  const store = new MemoryStorage();
  await store.put("projects", "p", { id: "p" });
  const topic = await createTopic(store, "p", "Topic");
  await pinTarget(store, "project", "p", true);
  await pinTarget(store, "topic", topic.id, true);
  const pins = () => store.list<{ id: string; targetId: string; order: number }>("pins");
  const projectPin = (await pins()).find(pin => pin.targetId === "p")!;
  const topicPin = (await pins()).find(pin => pin.targetId === topic.id)!;
  const order = async () => (await pins()).sort((a, b) => a.order - b.order).map(pin => pin.targetId);

  await placeBefore(store, "pins", projectPin.id, topicPin.id);
  expect(await order()).toEqual(["p", topic.id]);
  await placeBefore(store, "pins", projectPin.id, topicPin.id, true);
  expect(await order()).toEqual([topic.id, "p"]);
  await placeBefore(store, "pins", projectPin.id, topicPin.id);
  expect(await order()).toEqual(["p", topic.id]);
});
