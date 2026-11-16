import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { changeRetention, visibleJobs } from "../src/core/retention";
import type { Job } from "../src/core/schema";
it("archives a complete stack and restores it", async () => {
  const store = new MemoryStorage();
  for (const id of ["one", "two"])
    await store.put("jobs", id, {
      id,
      status: "done",
      stackId: "stack",
      projectId: "project",
    });
  expect(
    (await changeRetention(store, { ids: ["one"], operation: "archive" }))
      .changed,
  ).toEqual(["one", "two"]);
  expect(visibleJobs(await store.list<Job>("jobs"))).toHaveLength(0);
  expect(visibleJobs(await store.list<Job>("jobs"), "archive")).toHaveLength(2);
  await changeRetention(store, { ids: ["one"], operation: "restore" });
  expect(visibleJobs(await store.list<Job>("jobs"))).toHaveLength(2);
});
it("skips active requests and supports a single version", async () => {
  const store = new MemoryStorage();
  for (const [id, status] of [
    ["one", "done"],
    ["two", "queued"],
    ["three", "running"],
  ])
    await store.put("jobs", id, { id, status, stackId: "stack" });
  expect(
    await changeRetention(store, { ids: ["one"], operation: "trash" }),
  ).toMatchObject({ changed: ["one"], skipped: ["two", "three"] });
  expect(visibleJobs(await store.list<Job>("jobs"), "trash")).toHaveLength(1);
  await changeRetention(store, {
    ids: ["one"],
    operation: "restore",
    includeStack: false,
  });
  expect(visibleJobs(await store.list<Job>("jobs"), "trash")).toHaveLength(0);
});
it("keeps the original trash date when the action is repeated", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    trashedAt: "2026-01-01",
  });
  await changeRetention(store, { ids: ["one"], operation: "trash" });
  expect(await store.get("jobs", "one")).toMatchObject({
    trashedAt: "2026-01-01",
  });
});
it("rejects a request that becomes active before commit", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", status: "done" });
  const lock = store.lock.bind(store);
  store.lock = async (key, work) => {
    if (key === "one")
      await store.put("jobs", "one", { id: "one", status: "running" });
    return lock(key, work);
  };
  await expect(
    changeRetention(store, { ids: ["one"], operation: "trash" }),
  ).rejects.toThrow("state changed");
  expect(await store.get("jobs", "one")).not.toHaveProperty("trashedAt");
});
it("restores orphaned records into Inbox", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    projectId: "missing",
    topicId: "missing-topic",
    trashedAt: "2026-01-01",
  });
  await changeRetention(store, { ids: ["one"], operation: "restore" });
  expect(await store.get("jobs", "one")).toMatchObject({ projectId: "inbox" });
  expect(await store.get("jobs", "one")).not.toHaveProperty("topicId");
  expect(await store.get("projects", "inbox")).toMatchObject({ name: "Inbox" });
});
it("undo restores mixed archive states and can be retried", async () => {
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    archivedAt: "2026-01-01",
  });
  await store.put("jobs", "two", { id: "two", status: "done" });
  const result = await changeRetention(store, {
    ids: ["one", "two"],
    operation: "trash",
  });
  await undoRetention(store, result.undoId);
  await undoRetention(store, result.undoId);
  expect(await store.get("jobs", "one")).toMatchObject({
    archivedAt: "2026-01-01",
  });
  expect(await store.get("jobs", "one")).not.toHaveProperty("trashedAt");
  expect(await store.get("jobs", "two")).not.toHaveProperty("archivedAt");
});
it("does not undo over a later retention operation", async () => {
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", status: "done" });
  const first = await changeRetention(store, {
    ids: ["one"],
    operation: "archive",
  });
  await changeRetention(store, { ids: ["one"], operation: "trash" });
  await expect(undoRetention(store, first.undoId)).rejects.toThrow(
    "newer change",
  );
  expect(await store.get("jobs", "one")).toHaveProperty("trashedAt");
});
it("chooses the newest visible version after the cover is trashed", async () => {
  const { stackedImages } = await import("../src/core/stacks");
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    stackId: "s",
    createdAt: "2026-01-01",
  });
  await store.put("jobs", "two", {
    id: "two",
    status: "done",
    stackId: "s",
    createdAt: "2026-01-02",
  });
  await store.put("jobs", "three", {
    id: "three",
    status: "done",
    stackId: "s",
    createdAt: "2026-01-03",
    isMain: true,
  });
  await changeRetention(store, {
    ids: ["three"],
    operation: "trash",
    includeStack: false,
  });
  expect(
    stackedImages(visibleJobs(await store.list<Job>("jobs"))).map(
      (job) => job.id,
    ),
  ).toEqual(["two"]);
});
it("calculates trash retention days with a bounded zero floor", async () => {
  const { trashDaysRemaining } = await import("../src/core/retention");
  const start = Date.parse("2026-01-01T00:00:00Z");
  expect(trashDaysRemaining("2026-01-01T00:00:00Z", start)).toBe(30);
  expect(
    trashDaysRemaining("2026-01-01T00:00:00Z", start + 31 * 86400000),
  ).toBe(0);
  expect(trashDaysRemaining("invalid", start)).toBe(0);
});
it("undoes restore-to-Inbox without losing the original destination", async () => {
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    projectId: "gone",
    topicId: "gone-topic",
    trashedAt: "2026-01-01",
  });
  const restored = await changeRetention(store, {
    ids: ["one"],
    operation: "restore",
  });
  await undoRetention(store, restored.undoId);
  expect(await store.get("jobs", "one")).toMatchObject({
    projectId: "gone",
    topicId: "gone-topic",
    trashedAt: "2026-01-01",
  });
});
it("recovers retention and its undo record after an interrupted write", async () => {
  const { recoverMetadata } = await import("../src/core/metadata-operation");
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", {
    id: "one",
    status: "done",
    projectId: "project",
  });
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (collection, id, value) => {
    if (collection === "retention-undo" && fail) {
      fail = false;
      throw new Error("interrupted");
    }
    await put(collection, id, value);
  };
  await expect(
    changeRetention(store, { ids: ["one"], operation: "trash" }),
  ).rejects.toThrow("interrupted");
  await recoverMetadata(store);
  const [undo] = await store.list<{ id: string }>("retention-undo");
  expect(undo).toBeTruthy();
  await undoRetention(store, undo.id);
  expect(await store.get("jobs", "one")).not.toHaveProperty("trashedAt");
});
it("recovers interrupted undo without losing its completion marker", async () => {
  const { recoverMetadata } = await import("../src/core/metadata-operation");
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", status: "done" });
  const result = await changeRetention(store, {
    ids: ["one"],
    operation: "trash",
  });
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (collection, id, value) => {
    if (collection === "retention-undo" && fail) {
      fail = false;
      throw new Error("interrupted");
    }
    await put(collection, id, value);
  };
  await expect(undoRetention(store, result.undoId)).rejects.toThrow(
    "interrupted",
  );
  await recoverMetadata(store);
  await undoRetention(store, result.undoId);
  expect(await store.get("retention-undo", result.undoId)).toMatchObject({
    applied: true,
  });
  expect(await store.get("jobs", "one")).not.toHaveProperty("trashedAt");
});
it("rejects missing selections without writing partial changes",async()=>{
 const store=new MemoryStorage();
 await store.put("jobs","one",{id:"one",status:"done"});
 await expect(changeRetention(store,{ids:["one","missing"],operation:"trash"})).rejects.toThrow("no longer exists");
 expect(await store.get("jobs","one")).not.toHaveProperty("trashedAt");
 expect(await store.list("retention-undo")).toEqual([]);
});
it("undoes consecutive retention operations in reverse order",async()=>{
 const {undoRetention}=await import("../src/core/retention");
 const store=new MemoryStorage();
 await store.put("jobs","one",{id:"one",status:"done"});
 const archived=await changeRetention(store,{ids:["one"],operation:"archive"});
 const trashed=await changeRetention(store,{ids:["one"],operation:"trash"});
 await undoRetention(store,trashed.undoId);
 await undoRetention(store,archived.undoId);
 expect(await store.get("jobs","one")).not.toHaveProperty("archivedAt");
 expect(await store.get("jobs","one")).not.toHaveProperty("trashedAt");
});

