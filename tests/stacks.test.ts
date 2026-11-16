import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { joinStack, mainVersion, stackedImages } from "../src/core/stacks";
import type { Job } from "../src/core/schema";
it("groups versions and changes the main image", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "a", { id: "a", projectId: "p", createdAt: "1" });
  await store.put("jobs", "b", { id: "b", projectId: "q", createdAt: "2" });
  await joinStack(store, "a", "b");
  let jobs = await store.list<Job>("jobs");
  expect(stackedImages(jobs)[0].id).toBe("b");
  await mainVersion(store, "a");
  jobs = await store.list<Job>("jobs");
  expect(stackedImages(jobs)[0].id).toBe("a");
});
it("rejects cyclic version ancestry", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "a", { id: "a", projectId: "p" });
  await store.put("jobs", "b", { id: "b", projectId: "p" });
  await joinStack(store, "a", "b");
  await expect(joinStack(store, "b", "a")).rejects.toThrow("cycle");
});
it("moves a complete stack between projects", async () => {
  const { ImageService } = await import("../src/core/service");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  await store.put("projects", "p", { id: "p" });
  await store.put("projects", "q", { id: "q" });
  await store.put("jobs", "a", { id: "a", projectId: "p", stackId: "s" });
  await store.put("jobs", "b", { id: "b", projectId: "p", stackId: "s" });
  await api.moveJob("a", "q");
  expect((await store.get<any>("jobs", "b")).projectId).toBe("q");
});
it("preserves all versions while selecting a new main image", async () => {
  const store = new MemoryStorage();
  for (const id of ["a", "b", "c"])
    await store.put("jobs", id, { id, projectId: "p", createdAt: id });
  await joinStack(store, "a", "b");
  await joinStack(store, "b", "c");
  await mainVersion(store, "a");
  const jobs = await store.list<Job>("jobs");
  expect(jobs).toHaveLength(3);
  expect(jobs.filter((job) => job.isMain)).toHaveLength(1);
  expect(stackedImages(jobs)[0].id).toBe("a");
});
it("creates an iteration in the parent stack", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Versions");
  const parent = await api.create({
    projectId: project.id,
    idempotencyKey: "parent",
    prompt: "A blue sky",
    source: "queue",
    provider: "openai",
    model: "",
    width: 1024,
    height: 1024,
    transparent: false,
    referenceIds: [],
  });
  const ref = await api.addReference(
    project.id,
    "parent.png",
    "image/png",
    png,
  );
  const input = {
    parentId: parent.id,
    prompt: "Add clouds",
    referenceId: ref.id,
    idempotencyKey: "next",
  };
  await store.put("jobs", parent.id, {...parent,status:"done"});
  const next = await createIteration(api, input);
  expect(next.parentVersionId).toBe(parent.id);
  expect((await createIteration(api, input)).id).toBe(next.id);
});
it("rejects merging a version already owned by another stack", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "a", { id: "a", stackId: "first" });
  await store.put("jobs", "b", { id: "b", stackId: "second" });
  await expect(joinStack(store, "a", "b")).rejects.toThrow("another stack");
});
it("does not adopt an unrelated request as an iteration", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const store = new MemoryStorage();
  await store.put("jobs", "IMG-existing", { id: "IMG-existing" });
  await expect(
    createIteration(new ImageService(store), {
      parentId: "parent",
      prompt: "Change sky",
      referenceId: "ref",
      idempotencyKey: "existing",
    }),
  ).rejects.toThrow("another request");
});
it("returns the same iteration after the parent moves", async () => {
  const {ImageService}=await import("../src/core/service");
  const {createIteration}=await import("../src/core/stacks");
  const {png}=await import("./fixtures");
  const store=new MemoryStorage(); const api=new ImageService(store);
  const project=await api.createProject("First");const other=await api.createProject("Second");
  const parent=await api.create({projectId:project.id,idempotencyKey:"moving-parent",prompt:"A landscape",source:"queue",provider:"openai",model:"",width:1024,height:1024,transparent:false,referenceIds:[]});
  const reference=await api.addReference(project.id,"parent.png","image/png",png);
  const input={parentId:parent.id,prompt:"Add clouds",referenceId:reference.id,idempotencyKey:"moving-child"};
  await store.put("jobs",parent.id,{...parent,status:"done"});
  const first=await createIteration(api,input);
  await api.moveJob(parent.id,other.id);
  const retry = await createIteration(api, {
    idempotencyKey: input.idempotencyKey,
    referenceId: input.referenceId,
    prompt: input.prompt,
    parentId: input.parentId,
  });
  expect(retry.id).toBe(first.id);expect(retry.projectId).toBe(other.id);
  for (const changes of [{ parentId: "different-parent" }, { prompt: "Remove clouds" }, { referenceId: "different-reference" }]) {
    await expect(createIteration(api, { ...input, ...changes }))
      .rejects.toThrow("Iteration key belongs to another request");
  }
  expect(await store.get("jobs", first.id)).toEqual(retry);
  expect(await store.list("jobs")).toHaveLength(2);
});

