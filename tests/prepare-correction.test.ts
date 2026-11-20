import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { MemoryStorage } from "../src/storage/memory";
import { ImageService } from "../src/core/service";
import { prepareCorrection } from "../src/core/prepare-correction";
import { addNote } from "../src/core/notes";
it("prepares two references and retries the same correction without duplicate jobs", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await addNote(store, { imageId: job.id, text: "Blue sky", x: 0.5, y: 0.5 });
  const input = { imageId: job.id, idempotencyKey: "correction" };
  const first = await prepareCorrection(api, input);
  const second = await prepareCorrection(api, input);
  expect(second.id).toBe(first.id);
  expect(first.referenceIds).toHaveLength(2);
  expect(first.parentVersionId).toBe(job.id);
  expect(await store.list("references")).toHaveLength(2);
  await expect(prepareCorrection(api, { ...input, instruction: "Different" })).rejects.toThrow("different request");
});
it("rejects an imported GIF and any SVG, which have no prompt to generate again and cannot be references", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await store.put("jobs", job.id, { ...job, outputFormat: "gif" });
  await addNote(store, { imageId: job.id, text: "Blue sky", x: 0.5, y: 0.5 });
  await expect(prepareCorrection(api, { imageId: job.id, idempotencyKey: "gif" })).rejects.toThrow("cannot be used as references");
  await store.put("jobs", job.id, { ...job, outputFormat: "svg", source: "api", imported: false });
  await expect(prepareCorrection(api, { imageId: job.id, idempotencyKey: "svg" })).rejects.toThrow("cannot be used as references");
  expect(await store.list("references")).toEqual([]);
});
it("generates a GIF again from its prompt with the requested changes, without references", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  const gif = { ...job, imported: false, source: "api" as const, provider: "openai" as const, model: "gpt-image-2.6-sunburst",
    prompt: "A red panda relaxing on a branch", outputFormat: "gif" as const, frameCount: 8, frameDurationMs: 180, width: 960, height: 960 };
  await store.put("jobs", job.id, gif);
  await store.put("settings", "provider-openai", { id: "provider-openai" });
  const key = vi.spyOn(await import("../src/core/settings"), "readKey").mockResolvedValue("test-key");
  await addNote(store, { imageId: job.id, text: "Make the tail\nfluffier" });
  await new Promise(resolve => setTimeout(resolve, 3)); // Notes are sent in the order they were saved.
  await addNote(store, { imageId: job.id, text: "Add falling leaves" });
  const input = { imageId: job.id, idempotencyKey: "panda-v2" };
  const first = await prepareCorrection(api, input);
  expect(first.prompt).toBe("A red panda relaxing on a branch\n\nRequested changes:\n1. Make the tail fluffier\n2. Add falling leaves");
  expect(first).toMatchObject({ referenceIds: [], outputFormat: "gif", frameCount: 8, frameDurationMs: 180, width: 960, height: 960,
    source: "api", model: "gpt-image-2.6-sunburst", parentVersionId: job.id });
  expect((await prepareCorrection(api, input)).id).toBe(first.id);
  expect(await store.list("references")).toEqual([]);
  expect((await store.list<{ sentInJobId?: string }>("notes")).every(note => note.sentInJobId === first.id)).toBe(true);
  // A third version keeps the earlier changes and continues their numbering.
  await store.put("jobs", first.id, { ...(await store.get<typeof first>("jobs", first.id))!, status: "done" });
  await addNote(store, { imageId: first.id, text: "Slower blink" });
  const third = await prepareCorrection(api, { imageId: first.id, idempotencyKey: "panda-v3" });
  expect(third.prompt).toBe(`${first.prompt}\n3. Slower blink`);
  key.mockRestore();
});
it("rejects unavailable images before storing references", async () => {
  const store = new MemoryStorage();
  await expect(prepareCorrection(new ImageService(store), { imageId: "missing", idempotencyKey: "test" })).rejects.toThrow("ready");
  expect(await store.list("references")).toEqual([]);
});

it("leaves notes added during reference preparation for a later correction", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await addNote(store, { imageId: job.id, text: "First note", x: 0.5, y: 0.5 });
  const addReference = api.addReference.bind(api);
  let added = false;
  api.addReference = async (...args) => {
    if (!added) {
      added = true;
      await addNote(store, { imageId: job.id, text: "Later note" });
    }
    return addReference(...args);
  };
  const correction = await prepareCorrection(api, { imageId: job.id, idempotencyKey: "snapshot" });
  expect(correction.prompt).toContain("First note");
  expect(correction.prompt).not.toContain("Later note");
  const notes = await store.list<{ text: string; sentInJobId?: string }>("notes");
  expect(notes.find(note => note.text === "Later note")?.sentInJobId).toBeUndefined();
});

it("resumes after the second reference fails without repeating the first", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await addNote(store, { imageId: job.id, text: "First note" });
  const original = api.addReference.bind(api);
  let calls = 0;
  api.addReference = async (...args) => {
    calls++;
    if (calls === 2) throw new Error("Temporary failure");
    return original(...args);
  };
  const input = { imageId: job.id, idempotencyKey: "retry-references" };
  await expect(prepareCorrection(api, input)).rejects.toThrow("Temporary failure");
  expect(await store.list("references")).toHaveLength(1);
  await prepareCorrection(api, input);
  expect(await store.list("references")).toHaveLength(2);
  expect(calls).toBe(3);
});

