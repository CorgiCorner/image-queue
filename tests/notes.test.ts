import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { addNote } from "../src/core/notes";
it("stores normalized image coordinates and rejects invalid notes", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  const note = await addNote(store, {
    imageId: "image",
    text: "Change the sky",
    x: 0.2,
    y: 0.4,
  });
  expect(note.x).toBe(0.2);
  await expect(
    addNote(store, { imageId: "image", text: "", x: 2, y: 0 }),
  ).rejects.toThrow();
  await expect(
    addNote(store, { imageId: "missing", text: "Note" }),
  ).rejects.toThrow("exist");
});
it("creates an idempotent correction linked to the original stack", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Notes");
  const original = await api.importImage(
    "image.png",
    "image/png",
    png,
    project.id,
  );
  await store.put("jobs", original.job.id, {
    ...original.job,
    source: "queue",
    width: 1024,
    height: 1024,
  });
  const ref = await api.addReference(project.id, "ref.png", "image/png", png);
  await addNote(store, { imageId: original.job.id, text: "Make the sky blue" });
  const input = {
    imageId: original.job.id,
    referenceIds: [ref.id, ref.id],
    idempotencyKey: "correction",
  };
  await expect(createCorrection(api, input)).rejects.toThrow("Duplicate");
  const ref2 = await api.addReference(
    project.id,
    "annotated.png",
    "image/png",
    png,
  );
  input.referenceIds = [ref.id, ref2.id];
  const correction = await createCorrection(api, input);
  expect(correction.parentVersionId).toBe(original.job.id);
  expect(correction.aspectRatio).toBe("1:1");
  expect((await createCorrection(api, input)).id).toBe(correction.id);
});
it("rejects marking notes against an unrelated request", async () => {
  const { markNotesSent } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "other", { id: "other" });
  await expect(markNotesSent(store, "image", "other")).rejects.toThrow(
    "does not belong",
  );
});
it("rejects correction retries with a different image", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  await store.put("jobs", "image", { id: "image" });
  await store.put("correction-intents", "same", {
    imageId: "other",
    referenceIds: ["a", "b"],
  });
  await expect(
    createCorrection(api, {
      imageId: "image",
      referenceIds: ["a", "b"],
      idempotencyKey: "same",
    }),
  ).rejects.toThrow("different request");
});
it("rejects annotation regions outside the image", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await expect(
    addNote(store, {
      imageId: "image",
      text: "Region",
      x: 0.8,
      y: 0.5,
      w: 0.5,
      h: 0.1,
    }),
  ).rejects.toThrow("fit");
});
it("does not adopt an unrelated existing request key", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await store.put("jobs", "IMG-used", { id: "IMG-used" });
  await expect(
    createCorrection(new ImageService(store), {
      imageId: "image",
      referenceIds: ["a", "b"],
      idempotencyKey: "used",
    }),
  ).rejects.toThrow("another request");
});
it("does not mark later notes as sent when retrying a correction", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Correction history");
  const original = await api.importImage(
    "image.png",
    "image/png",
    png,
    project.id,
  );
  await store.put("jobs", original.job.id, {
    ...original.job,
    source: "queue",
    width: 1024,
    height: 1024,
  });
  const first = await api.addReference(
    project.id,
    "original.png",
    "image/png",
    png,
  );
  const second = await api.addReference(
    project.id,
    "marked.png",
    "image/png",
    png,
  );
  await addNote(store, { imageId: original.job.id, text: "First change" });
  const input = {
    imageId: original.job.id,
    referenceIds: [first.id, second.id],
    idempotencyKey: "history",
  };
  await createCorrection(api, input);
  const later = await addNote(store, {
    imageId: original.job.id,
    text: "Later change",
  });
  await createCorrection(api, input);
  expect(
    (await store.get<{ sentInJobId?: string }>("notes", later.id))?.sentInJobId,
  ).toBeUndefined();
});
it("keeps the saved correction prompt after an interrupted creation", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Interrupted correction");
  const original = await api.importImage(
    "image.png",
    "image/png",
    png,
    project.id,
  );
  await store.put("jobs", original.job.id, {
    ...original.job,
    width: 1024,
    height: 1024,
  });
  const first = await api.addReference(
    project.id,
    "original.png",
    "image/png",
    png,
  );
  const second = await api.addReference(
    project.id,
    "marked.png",
    "image/png",
    png,
  );
  const firstNote = await addNote(store, { imageId: original.job.id, text: "First change" });
  const input = {
    imageId: original.job.id,
    referenceIds: [first.id, second.id],
    idempotencyKey: "interrupted",
  };
  const create = api.create.bind(api);
  api.create = async () => {
    throw new Error("interrupted");
  };
  await expect(createCorrection(api, input)).rejects.toThrow("interrupted");
  const later = await addNote(store, {
    imageId: original.job.id,
    text: "Later change",
  });
  api.create = create;
  const put = store.put.bind(store);
  store.put = async (collection, id, value) => {
    if (collection === "notes" && id === firstNote.id) throw new Error("note write interrupted");
    return put(collection, id, value);
  };
  await expect(createCorrection(api, input)).rejects.toThrow("note write interrupted");
  expect(await store.get("jobs", "IMG-interrupted")).toBeDefined();
  store.put = put;

  const result = await createCorrection(api, input);
  expect(await store.get("notes", firstNote.id)).toMatchObject({ sentInJobId: result.id });
  expect((await store.list("jobs")).length).toBe(2);
  expect(result.prompt).toBe("1. First change");
  expect(result.source).toBe("queue");
  expect(
    (await store.get<{ sentInJobId?: string }>("notes", later.id))?.sentInJobId,
  ).toBeUndefined();
});
it("rejects a correction identity linked to another parent", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await store.put("jobs", "IMG-key", {
    id: "IMG-key",
    parentVersionId: "other",
  });
  await store.put("correction-intents", "key", {
    imageId: "image",
    referenceIds: ["a", "b"],
    noteIds: [],
  });
  await expect(
    createCorrection(new ImageService(store), {
      imageId: "image",
      referenceIds: ["a", "b"],
      idempotencyKey: "key",
    }),
  ).rejects.toThrow("another image");
});
it("rejects legacy correction recovery when its saved notes are missing", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image", status: "done" });
  await store.put("correction-intents", "key", {
    imageId: "image",
    referenceIds: ["a", "b"],
    noteIds: ["missing"],
  });
  await expect(
    createCorrection(new ImageService(store), {
      imageId: "image",
      referenceIds: ["a", "b"],
      idempotencyKey: "key",
    }),
  ).rejects.toThrow("unavailable");
});

