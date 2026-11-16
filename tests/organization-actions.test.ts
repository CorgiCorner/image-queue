import { beforeEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
const state = vi.hoisted(() => ({
  store: undefined as unknown as MemoryStorage,
  enqueue: vi.fn(),
  after: vi.fn(),
  configuredQueueRoot: vi.fn(async () => "/tmp/fixture-queue"),
}));
vi.mock("../src/sources/queue", async importOriginal => ({
  ...await importOriginal<typeof import("../src/sources/queue")>(),
  configuredQueueRoot: state.configuredQueueRoot,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: state.after }));
vi.mock("../src/core/access", () => ({ verifyAccess: async () => {} }));
vi.mock("../src/core/runtime", async () => {
  const { ImageService } = await import("../src/core/service");
  return {
    service: async () => new ImageService(state.store),
    enqueue: state.enqueue,
  };
});
import * as actions from "../src/actions";
beforeEach(async () => {
  state.store = new MemoryStorage();
  vi.clearAllMocks();
  await state.store.put("projects", "project", {
    id: "project",
    name: "Project",
    createdAt: "2026-01-01",
  });
  await state.store.put("projects", "other", {
    id: "other",
    name: "Other",
    createdAt: "2026-01-01",
  });
  for (const id of ["one", "two"])
    await state.store.put("jobs", id, {
      id,
      projectId: "project",
      prompt: "Image",
      source: "queue",
      width: 1024,
      height: 1024,
      createdAt: "2026-01-01",
      status: "done",
    });
});
it("runs topic organization through validated actions", async () => {
  const result = await actions.createTopicAction({
    projectId: "project",
    name: "Topic",
  });
  const topic = result?.data!;
  expect(topic.name).toBe("Topic");
  await actions.pinAction({
    targetType: "topic",
    targetId: topic.id,
    pinned: true,
  });
  await actions.moveToTopicAction({ ids: ["one"], topicId: topic.id });
  await actions.renameTopicAction({ id: topic.id, name: "Renamed" });
  await actions.moveTopicAction({ id: topic.id, projectId: "other" });
  expect(await state.store.get("jobs", "one")).toMatchObject({
    projectId: "other",
    topicId: topic.id,
  });
  await actions.deleteTopicAction({ id: topic.id });
  expect(await state.store.get("topics", topic.id)).toMatchObject({
    deleted: true,
  });
});
it("edits tags and builds the index through actions", async () => {
  await actions.tagImageAction({ id: "one", tags: ["forest"] });
  await actions.acceptTagAction({ id: "one", tag: "forest" });
  await actions.editTagAction({ from: "forest", to: "nature" });
  expect(await state.store.get("jobs", "one")).toMatchObject({
    tags: [{ tag: "nature", source: "user" }],
  });
  expect((await actions.rebuildIndexAction({}))?.data).toEqual({
    rebuilt: true,
  });
});
it("selects a main version through actions", async () => {
  expect(
    (await actions.joinStackAction({ parentId: "one", versionId: "two" }))
      ?.serverError,
  ).toBeUndefined();
  await actions.mainVersionAction({ id: "one" });
  expect(await state.store.get("jobs", "one")).toMatchObject({ isMain: true });
  expect(await state.store.get("jobs", "two")).toMatchObject({ isMain: false });
});
it("rejects invalid organization inputs before writing", async () => {
  expect(
    (await actions.moveToTopicAction({ ids: [], topicId: "missing" }))
      ?.validationErrors,
  ).toBeTruthy();
  expect(
    (await actions.addNoteAction({ imageId: "one", text: "" }))
      ?.validationErrors,
  ).toBeTruthy();
});
it("reorders project records and places one before another", async () => {
  await actions.reorderAction({
    collection: "projects",
    id: "other",
    direction: -1,
  });
  await actions.placeBeforeAction({
    collection: "projects",
    id: "project",
    beforeId: "other",
  });
  expect(await state.store.get("projects", "project")).toMatchObject({
    order: 0,
  });
});
it("saves image notes and records their linked request", async () => {
  const note = await actions.addNoteAction({
    imageId: "one",
    text: "Change sky",
    x: 0.4,
    y: 0.5,
  });
  expect(note?.data).toMatchObject({ imageId: "one", text: "Change sky" });
  await state.store.put("jobs", "correction", {
    id: "correction",
    parentVersionId: "one",
  });
  await actions.markNotesAction({ imageId: "one", jobId: "correction" });
  expect(await state.store.get("notes", note!.data!.id)).toMatchObject({
    sentInJobId: "correction",
  });
});
it("creates an iteration through the action and submits the queue job", async () => {
  await state.store.put("references", "ref", {
    id: "ref",
    projectId: "project",
    kind: "image",
  });
  const result = await actions.iterateAction({
    parentId: "one",
    prompt: "A new sky",
    referenceId: "ref",
    idempotencyKey: "iteration-action",
  });
  expect(result?.serverError).toBeUndefined();
  expect(result?.data).toMatchObject({
    parentVersionId: "one",
    prompt: "A new sky",
  });
  expect(state.enqueue).toHaveBeenCalledWith("IMG-iteration-action");
});
it("creates a correction through the action and submits the queue job", async () => {
  for (const id of ["original", "annotated"])
    await state.store.put("references", id, {
      id,
      projectId: "project",
      kind: "image",
    });
  await actions.addNoteAction({ imageId: "one", text: "Make the sky blue" });
  const result = await actions.correctionAction({
    imageId: "one",
    referenceIds: ["original", "annotated"],
    idempotencyKey: "correction-action",
  });
  expect(result?.serverError).toBeUndefined();
  expect(result?.data).toMatchObject({
    parentVersionId: "one",
    prompt: "1. Make the sky blue",
  });
  expect(state.enqueue).toHaveBeenCalledWith("IMG-correction-action");
});
it("validates complete note coordinates before calling the core", async () => {
  const result = await actions.addNoteAction({imageId:"one",text:"Change sky",x:0.5});
  expect(result?.validationErrors).toBeTruthy();
  expect(await state.store.list("notes")).toEqual([]);
});
it("undoes retention through the same validated action boundary", async () => {
  const result=await actions.retentionAction({ids:["one"],operation:"trash"});
  expect(result?.data?.undoId).toBeTruthy();
  await actions.undoRetentionAction({id:result!.data!.undoId});
  expect(await state.store.get("jobs","one")).not.toHaveProperty("trashedAt");
});
it("combines pinned notes and a general instruction in one correction", async () => {
  for(const id of ["original","annotated"]) await state.store.put("references",id,{id,projectId:"project",kind:"image"});
  await actions.addNoteAction({imageId:"one",text:"Make the sky blue",x:0.5,y:0.2});
  const result=await actions.correctionAction({imageId:"one",referenceIds:["original","annotated"],idempotencyKey:"combined",instruction:"Keep the character unchanged"});
  expect(result?.data?.prompt).toBe("1. Make the sky blue\n\nKeep the character unchanged");
  expect(state.enqueue).toHaveBeenCalledWith("IMG-combined");
});
it("rejects changing general instructions under an existing correction key", async () => {
  for(const id of ["original","annotated"]) await state.store.put("references",id,{id,projectId:"project",kind:"image"});
  const input={imageId:"one",referenceIds:["original","annotated"],idempotencyKey:"same-instruction",instruction:"Make the sky blue"};
  const first=await actions.correctionAction(input);
  expect(first?.serverError).toBeUndefined();
  const retry=await actions.correctionAction({...input,instruction:"Make the sky red"});
  expect(retry?.serverError).toContain("different request");
  expect(await state.store.get("jobs","IMG-same-instruction")).toMatchObject({prompt:"Make the sky blue"});
});
it("rejects new versions for archived and trashed images",async()=>{
 await state.store.put("jobs","one",{id:"one",status:"done",archivedAt:"2026-01-01"});
 const iteration=await actions.iterateAction({parentId:"one",prompt:"Change sky",referenceId:"ref",idempotencyKey:"hidden"});
 expect(iteration?.serverError).toContain("Restore");
 const correction=await actions.correctionAction({imageId:"one",referenceIds:["a","b"],idempotencyKey:"hidden-correction",instruction:"Change sky"});
 expect(correction?.serverError).toContain("Restore");
 expect(state.enqueue).not.toHaveBeenCalled();
});
it("returns an existing correction after the parent is archived",async()=>{
 for(const id of ["original","annotated"]) await state.store.put("references",id,{id,projectId:"project",kind:"image"});
 const input={imageId:"one",referenceIds:["original","annotated"],idempotencyKey:"retry-archived",instruction:"Change sky"};
 const first=await actions.correctionAction(input);
 const parent=await state.store.get<any>("jobs","one");
 await state.store.put("jobs","one",{...parent,archivedAt:"2026-01-01"});
 const second=await actions.correctionAction(input);
 expect(second?.serverError).toBeUndefined();
 expect(second?.data?.id).toBe(first?.data?.id);
});

it("permanently deletes trashed images through the validated action", async () => {
  const { revalidatePath } = await import("next/cache");
  const active = await actions.purgeAction({ ids: ["one"] });
  expect(active?.serverError).toBeTruthy();
  expect(await state.store.get("jobs", "one")).toBeDefined();
  expect(revalidatePath).not.toHaveBeenCalled();

  const trash = await actions.retentionAction({ ids: ["one"], operation: "trash" });
  expect(trash?.serverError).toBeUndefined();
  const purged = await actions.purgeAction({ ids: ["one"] });
  expect(purged?.serverError).toBeUndefined();
  expect(purged?.data?.deleted).toEqual(["one"]);
  expect(await state.store.get("jobs", "one")).toBeUndefined();
  expect(await state.store.get("jobs", "two")).toBeDefined();
  expect(revalidatePath).toHaveBeenCalledWith("/");
});

it("schedules an API iteration after returning the new version", async () => {
  const parent = await state.store.get<Record<string, unknown>>("jobs", "one");
  await state.store.put("jobs", "one", { ...parent, source: "api", provider: "openai", model: "gpt-image-1" });
  await state.store.put("references", "ref", { id: "ref", projectId: "project", kind: "image" });
  const result = await actions.iterateAction({
    parentId: "one", prompt: "Make the sky brighter", referenceId: "ref", idempotencyKey: "api-iteration",
  });
  expect(result?.serverError).toBeUndefined();
  expect(result?.data).toMatchObject({ id: "IMG-api-iteration", source: "api", parentVersionId: "one" });
  expect(state.enqueue).not.toHaveBeenCalled();
  expect(state.after).toHaveBeenCalledOnce();
  await state.after.mock.calls[0][0]();
  expect(state.enqueue).toHaveBeenCalledExactlyOnceWith("IMG-api-iteration");

  state.enqueue.mockRejectedValueOnce(new Error("Provider is disconnected"));
  await state.after.mock.calls[0][0]();
  expect(await state.store.get("jobs", "IMG-api-iteration")).toMatchObject({
    status: "failed", error: "Generation failed", parentVersionId: "one",
  });
  const current = await state.store.get<Record<string, unknown>>("jobs", "IMG-api-iteration");
  await state.store.put("jobs", "IMG-api-iteration", { ...current, status: "done", error: undefined });
  state.enqueue.mockRejectedValueOnce(new Error("Late failure"));
  await state.after.mock.calls[0][0]();
  expect(await state.store.get("jobs", "IMG-api-iteration")).toMatchObject({ status: "done" });
});

it("rejects external-file deletion from Cloudflare before touching any record", async () => {
  const trash = await actions.retentionAction({ ids: ["one"], operation: "trash" });
  expect(trash?.serverError).toBeUndefined();
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  try {
    const result = await actions.purgeAction({ ids: ["one"], removeExternal: true });
    expect(result?.serverError).toContain("local workspace");
    expect(await state.store.get("jobs", "one")).toMatchObject({ trashedAt: expect.any(String) });
    expect(await state.store.get("tombstones", "one")).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("uses the configured local queue for external-output purges", async () => {
  await actions.retentionAction({ ids: ["one"], operation: "trash" });
  const result = await actions.purgeAction({ ids: ["one"], removeExternal: true });
  expect(result?.data?.deleted).toEqual(["one"]);
  expect(state.configuredQueueRoot).toHaveBeenCalledOnce();
});

it("replaces stale search results with authoritative records through the rebuild action", async () => {
  const { loadIndex } = await import("../src/core/search");
  await state.store.put("indexes", "images", { version: 1, words: [["obsolete", ["gone"]]] });
  expect([...(await loadIndex(state.store)).search("obsolete")]).toEqual(["gone"]);
  await state.store.put("jobs", "one", { id: "one", projectId: "project", prompt: "Distinctive lighthouse", width: 1024, height: 1024 });
  expect((await actions.rebuildIndexAction({}))?.data).toEqual({ rebuilt: true });
  const rebuilt = await loadIndex(state.store);
  expect([...rebuilt.search("obsolete")]).toEqual([]);
  expect([...rebuilt.search("lighthouse")]).toEqual(["one"]);
  expect([...rebuilt.search("Project")]).toEqual(expect.arrayContaining(["one", "two"]));
});

it("reports a failed index write instead of successful rebuild", async () => {
  vi.spyOn(state.store, "put").mockRejectedValueOnce(new Error("Disk full"));
  const result = await actions.rebuildIndexAction({});
  expect(result?.data).toBeUndefined();
  expect(result?.serverError).toBeTruthy();
});