it("reuses a committed reference when its progress write failed", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Test");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await addNote(store, { imageId: job.id, text: "First note" });
  const put = store.put.bind(store);
  let writes = 0;
  store.put = async (collection, id, value) => {
    if (collection === "prepared-corrections" && ++writes === 2) throw new Error("Progress write failed");
    return put(collection, id, value);
  };
  const input = { imageId: job.id, idempotencyKey: "recover-reference" };
  await expect(prepareCorrection(api, input)).rejects.toThrow("Progress write failed");
  expect(await store.list("references")).toHaveLength(1);
  await prepareCorrection(api, input);
  expect(await store.list("references")).toHaveLength(2);
});

it("rejects a concurrent preparation and reuses the result on retry", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Concurrent corrections");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await addNote(store, { imageId: job.id, text: "Make the sky blue" });
  const input = { imageId: job.id, idempotencyKey: "concurrent" };
  const results = await Promise.allSettled([prepareCorrection(api, input), prepareCorrection(api, input)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const completed = results.find(result => result.status === "fulfilled")!;
  if (completed.status !== "fulfilled") throw new Error("Missing completed request");
  const retried = await prepareCorrection(api, input);
  expect(retried.id).toBe(completed.value.id);
  expect(retried.referenceIds).toEqual(completed.value.referenceIds);
  expect(await store.list("references")).toHaveLength(2);
  expect(await store.list("jobs")).toHaveLength(2);
});

it("keeps prompt numbering aligned with the saved annotation order on retry", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Ordered notes");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  const first = await addNote(store, { imageId: job.id, text: "First marker", x: 0.2, y: 0.2 });
  const second = await addNote(store, { imageId: job.id, text: "Second marker", x: 0.8, y: 0.8 });
  await store.put("notes", first.id, { ...first, createdAt: "2026-01-01T00:00:00Z" });
  await store.put("notes", second.id, { ...second, createdAt: "2026-01-02T00:00:00Z" });
  const original = api.create.bind(api);
  api.create = async () => { throw new Error("Temporary job failure"); };
  const input = { imageId: job.id, idempotencyKey: "ordered-retry" };
  await expect(prepareCorrection(api, input)).rejects.toThrow("Temporary job failure");
  api.create = original;
  const list = store.list.bind(store);
  store.list = async <T>(collection: string) => {
    const items = await list<T>(collection);
    return collection === "notes" ? items.reverse() : items;
  };
  const correction = await prepareCorrection(api, input);
  expect(correction.prompt).toBe("1. First marker\n\n2. Second marker");
});

it("rejects changed note text after preparing references but before creating the job", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Changed notes");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  const note = await addNote(store, { imageId: job.id, text: "Original note" });
  const create = api.create.bind(api);
  api.create = async () => { throw new Error("Interrupted"); };
  const input = { imageId: job.id, idempotencyKey: "changed-note" };
  await expect(prepareCorrection(api, input)).rejects.toThrow("Interrupted");
  api.create = create;
  await store.put("notes", note.id, { ...note, text: "Changed note" });
  await expect(prepareCorrection(api, input)).rejects.toThrow("Prepared notes changed");
  expect(await store.get("jobs", "IMG-changed-note")).toBeUndefined();
});

it("leaves edited notes unsent when the prepared snapshot is submitted", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Edited notes");
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  const note = await addNote(store, { imageId: job.id, text: "Original note" });
  const addReference = api.addReference.bind(api);
  api.addReference = async (...args) => {
    await store.put("notes", note.id, { ...note, text: "New edit" });
    return addReference(...args);
  };
  const correction = await prepareCorrection(api, { imageId: job.id, idempotencyKey: "edited-during-prepare" });
  expect(correction.prompt).toContain("Original note");
  expect(correction.prompt).not.toContain("New edit");
  expect(await store.get("notes", note.id)).toMatchObject({ text: "New edit" });
  expect((await store.get<{ sentInJobId?: string }>("notes", note.id))?.sentInJobId).toBeUndefined();
});

it("keeps notes unsent and leaves no correction when the provider key is missing", async () => {
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "");
  try {
    const store = new MemoryStorage();
    const api = new ImageService(store);
    await store.put("jobs", "original", {
      id: "original", source: "api", provider: "openai", model: "gpt-image-1", status: "done",
    });
    const note = await addNote(store, { imageId: "original", text: "Make it brighter" });
    await expect(prepareCorrection(api, { imageId: "original", idempotencyKey: "missing-key" }))
      .rejects.toThrow("Connect this provider in Settings first");
    expect(await store.get("notes", note.id)).toEqual(note);
    expect(await store.get("jobs", "IMG-missing-key")).toBeUndefined();
    expect(await store.list("references")).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("includes the current region in v2 and reuses only the original for a text edit", async () => {
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const png = await sharp({create:{width:256,height:256,channels:3,background:"white"}}).png().toBuffer();
  const {job} = await api.importImage("original.png","image/png",png);
  const generation = {source:"queue",provider:"openai",model:""} as const;
  const input = {imageId:job.id,idempotencyKey:"area-edit",instruction:"Turn this area blue",generation,
    selection:{x:0.25,y:0.25,w:0.5,h:0.5}};
  const version = await prepareCorrection(api,input);
  expect(version).toMatchObject({parentVersionId:job.id,versionNumber:2,prompt:"1. Turn this area blue"});
  expect(version.referenceIds).toHaveLength(2);
  const reference = await store.get<{blobKey:string}>("references",version.referenceIds[1]);
  const annotated = await store.getBlob(reference!.blobKey);
  const pixels = await sharp(annotated!.bytes).removeAlpha().raw().toBuffer();
  expect([...pixels.subarray(0,3)]).toEqual([255,255,255]);
  const mark = (64 * 256 + 58) * 3;
  expect(pixels[mark]).toBeLessThan(200);
  expect((await prepareCorrection(api,input)).id).toBe(version.id);
  const plain = await prepareCorrection(api,{...input,idempotencyKey:"plain-edit",selection:undefined});
  expect(plain.referenceIds).toHaveLength(1);
});
