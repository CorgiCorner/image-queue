import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { writeMetadata, recoverMetadata } from "../src/core/metadata-operation";
it("replays a partially written metadata operation", async () => {
  const store = new MemoryStorage();
  const original = store.put.bind(store);
  let failed = false;
  store.put = async (collection, id, value) => {
    if (collection === "jobs" && id === "b" && !failed) {
      failed = true;
      throw new Error("interrupted");
    }
    await original(collection, id, value);
  };
  await expect(
    writeMetadata(store, [
      { collection: "jobs", id: "a", value: { id: "a" } },
      { collection: "jobs", id: "b", value: { id: "b" } },
    ]),
  ).rejects.toThrow("interrupted");
  await recoverMetadata(store);
  expect(await store.get("jobs", "b")).toEqual({ id: "b" });
  await recoverMetadata(store);
  expect(await store.list("jobs")).toHaveLength(2);
});
it("recovers older writes before publishing a newer metadata batch", async () => {
  const store = new MemoryStorage();
  await store.put("metadata-operations", "old", {
    id: "old",
    complete: false,
    writes: [{ collection: "jobs", id: "a", value: { version: 1 } }],
  });
  await writeMetadata(store, [
    { collection: "jobs", id: "a", value: { version: 2 } },
  ]);
  await recoverMetadata(store);
  expect(await store.get("jobs", "a")).toEqual({ version: 2 });
});
it("merges metadata into the latest job and removes only explicit fields", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", {
    status: "done",
    projectId: "old",
    topicId: "topic",
    tags: ["kept"],
  });
  await writeMetadata(store, [
    {
      collection: "jobs",
      id: "image",
      merge: true,
      unset: ["topicId"],
      value: { projectId: "new" },
    },
  ]);
  expect(await store.get("jobs", "image")).toEqual({
    status: "done",
    projectId: "new",
    tags: ["kept"],
  });
});
it("refuses a metadata write while the job has an active runtime writer", async () => {
  const store = new MemoryStorage();
  await store.lock("image", async () => {
    await expect(
      writeMetadata(store, [
        {
          collection: "jobs",
          id: "image",
          merge: true,
          value: { projectId: "new" },
        },
      ]),
    ).rejects.toThrow("in progress");
  });
  expect(await store.list("metadata-operations")).toEqual([]);
});
it("recovery respects a runtime lock and preserves later independent fields", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", {
    status: "done",
    projectId: "old",
    tags: ["new"],
  });
  await store.put("metadata-operations", "pending", {
    id: "pending",
    complete: false,
    writes: [
      {
        collection: "jobs",
        id: "image",
        merge: true,
        value: { projectId: "new" },
      },
    ],
  });
  await store.lock("image", async () => {
    await expect(recoverMetadata(store)).rejects.toThrow("in progress");
  });
  expect(
    (await store.get<{ projectId: string }>("jobs", "image"))?.projectId,
  ).toBe("old");
  await recoverMetadata(store);
  expect(await store.get("jobs", "image")).toEqual({
    status: "done",
    projectId: "new",
    tags: ["new"],
  });
});
it("locks records from older pending batches before accepting a new batch", async () => {
  const store = new MemoryStorage();
  await store.put("metadata-operations", "pending", {
    id: "pending",
    complete: false,
    writes: [{ collection: "jobs", id: "old", value: {} }],
  });
  await store.lock("old", async () => {
    await expect(
      writeMetadata(store, [{ collection: "jobs", id: "new", value: {} }]),
    ).rejects.toThrow("in progress");
  });
  expect(await store.get("jobs", "new")).toBeUndefined();
});

it("does not resurrect a tombstoned job while replaying metadata", async () => {
  const store = new MemoryStorage();
  await store.put("tombstones", "deleted", { id: "deleted", deletedAt: "2026-11-14" });
  await store.put("metadata-operations", "pending", {
    id: "pending", complete: false,
    writes: [{ collection: "jobs", id: "deleted", merge: true, value: { projectId: "old" } }],
  });
  await recoverMetadata(store);
  expect(await store.get("jobs", "deleted")).toBeUndefined();
  expect((await store.get<{complete:boolean}>("metadata-operations", "pending"))?.complete).toBe(true);
});