it.each(["queued", "running", "failed", "blocked", "uncertain", "cancelled"])("rejects a new correction for a %s parent", async status => {
  const {ImageService} = await import("../src/core/service");
  const {createCorrection} = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "parent", {id:"parent",status});
  await expect(createCorrection(new ImageService(store), {
    imageId:"parent",referenceIds:["a","b"],idempotencyKey:"new",instruction:"Change sky",
  })).rejects.toThrow("Wait for the image to finish");
  expect(await store.get("correction-intents","new")).toBeFalsy();
});


it.each([{ w: 0, h: 0.2 }, { w: 0.2, h: 0 }])("rejects zero-area annotation regions", async dimensions => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await expect(addNote(store, { imageId: "image", text: "Region", x: 0, y: 0, ...dimensions })).rejects.toThrow();
  expect(await store.list("notes")).toEqual([]);
});


it("does not write a note while its image is locked for deletion", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await store.lock("image", async () => {
    await expect(addNote(store, { imageId: "image", text: "Concurrent note" })).rejects.toThrow("in progress");
    await store.delete("jobs", "image");
  });
  await expect(addNote(store, { imageId: "image", text: "Late note" })).rejects.toThrow("does not exist");
  expect(await store.list("notes")).toEqual([]);
});


it("cannot mark notes after their source image was deleted", async () => {
  const { markNotesSent } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "correction", { id: "correction", parentVersionId: "image" });
  await expect(markNotesSent(store, "image", "correction")).rejects.toThrow("does not exist");
  expect(await store.list("notes")).toEqual([]);
});