it.each([{trashedAt:"2026-01-01"},{archivedAt:"2026-01-01"},{status:"running"},{status:"failed"}])("rejects an unavailable main version %j", async state => {
  const store = new MemoryStorage();
  await store.put("jobs","image",{id:"image",stackId:"stack",...state});
  const before=await store.get("jobs","image");
  await expect(mainVersion(store,"image")).rejects.toThrow();
  expect(await store.get("jobs","image")).toEqual(before);
});

it.each(["queued","running","failed","blocked","uncertain","cancelled"])("rejects a new iteration from a %s parent", async status => {
  const {ImageService}=await import("../src/core/service");
  const {createIteration}=await import("../src/core/stacks");
  const store=new MemoryStorage();
  await store.put("jobs","parent",{id:"parent",status});
  await expect(createIteration(new ImageService(store),{parentId:"parent",prompt:"Change sky",referenceId:"ref",idempotencyKey:"new"})).rejects.toThrow("Wait for the parent image");
  expect(await store.get("iteration-intents","new")).toBeFalsy();
});

it("does not reuse a version number after a version is deleted", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01" });
  await store.put("jobs", "second", { id: "second", createdAt: "2026-01-02" });
  const second = await joinStack(store, "parent", "second");
  expect(second.versionNumber).toBe(2);
  await store.delete("jobs", "second");
  await store.put("jobs", "third", { id: "third", createdAt: "2026-01-03" });
  expect((await joinStack(store, "parent", "third")).versionNumber).toBe(3);
});

it("keeps the assigned version number when joining the same version again", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01" });
  await store.put("jobs", "child", { id: "child", createdAt: "2026-01-02" });
  const first = await joinStack(store, "parent", "child");
  const second = await joinStack(store, "parent", "child");
  expect(second.versionNumber).toBe(first.versionNumber);
  expect(await store.get("stack-counters", first.stackId!)).toMatchObject({ lastVersion: 2 });
});

it("recovers a version number after interrupted stack metadata writes", async () => {
  const { recoverMetadata } = await import("../src/core/metadata-operation");
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01" });
  await store.put("jobs", "child", { id: "child", createdAt: "2026-01-02" });
  const put = store.put.bind(store);
  let interrupted = false;
  store.put = async (collection, id, value) => {
    if (collection === "jobs" && id === "parent" && !interrupted) {
      interrupted = true;
      throw new Error("interrupted stack write");
    }
    await put(collection, id, value);
  };
  await expect(joinStack(store, "parent", "child")).rejects.toThrow("interrupted stack write");
  await recoverMetadata(store);
  const child = await store.get<Job>("jobs", "child");
  expect(child?.versionNumber).toBe(2);
  expect(child?.parentVersionId).toBe("parent");
  expect(await store.get("stack-counters", child!.stackId!)).toMatchObject({ lastVersion: 2 });
  expect((await joinStack(store, "parent", "child")).versionNumber).toBe(2);
});

it("assigns stable ordinals to legacy stack members when adding a version", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "first", { id: "first", stackId: "legacy", createdAt: "2026-01-01" });
  await store.put("jobs", "second", { id: "second", stackId: "legacy", createdAt: "2026-01-02" });
  await store.put("jobs", "third", { id: "third", createdAt: "2026-01-03" });
  const third = await joinStack(store, "second", "third");
  expect((await store.get<Job>("jobs", "first"))?.versionNumber).toBe(1);
  expect((await store.get<Job>("jobs", "second"))?.versionNumber).toBe(2);
  expect(third.versionNumber).toBe(3);
});

