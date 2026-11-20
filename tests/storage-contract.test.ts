import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowLoopbackForLocalRuntime } from "./network-guard";
import { getPlatformProxy } from "wrangler";
import { CloudflareStorage } from "../src/storage/cloudflare";
import { FileStorage } from "../src/storage/fs";
import { MemoryStorage } from "../src/storage/memory";
import type { Storage } from "../src/storage/types";
const directories: string[] = [];
const disposables: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposables.splice(0).reverse()) await dispose();
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});
for (const driver of ["disk", "memory", "cloudflare"]) {
  describe(`${driver} storage contract`, () => {
    async function store(): Promise<Storage> {
      if (driver === "memory") return new MemoryStorage();
      const root = await mkdtemp(join(tmpdir(), "image-queue-contract-"));
      directories.push(root);
      if (driver === "disk") return new FileStorage(root);
      const configPath = join(root, "wrangler.json");
      await writeFile(configPath, JSON.stringify({
        name: "storage-contract",
        compatibility_date: "2026-01-01",
        d1_databases: [{ binding: "DB", database_name: "contract", database_id: "contract" }],
        r2_buckets: [{ binding: "BUCKET", bucket_name: "contract" }],
      }));
      type Bindings = {
        DB: ConstructorParameters<typeof CloudflareStorage>[0] & { exec(sql: string): Promise<unknown> };
        BUCKET: ConstructorParameters<typeof CloudflareStorage>[1];
      };
      const disallowLoopback = allowLoopbackForLocalRuntime();
      disposables.push(async () => disallowLoopback());
      const proxy = await getPlatformProxy<Bindings>({ configPath, persist: false, remoteBindings: false });
      disposables.push(() => proxy.dispose());
      for (const migration of ["0001.sql", "0002.sql"])
        await proxy.env.DB.exec((await readFile(`migrations/${migration}`, "utf8")).trim());
      return new CloudflareStorage(proxy.env.DB, proxy.env.BUCKET);
    }
    it("round-trips records and isolates returned values", async () => {
      const storage = await store();
      expect(await storage.get("projects", "missing")).toBeUndefined();
      expect(await storage.list("projects")).toEqual([]);
      await storage.put("projects", "one", { name: "One" });
      const value = await storage.get<{ name: string }>("projects", "one");
      value!.name = "Changed";
      expect(await storage.list("projects")).toEqual([{ name: "One" }]);
    });
    it("enumerates storage IDs separately from record values", async () => {
      const storage = await store();
      await storage.put("records", "legacy", { name: "Legacy" });
      expect(await storage.entries!("records")).toEqual([{ id: "legacy", value: { name: "Legacy" } }]);
    });
    it("deletes only the requested record and allows repeated deletion", async () => {
      const storage = await store();
      await storage.put("projects", "one", { name: "One" });
      await storage.put("projects", "two", { name: "Two" });
      await storage.delete("projects", "one");
      await storage.delete("projects", "one");
      expect(await storage.get("projects", "one")).toBeUndefined();
      expect(await storage.get("projects", "two")).toEqual({ name: "Two" });
    });
    it("deletes blob bytes idempotently", async () => {
      const storage = await store();
      await storage.putBlob("images/delete", new Uint8Array([1]), "image/png");
      await storage.deleteBlob("images/delete");
      await storage.deleteBlob("images/delete");
      expect(await storage.getBlob("images/delete")).toBeUndefined();
    });
    if (driver === "disk") it("allows an externally evicted thumbnail to be rebuilt", async () => {
      const storage = await store() as FileStorage;
      const key = "thumbs/pixels/320.webp";
      const bytes = new Uint8Array([1, 2, 3]);
      await storage.putBlob(key, bytes, "image/webp");
      // Cache files are disposable even when their MIME metadata still exists.
      await rm(join(storage.root, "blobs", key));
      expect(await storage.getBlob(key)).toBeUndefined();
      await storage.putBlob(key, bytes, "image/webp");
      expect(await storage.getBlob(key)).toEqual({ bytes, mime: "image/webp" });
    });
    it("round-trips bytes and releases locks on failure", async () => {
      const storage = await store();
      expect(await storage.getBlob("missing")).toBeUndefined();
      await storage.putBlob("images/one", new Uint8Array([1, 2]), "image/png");
      expect(await storage.getBlob("images/one")).toEqual({
        bytes: new Uint8Array([1, 2]),
        mime: "image/png",
      });
      await expect(
        storage.lock("one", async () => {
          throw new Error("test");
        }),
      ).rejects.toThrow("test");
      await storage.lock("one", async () => {
        await expect(storage.lock("one", async () => 1)).rejects.toThrow(
          "progress",
        );
      });
      await expect(storage.put("../escape", "one", {})).rejects.toThrow(
        "Invalid",
      );
    });
  });
}