it("does not update sent-note state while the source image is locked", async () => {
  const { markNotesSent } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await store.put("jobs", "correction", { id: "correction", parentVersionId: "image" });
  await store.put("notes", "note", { id: "note", imageId: "image", text: "Change sky" });
  await store.lock("image", async () => {
    await expect(markNotesSent(store, "image", "correction")).rejects.toThrow("in progress");
  });
  expect(await store.get("notes", "note")).not.toHaveProperty("sentInJobId");
  await markNotesSent(store, "image", "correction");
  expect(await store.get("notes", "note")).toHaveProperty("sentInJobId", "correction");
});


it.each([
  ["../image", "correction", undefined],
  ["image", "../correction", undefined],
  ["image", "correction", ["../note"]],
])("rejects invalid sent-note identifiers before storage access", async (imageId, jobId, noteIds) => {
  const { markNotesSent } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await expect(markNotesSent(store, imageId as string, jobId as string, noteIds as string[] | undefined)).rejects.toThrow();
  expect(await store.list("notes")).toEqual([]);
});


it("validates correction identifiers before reading source records", async () => {
  const { createCorrection } = await import("../src/core/notes");
  const { ImageService } = await import("../src/core/service");
  const api = new ImageService(new MemoryStorage());
  await expect(createCorrection(api, {
    imageId: "../image", referenceIds: ["first", "second"], idempotencyKey: "key",
  })).rejects.toThrow();
  await expect(createCorrection(api, {
    imageId: "image", referenceIds: ["../first", "second"], idempotencyKey: "key",
  })).rejects.toThrow();
});

it("does not create a correction without an instruction or unsent notes", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Notes");
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await expect(createCorrection(api, {
    imageId: job.id, idempotencyKey: "empty-correction",
    referenceIds: ["original", "annotated"],
  })).rejects.toThrow("Add an unsent note first");
  expect(await store.get("jobs", "IMG-empty-correction")).toBeUndefined();
});

it("rejects missing prepared notes before creating a correction", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Notes");
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await expect(createCorrection(api, {
    imageId: job.id, idempotencyKey: "missing-note", instruction: "Fix image",
    referenceIds: ["original", "annotated"], noteIds: ["deleted-note"],
  })).rejects.toThrow("Prepared correction notes are unavailable");
  expect(await store.get("jobs", "IMG-missing-note")).toBeUndefined();
});

it.each([
  { id: "one", imageId: "different-image" },
  { id: "unlisted", imageId: "image" },
])("rejects a prepared note outside the correction snapshot (%j)", async ({ id, imageId }) => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await expect(createCorrection(new ImageService(store), {
    imageId: "image",
    idempotencyKey: "snapshot",
    referenceIds: ["original", "annotated"],
    noteIds: ["one"],
    noteSnapshot: [{ id, imageId, text: "Change", createdAt: "now" }],
  })).rejects.toThrow("Invalid prepared note snapshot");
  expect(await store.list("jobs")).toEqual([]);
});

it("rejects duplicate entries in a prepared note snapshot", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  const note = { id: "one", imageId: "image", text: "Change", createdAt: "now" };
  await expect(createCorrection(new ImageService(store), {
    imageId: "image", idempotencyKey: "snapshot", referenceIds: ["original", "annotated"],
    noteIds: ["one", "two"], noteSnapshot: [note, note],
  })).rejects.toThrow("Incomplete prepared note snapshot");
  expect(await store.list("jobs")).toEqual([]);
});

it("orders prepared snapshot text by its annotation identifiers", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Snapshot order");
  const { job } = await api.importImage("image.png", "image/png", png, project.id);
  await store.put("jobs", job.id, { ...job, width: 256, height: 256 });
  const first = await addNote(store, { imageId: job.id, text: "First" });
  const second = await addNote(store, { imageId: job.id, text: "Second" });
  const original = await api.addReference(project.id, "original", "image/png", png);
  const annotated = await api.addReference(project.id, "annotated", "image/png", png);
  const correction = await createCorrection(api, {
    imageId: job.id, idempotencyKey: "snapshot-order", referenceIds: [original.id, annotated.id],
    noteIds: [first.id, second.id], noteSnapshot: [second, first],
  });
  expect(correction.prompt).toBe("1. First\n\n2. Second");
});