it("keeps mixed legacy ordinals unique without reusing reserved history", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "first", { id: "first", stackId: "mixed", versionNumber: 2, createdAt: "2026-01-01" });
  await store.put("jobs", "legacy", { id: "legacy", stackId: "mixed", createdAt: "2026-01-02" });
  await store.put("stack-counters", "mixed", { id: "mixed", lastVersion: 5 });
  await store.put("jobs", "new", { id: "new", createdAt: "2026-01-03" });
  const next = await joinStack(store, "legacy", "new");
  expect((await store.get<Job>("jobs", "first"))?.versionNumber).toBe(2);
  expect((await store.get<Job>("jobs", "legacy"))?.versionNumber).toBe(6);
  expect(next.versionNumber).toBe(7);
});

it("retries a competing stack join without duplicating version ordinals", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01" });
  await store.put("jobs", "first-child", { id: "first-child", createdAt: "2026-01-02" });
  await store.put("jobs", "second-child", { id: "second-child", createdAt: "2026-01-03" });
  const results = await Promise.allSettled([
    joinStack(store, "parent", "first-child"),
    joinStack(store, "parent", "second-child"),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  for (const id of ["first-child", "second-child"]) {
    if (!(await store.get<Job>("jobs", id))?.versionNumber) await joinStack(store, "parent", id);
  }
  const children = await Promise.all(["first-child", "second-child"].map(id => store.get<Job>("jobs", id)));
  expect(children.map(job => job!.versionNumber).sort()).toEqual([2, 3]);
  expect(new Set(children.map(job => job!.stackId)).size).toBe(1);
});


it("recovers pending stack metadata before planning a direct retry", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01" });
  await store.put("jobs", "child", { id: "child", createdAt: "2026-01-02" });
  const put = store.put.bind(store);
  let fail = true;
  store.put = async (collection, id, value) => {
    if (collection === "jobs" && id === "child" && fail) { fail = false; throw new Error("interrupted"); }
    await put(collection, id, value);
  };
  await expect(joinStack(store, "parent", "child")).rejects.toThrow("interrupted");
  const result = await joinStack(store, "parent", "child");
  expect(result.versionNumber).toBe(2);
  expect(await store.get("stack-counters", result.stackId!)).toMatchObject({ lastVersion: 2 });
});

it("rejects invalid stack identifiers before changing records", async () => {
  const store = new MemoryStorage();
  await expect(joinStack(store, "../parent", "child")).rejects.toThrow();
  await expect(joinStack(store, "parent", "../child")).rejects.toThrow();
  await expect(mainVersion(store, "../image")).rejects.toThrow();
  expect(await store.list("metadata-operations")).toEqual([]);
});

it("rejects invalid iteration identifiers before writing an intent", async () => {
  const { createIteration } = await import("../src/core/stacks");
  const { ImageService } = await import("../src/core/service");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  await expect(createIteration(api, {
    parentId: "parent", referenceId: "../reference", idempotencyKey: "key", prompt: "Change image",
  })).rejects.toThrow();
  expect(await store.list("iteration-intents")).toEqual([]);
});

it("enforces matching location when joining from the image picker", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", status: "done", projectId: "p", topicId: "topic", createdAt: "1" });
  await store.put("jobs", "child", { id: "child", status: "done", projectId: "q", createdAt: "2" });
  await expect(joinStack(store, "parent", "child", true)).rejects.toThrow("same project and topic");
  expect(await store.list("stack-counters")).toEqual([]);
});

it.each([
  { trashedAt: "2026-01-01" },
  { archivedAt: "2026-01-01" },
  { status: "running" },
])("rejects picker candidates that became unavailable", async change => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", status: "done", projectId: "p", createdAt: "1", ...change });
  await store.put("jobs", "child", { id: "child", status: "done", projectId: "p", createdAt: "2" });
  await expect(joinStack(store, "parent", "child", true)).rejects.toThrow("completed images");
  expect(await store.list("stack-counters")).toEqual([]);
});

