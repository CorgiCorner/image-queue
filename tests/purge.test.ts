import { expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { purgeJobs, recoverPurges } from "../src/core/purge";
it("deletes trashed records and unshared bytes with a tombstone", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01",blobKey:"results/one"});
  await store.putBlob("results/one", new Uint8Array([1]), "image/png");
  expect(await purgeJobs(store, ["one"])).toEqual(["one"]);
  expect(await store.get("jobs", "one")).toBeUndefined();
  expect(await store.get("tombstones", "one")).toBeTruthy();
  expect(await store.getBlob("results/one")).toBeUndefined();
});
it("recovers an interrupted deletion", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01"});
  vi.spyOn(store, "delete").mockRejectedValueOnce(new Error("interrupted"));
  await expect(purgeJobs(store, ["one"])).rejects.toThrow("interrupted");
  await recoverPurges(store);
  expect(await store.get("jobs", "one")).toBeUndefined();
  expect((await store.list<{complete:boolean}>("purge-operations"))[0].complete).toBe(true);
});

it("keeps a blob while another job still references it", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01",blobKey:"results/shared"});
  await store.put("jobs", "two", {id:"two",status:"done",blobKey:"results/shared"});
  await store.putBlob("results/shared", new Uint8Array([1,2]), "image/png");
  await purgeJobs(store, ["one"]);
  expect(await store.getBlob("results/shared")).toBeTruthy();
  expect(await store.get("jobs", "two")).toBeTruthy();
});

it("keeps a blob referenced by an imported reference", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01",blobKey:"results/shared"});
  await store.put("references", "reference", {id:"reference",blobKey:"results/shared"});
  await store.putBlob("results/shared", new Uint8Array([1]), "image/png");
  await purgeJobs(store, ["one"]);
  expect(await store.getBlob("results/shared")).toBeTruthy();
});

it("leaves externally owned output paths untouched", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "image-queue-external-output-"));
  try {
    const outputPath = join(directory, "result.png");
    await writeFile(outputPath, new Uint8Array([1, 2, 3]));
    const store = new MemoryStorage();
    await store.put("jobs", "one", {
      id: "one", status: "done", trashedAt: "2026-01-01", outputPath,
    });
    await purgeJobs(store, ["one"]);
    expect([...await readFile(outputPath)]).toEqual([1, 2, 3]);
    expect(await store.get("jobs", "one")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("removes notes only for purged images", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01"});
  await store.put("notes", "removed", {id:"removed",imageId:"one",text:"Old note"});
  await store.put("notes", "kept", {id:"kept",imageId:"two",text:"Keep note"});
  await purgeJobs(store, ["one"]);
  expect(await store.get("notes", "removed")).toBeUndefined();
  expect(await store.get("notes", "kept")).toBeTruthy();
});

it("recovers after blob deletion fails without resurrecting the record", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01",blobKey:"results/one"});
  await store.putBlob("results/one", new Uint8Array([1]), "image/png");
  vi.spyOn(store, "deleteBlob").mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(purgeJobs(store, ["one"])).rejects.toThrow("storage unavailable");
  expect(await store.get("jobs", "one")).toBeUndefined();
  expect(await store.get("tombstones", "one")).toBeTruthy();
  expect(await store.getBlob("results/one")).toBeTruthy();
  await recoverPurges(store);
  expect(await store.getBlob("results/one")).toBeUndefined();
  await recoverPurges(store);
  expect(await store.get("jobs", "one")).toBeUndefined();
});

it("waits for exclusive job access before deleting records", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01"});
  await store.lock("one", async () => {
    await expect(purgeJobs(store, ["one"])).rejects.toThrow("operation is in progress");
    expect(await store.get("jobs", "one")).toBeTruthy();
  });
  await recoverPurges(store);
  expect(await store.get("jobs", "one")).toBeUndefined();
});