it("recovers a linked legacy correction without sending newly added notes", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image", status: "done" });
  const correction = { id: "IMG-legacy-linked", parentVersionId: "image" };
  await store.put("jobs", correction.id, correction);
  await store.put("correction-intents", "legacy-linked", {
    imageId: "image",
    referenceIds: ["original", "annotated"],
  });
  const note = await addNote(store, { imageId: "image", text: "New feedback" });

  await expect(createCorrection(new ImageService(store), {
    imageId: "image",
    referenceIds: ["original", "annotated"],
    idempotencyKey: "legacy-linked",
  })).resolves.toEqual(correction);
  expect(await store.get("notes", note.id)).toEqual(note);
  expect(await store.list("jobs")).toHaveLength(2);
});

it("links an interrupted correction and marks its saved notes as sent", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image", status: "done", createdAt: "2026-01-01" });
  await store.put("jobs", "IMG-recover-stack", { id: "IMG-recover-stack", status: "queued", createdAt: "2026-01-02" });
  const note = await addNote(store, { imageId: "image", text: "Adjust lighting" });
  const input = {
    imageId: "image",
    referenceIds: ["original", "annotated"],
    idempotencyKey: "recover-stack",
  };
  await store.put("correction-intents", input.idempotencyKey, { ...input, noteIds: [note.id] });

  const service = new ImageService(store);
  const recovered = await createCorrection(service, input);
  expect(recovered).toMatchObject({ id: "IMG-recover-stack", parentVersionId: "image", versionNumber: 2 });
  expect(await store.get("jobs", "image")).toMatchObject({ stackId: recovered.stackId, versionNumber: 1 });
  expect(await store.get("notes", note.id)).toMatchObject({ sentInJobId: recovered.id });
  expect(await createCorrection(service, input)).toEqual(recovered);
  expect(await store.list("jobs")).toHaveLength(2);
});

it.each([
  [undefined, "Image does not exist"],
  [{ status: "done", archivedAt: "2026-01-02" }, "Restore the image"],
  [{ status: "done", trashedAt: "2026-01-02" }, "Restore the image"],
  [{ status: "queued" }, "Wait for the image to finish"],
])("rejects a correction when the source image is unavailable (%j)", async (image, message) => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const store = new MemoryStorage();
  if (image) await store.put("jobs", "image", { id: "image", ...image });

  await expect(createCorrection(new ImageService(store), {
    imageId: "image",
    referenceIds: ["original", "annotated"],
    idempotencyKey: "unavailable",
    instruction: "Adjust lighting",
  })).rejects.toThrow(message);
  expect(await store.list("correction-intents")).toEqual([]);
  expect(await store.get("jobs", "IMG-unavailable")).toBeUndefined();
});