it("preserves legacy parent numbering when retrying an existing linked version", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "parent", { id: "parent", stackId: "old", createdAt: "2026-01-01" });
  await store.put("jobs", "child", { id: "child", stackId: "old", parentVersionId: "parent", createdAt: "2026-01-02" });
  const linked = await joinStack(store, "parent", "child");
  expect((await store.get<Job>("jobs", "parent"))?.versionNumber).toBe(1);
  expect(linked.versionNumber).toBe(2);
  expect((await joinStack(store, "parent", "child")).versionNumber).toBe(2);
});

it("links the existing iteration when the request is retried before stack linkage", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const store = new MemoryStorage();
  const input = { parentId: "parent", prompt: "Add clouds", referenceId: "ref", idempotencyKey: "interrupted" };
  await store.put("jobs", "parent", { id: "parent", createdAt: "2026-01-01", status: "done" });
  await store.put("jobs", "IMG-interrupted", { id: "IMG-interrupted", createdAt: "2026-01-02", status: "queued" });
  await store.put("iteration-intents", input.idempotencyKey, input);

  const api = new ImageService(store);
  const recovered = await createIteration(api, input);
  expect(recovered).toMatchObject({ id: "IMG-interrupted", parentVersionId: "parent", versionNumber: 2 });
  expect(await store.get("jobs", "parent")).toMatchObject({ stackId: recovered.stackId, versionNumber: 1 });
  expect(await createIteration(api, input)).toEqual(recovered);
  expect(await store.list("jobs")).toHaveLength(2);
});

it("does not relink an existing iteration attached to another parent", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const store = new MemoryStorage();
  const input = { parentId: "parent", prompt: "Add clouds", referenceId: "ref", idempotencyKey: "conflicting-parent" };
  const job = { id: "IMG-conflicting-parent", parentVersionId: "other-parent", status: "queued" };
  await store.put("jobs", job.id, job);
  await store.put("iteration-intents", input.idempotencyKey, input);

  await expect(createIteration(new ImageService(store), input)).rejects.toThrow("Iteration key belongs to another parent");
  expect(await store.get("jobs", job.id)).toEqual(job);
  expect(await store.list("jobs")).toHaveLength(1);
});

it.each([
  { archivedAt: "2026-01-01" },
  { trashedAt: "2026-01-01" },
])("rejects a new version for a retained parent (%j)", async (retention) => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const store = new MemoryStorage();
  const parent = { id: "parent", status: "done", ...retention };
  await store.put("jobs", parent.id, parent);

  await expect(createIteration(new ImageService(store), {
    parentId: parent.id,
    prompt: "Add clouds",
    referenceId: "reference",
    idempotencyKey: "retained-parent",
  })).rejects.toThrow("Restore the parent image before requesting a version");
  expect(await store.list("iteration-intents")).toEqual([]);
  expect(await store.list("jobs")).toEqual([parent]);
});

it.each([
  ["missing-parent", "child"],
  ["parent", "missing-child"],
  ["parent", "parent"],
])("rejects invalid stack pairs (%s, %s) before editing records", async (parentId, childId) => {
  const store = new MemoryStorage();
  const parent = { id: "parent", status: "done", createdAt: "2026-01-01" };
  const child = { id: "child", status: "done", createdAt: "2026-01-02" };
  await store.put("jobs", parent.id, parent);
  await store.put("jobs", child.id, child);

  await expect(joinStack(store, parentId, childId)).rejects.toThrow("Select two different images");
  expect(await store.get("jobs", parent.id)).toEqual(parent);
  expect(await store.get("jobs", child.id)).toEqual(child);
  expect(await store.list("stack-counters")).toEqual([]);
});

it("preserves provider settings when requesting a version of an API image", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createIteration } = await import("../src/core/stacks");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Provider versions");
  const reference = await api.addReference(project.id, "original.png", "image/png", png);
  const settings = {
    source: "api", provider: "openrouter", model: "google/gemini-3-pro-image-preview",
    width: 1024, height: 1024, transparent: false,
  };
  await store.put("jobs", "parent", {
    id: "parent", projectId: project.id, createdAt: "2026-01-01", status: "done", ...settings,
  });

  const version = await createIteration(api, {
    parentId: "parent", prompt: "Adjust lighting", referenceId: reference.id, idempotencyKey: "provider-version",
  });

  expect(version).toMatchObject({
    ...settings, parentVersionId: "parent", projectId: project.id, referenceIds: [reference.id], status: "queued",
  });
});