it("preserves a restored job when a pending purge is recovered", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", {id:"one",status:"done",trashedAt:"2026-01-01"});
  await store.lock("one", async () => {
    await expect(purgeJobs(store, ["one"])).rejects.toThrow("operation is in progress");
  });
  await store.put("jobs", "one", {id:"one",status:"done",blobKey:"results/restored"});
  await store.putBlob("results/restored", new Uint8Array([7]), "image/png");
  await store.put("notes", "restored-note", {id:"restored-note",imageId:"one",text:"Keep"});
  await recoverPurges(store);
  expect(await store.get("jobs", "one")).toBeTruthy();
  expect(await store.get("tombstones", "one")).toBeUndefined();
  expect(await store.get("notes", "restored-note")).toBeTruthy();
  expect(await store.getBlob("results/restored")).toBeTruthy();
});


it("removes all cached thumbnail sizes and preserves shared thumbnails", async () => {
  const store = new MemoryStorage();
  for (const id of ["one", "shared", "kept"]) {
    await store.put("jobs", id, { id, status: "done", trashedAt: "2026-01-01" });
    await store.put("asset-meta", id, { id, hash: id === "one" ? "unique" : "shared" });
  }
  for (const digest of ["unique", "shared"]) {
    for (const size of [160, 320, 640, 1280]) {
      await store.putBlob(`thumbs/${digest}/${size}.webp`, new Uint8Array([1]), "image/webp");
    }
  }
  await purgeJobs(store, ["one", "shared"]);
  for (const size of [160, 320, 640, 1280]) {
    expect(await store.getBlob(`thumbs/unique/${size}.webp`)).toBeUndefined();
    expect(await store.getBlob(`thumbs/shared/${size}.webp`)).toBeTruthy();
  }
});

it("resumes thumbnail cleanup after metadata and some sizes were deleted", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", status: "done", trashedAt: "2026-01-01" });
  await store.put("asset-meta", "one", { id: "one", hash: "digest" });
  for (const size of [160, 320, 640, 1280]) {
    await store.putBlob(`thumbs/digest/${size}.webp`, new Uint8Array([1]), "image/webp");
  }
  const deleteBlob = store.deleteBlob.bind(store);
  let interrupted = false;
  vi.spyOn(store, "deleteBlob").mockImplementation(async key => {
    if (key.endsWith("320.webp") && !interrupted) {
      interrupted = true;
      throw new Error("interrupted thumbnail cleanup");
    }
    await deleteBlob(key);
  });
  await expect(purgeJobs(store, ["one"])).rejects.toThrow("interrupted thumbnail cleanup");
  expect(await store.get("asset-meta", "one")).toBeUndefined();
  expect(await store.getBlob("thumbs/digest/160.webp")).toBeUndefined();
  expect(await store.getBlob("thumbs/digest/320.webp")).toBeTruthy();
  await recoverPurges(store);
  for (const size of [160, 320, 640, 1280]) {
    expect(await store.getBlob(`thumbs/digest/${size}.webp`)).toBeUndefined();
  }
  expect((await store.list<{ complete: boolean }>("purge-operations"))[0].complete).toBe(true);
});


it("purges expired trash while retaining recent and active jobs", async () => {
  const { purgeExpiredTrash } = await import("../src/core/purge");
  const store = new MemoryStorage();
  for (const job of [
    { id: "expired", status: "done", trashedAt: "2026-10-15T12:00:00Z" },
    { id: "recent", status: "done", trashedAt: "2026-10-15T12:00:01Z" },
    { id: "active", status: "running", trashedAt: "2026-10-01T00:00:00Z" },
  ]) await store.put("jobs", job.id, job);
  expect(await purgeExpiredTrash(store, Date.parse("2026-11-14T12:00:00Z"))).toEqual(["expired"]);
  expect(await store.get("jobs", "expired")).toBeUndefined();
  expect(await store.get("jobs", "recent")).toBeTruthy();
  expect(await store.get("jobs", "active")).toBeTruthy();
  expect(await purgeExpiredTrash(store, Date.parse("2026-11-14T12:00:00Z"))).toEqual([]);
});