it.each([
  ["text", { text: "Updated feedback" }],
  ["x", { x: 0.4 }],
  ["y", { y: 0.4 }],
  ["width", { w: 0.4 }],
  ["height", { h: 0.4 }],
  ["missing snapshot entry", null],
])("leaves a note unsent when the correction snapshot differs in %s", async (_field, changes) => {
  const { markNotesSent } = await import("../src/core/notes");
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image" });
  await store.put("jobs", "correction", { id: "correction", parentVersionId: "image" });
  const snapshot = await addNote(store, { imageId: "image", text: "Adjust lighting", x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  const current = { ...snapshot, ...changes };
  await store.put("notes", current.id, current);

  await markNotesSent(store, "image", "correction", [current.id], changes ? [snapshot] : []);

  expect(await store.get("notes", current.id)).toEqual(current);
});

it("queues a correction with the generated image's provider and model", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const { png } = await import("./fixtures");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Provider correction");
  await store.put("jobs", "image", {
    id: "image", projectId: project.id, status: "done", createdAt: "2026-01-01",
    source: "api", provider: "openrouter", model: "google/gemini-3-pro-image-preview",
    width: 1024, height: 1024,
  });
  const original = await api.addReference(project.id, "original.png", "image/png", png);
  const annotated = await api.addReference(project.id, "annotated.png", "image/png", png);

  const correction = await createCorrection(api, {
    imageId: "image",
    referenceIds: [original.id, annotated.id],
    idempotencyKey: "provider-correction",
    instruction: "Adjust lighting",
  });

  expect(correction).toMatchObject({
    parentVersionId: "image", status: "queued", source: "api",
    provider: "openrouter", model: "google/gemini-3-pro-image-preview",
    width: 1024, height: 1024,
  });
});

it("uses an explicit source for an imported image correction", async () => {
  const { createCorrection } = await import("../src/core/notes");
  const { ImageService } = await import("../src/core/service");
  const { MemoryStorage } = await import("../src/storage/memory");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("Source test");
  const original = await api.create({projectId:project.id,idempotencyKey:"source-original",prompt:"Image",source:"queue",provider:"openai",model:"",width:1024,height:1024,transparent:false,referenceIds:[]});
  await store.put("jobs",original.id,{...original,status:"done",imported:true,opacityVerified:true});
  for (const id of ["source-ref","notes-ref"]) await store.put("references",id,{id,projectId:project.id,kind:"image"});
  const next = await createCorrection(api,{imageId:original.id,referenceIds:["source-ref","notes-ref"],idempotencyKey:"source-next",instruction:"Make the circle square",generation:{source:"api",provider:"openai",model:"gpt-image-1.5"}});
  expect(next).toMatchObject({source:"api",provider:"openai",model:"gpt-image-1.5"});
});

it("rechecks legacy imported pixels before API editing instead of inheriting an unverified alpha flag", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const sharp = (await import("sharp")).default;
  const store = new MemoryStorage(), api = new ImageService(store);
  const project = await api.createProject("Legacy import");
  const bytes = await sharp({create:{width:480,height:480,channels:4,background:{r:200,g:100,b:200,alpha:1}}}).png().toBuffer();
  const {job} = await api.importImage("opaque.png", "image/png", bytes, project.id);
  await store.put("jobs",job.id,{...job,transparent:true,opacityVerified:undefined});
  const refs = await Promise.all(["original","notes"].map(name => api.addReference(project.id,name,"image/png",bytes)));
  await store.put("models","openai",[{id:"gpt-image-2.6-flare",provider:"openai",references:true,transparency:false}]);
  const input = {imageId:job.id,referenceIds:refs.map(ref=>ref.id),idempotencyKey:"legacy-opaque",instruction:"Make the circle cyan",generation:{source:"api" as const,provider:"openai" as const,model:"gpt-image-2.6-flare"}};
  const correction = await createCorrection(api,input);
  expect(correction).toMatchObject({transparent:false,width:480,height:480,source:"api"});
  const { resolveModelSize } = await import("../src/core/size-intent");
  expect(resolveModelSize({mode:"fixed",sizes:[{width:1024,height:1024}]},correction)).toMatchObject({target:{width:480,height:480},parameters:{size:"1024x1024"},requiresResize:true});
  expect((await createCorrection(api,input)).id).toBe(correction.id);
});

it("rejects unsupported real alpha before persisting an API correction or consuming notes", async () => {
  const { ImageService } = await import("../src/core/service");
  const { createCorrection } = await import("../src/core/notes");
  const sharp = (await import("sharp")).default;
  const store = new MemoryStorage(), api = new ImageService(store);
  const project = await api.createProject("Transparent import");
  const bytes = await sharp({create:{width:480,height:480,channels:4,background:{r:200,g:100,b:200,alpha:0}}}).png().toBuffer();
  const {job} = await api.importImage("transparent.png","image/png",bytes,project.id);
  const note = await addNote(store,{imageId:job.id,text:"Change the circle"});
  const refs = await Promise.all(["original","notes"].map(name => api.addReference(project.id,name,"image/png",bytes)));
  await store.put("models","openai",[{id:"gpt-image-2.6-flare",provider:"openai",references:true,transparency:false}]);
  await expect(createCorrection(api,{imageId:job.id,referenceIds:refs.map(ref=>ref.id),idempotencyKey:"alpha-blocked",generation:{source:"api",provider:"openai",model:"gpt-image-2.6-flare"}})).rejects.toThrow("supports transparent images");
  expect(await store.get("jobs","IMG-alpha-blocked")).toBeUndefined();
  expect(await store.get("correction-intents","alpha-blocked")).toBeUndefined();
  expect(await store.get("notes",note.id)).not.toHaveProperty("sentInJobId");
});