it("selects only terminal trash entries past the retention boundary", async () => {
  const { expiredTrash } = await import("../src/core/retention");
  const now = Date.parse("2026-11-14T12:00:00Z");
  const jobs = [
    { id: "boundary", status: "done", trashedAt: "2026-10-15T12:00:00Z" },
    { id: "recent", status: "done", trashedAt: "2026-10-15T12:00:01Z" },
    { id: "running", status: "running", trashedAt: "2026-10-01T00:00:00Z" },
    { id: "invalid", status: "done", trashedAt: "invalid" },
    { id: "archived", status: "done", archivedAt: "2026-10-01T00:00:00Z" },
  ] as Job[];
  expect(expiredTrash(jobs, now).map(job => job.id)).toEqual(["boundary"]);
  expect(() => expiredTrash(jobs, now, 0)).toThrow("Invalid");
});

it("rejects undo identifiers that no longer exist", async () => {
  const { undoRetention } = await import("../src/core/retention");
  await expect(undoRetention(new MemoryStorage(), "missing")).rejects.toThrow("unavailable");
});

it("does not undo a restore after its destination changed", async () => {
  const { undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("projects", "old", { id: "old", name: "Old" });
  await store.put("jobs", "one", { id: "one", status: "done", projectId: "old", trashedAt: "2026-01-01" });
  const restored = await changeRetention(store, { ids: ["one"], operation: "restore" });
  const current = await store.get<Job>("jobs", "one");
  await store.put("jobs", "one", { ...current, projectId: "new" });
  await expect(undoRetention(store, restored.undoId)).rejects.toThrow("newer change");
  expect(await store.get("jobs", "one")).toMatchObject({ projectId: "new" });
});

it("rejects nonfinite expiry clocks and malformed retention periods", async () => {
  const { expiredTrash } = await import("../src/core/retention");
  expect(() => expiredTrash([], Number.NaN)).toThrow("Invalid");
  expect(() => expiredTrash([], Date.now(), 1.5)).toThrow("Invalid");
});

it("restores a trashed image to its existing project and topic", async () => {
  const store = new MemoryStorage();
  await store.put("projects", "project", { id: "project" });
  await store.put("topics", "topic", { id: "topic", projectId: "project" });
  await store.put("jobs", "image", {
    id: "image",
    status: "done",
    projectId: "project",
    topicId: "topic",
    archivedAt: "2026-01-01T00:00:00Z",
    trashedAt: "2026-01-02T00:00:00Z",
  });

  expect(await changeRetention(store, { ids: ["image"], operation: "restore" }))
    .toMatchObject({ changed: ["image"], skipped: [] });
  const restored = await store.get<Job>("jobs", "image");
  expect(restored).toMatchObject({ projectId: "project", topicId: "topic" });
  expect(restored).not.toHaveProperty("archivedAt");
  expect(restored).not.toHaveProperty("trashedAt");
});

it("restores to the project root when the original topic was deleted", async () => {
  const store = new MemoryStorage();
  await store.put("projects", "project", { id: "project" });
  await store.put("topics", "topic", { id: "topic", projectId: "project", deleted: true });
  await store.put("jobs", "image", {
    id: "image", status: "done", projectId: "project",
    topicId: "topic", trashedAt: "2026-01-02T00:00:00Z",
  });

  const restored = await changeRetention(store, { ids: ["image"], operation: "restore" });
  expect(restored.changed).toEqual(["image"]);
  const image = await store.get<Job>("jobs", "image");
  expect(image?.projectId).toBe("project");
  expect(image).not.toHaveProperty("topicId");
  expect(image).not.toHaveProperty("trashedAt");
  expect(await store.get("projects", "inbox")).toBeUndefined();
});