it("rejects retention undo after permanent deletion without resurrecting the image", async () => {
  const { changeRetention, undoRetention } = await import("../src/core/retention");
  const store = new MemoryStorage();
  await store.put("jobs", "one", { id: "one", status: "done" });
  const result = await changeRetention(store, { ids: ["one"], operation: "trash" });
  await purgeJobs(store, ["one"]);
  await expect(undoRetention(store, result.undoId)).rejects.toThrow("newer change");
  expect(await store.get("jobs", "one")).toBeUndefined();
  expect(await store.get("tombstones", "one")).toBeTruthy();
});

it("recovers older purge records without thumbnail hashes alongside completed operations", async () => {
  const store = new MemoryStorage();
  await store.put("purge-operations", "complete", {
    id: "complete", jobIds: [], blobKeys: [], deletedAt: "2026-01-01", complete: true,
  });
  await store.put("purge-operations", "legacy", {
    id: "legacy", jobIds: ["gone"], blobKeys: [], deletedAt: "2026-01-01", complete: false,
  });
  await recoverPurges(store);
  expect(await store.get("tombstones", "gone")).toBeTruthy();
  expect(await store.get("purge-operations", "legacy")).toMatchObject({ complete: true });
});

it("retains an original blob acquired by another job before recovery", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "kept", { id: "kept", status: "done", blobKey: "results/shared" });
  await store.putBlob("results/shared", new Uint8Array([1]), "image/png");
  await store.put("purge-operations", "pending", {
    id: "pending", jobIds: ["gone"], blobKeys: ["results/shared"],
    deletedAt: "2026-01-01", complete: false,
  });
  await recoverPurges(store);
  expect(await store.getBlob("results/shared")).toBeTruthy();
});

it("preserves an original added to references after the purge was planned", async () => {
  const store = new MemoryStorage();
  const blobKey = "results/reference";
  await store.putBlob(blobKey, new Uint8Array([42]), "image/png");
  await store.put("references", "saved", { id: "saved", blobKey });
  await store.put("purge-operations", "pending", {
    id: "pending", jobIds: ["gone"], blobKeys: [blobKey],
    deletedAt: "2026-01-01", complete: false,
  });

  await recoverPurges(store);

  expect(await store.getBlob(blobKey)).toBeTruthy();
  expect(await store.get("purge-operations", "pending")).toMatchObject({ complete: true });
});

it("retries an interrupted permanent delete with the same IDs", async () => {
  const store = new MemoryStorage();
  const blobKey = "results/retry";
  await store.put("jobs", "retry", { id: "retry", status: "done", trashedAt: "2026-01-01", blobKey });
  await store.putBlob(blobKey, new Uint8Array([1]), "image/png");
  vi.spyOn(store, "deleteBlob").mockRejectedValueOnce(new Error("interrupted"));

  await expect(purgeJobs(store, ["retry"])).rejects.toThrow("interrupted");
  await expect(purgeJobs(store, ["retry"])).resolves.toEqual(["retry"]);
  expect(await store.getBlob(blobKey)).toBeUndefined();
  await expect(purgeJobs(store, ["retry"])).resolves.toEqual(["retry"]);
  await expect(purgeJobs(store, ["unknown"])).rejects.toThrow("no longer exists");
});

it("keeps unrelated interrupted operations out of a manual purge", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "selected", { id: "selected", status: "done", trashedAt: "2026-01-01" });
  await store.put("purge-operations", "unrelated", {
    id: "unrelated", jobIds: ["other"], blobKeys: ["results/other"],
    deletedAt: "2026-01-01", complete: false,
  });
  vi.spyOn(store, "deleteBlob").mockRejectedValue(new Error("unavailable"));

  await expect(purgeJobs(store, ["selected"])).resolves.toEqual(["selected"]);
  expect(await store.get("purge-operations", "unrelated")).toMatchObject({ complete: false });
});
