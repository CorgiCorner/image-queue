import { describe, expect, it } from "vitest";
import { CloudflareStorage } from "../src/storage/cloudflare";

function bindings() {
  const records = new Map<string, string>();
  const locks = new Map<string, string>();
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              const value = records.get(`${args[0]}/${args[1]}`);
              return value ? { value } : null;
            },
            async all() {
              return {
                results: [...records.entries()]
                  .filter(([k]) => k.startsWith(`${args[0]}/`))
                  .map(([key, value]) => ({ id: key.slice(String(args[0]).length + 1), value })),
              };
            },
            async run() {
              if (sql.startsWith("INSERT INTO records"))
                records.set(`${args[0]}/${args[1]}`, String(args[2]));
              if (sql.startsWith("INSERT INTO locks")) {
                if (locks.has(String(args[0]))) throw new Error("unique");
                locks.set(String(args[0]), String(args[1]));
              }
              if (sql.startsWith("DELETE FROM records")) records.delete(`${args[0]}/${args[1]}`);
              if (sql.startsWith("DELETE FROM locks"))
                locks.delete(String(args[0]));
            },
          };
        },
      };
    },
  };
  const bucket = {
    async delete(key: string) { blobs.delete(key); },
    async put(
      key: string,
      bytes: Uint8Array,
      options: { httpMetadata: { contentType: string } },
    ) {
      blobs.set(key, { bytes, mime: options.httpMetadata.contentType });
    },
    async get(key: string) {
      const blob = blobs.get(key);
      return blob
        ? {
            arrayBuffer: async () => blob.bytes.buffer,
            httpMetadata: { contentType: blob.mime },
          }
        : null;
    },
  };
  return new CloudflareStorage(db as never, bucket as never);
}
describe("Cloudflare storage contract", () => {
  it("stores, replaces and lists JSON records", async () => {
    const s = bindings();
    expect(await s.get("jobs", "missing")).toBeUndefined();
    await s.put("jobs", "one", { name: "one" });
    await s.put("jobs", "one", { name: "two" });
    expect(await s.get("jobs", "one")).toEqual({ name: "two" });
    expect(await s.list("jobs")).toEqual([{ name: "two" }]);
  });
  it("stores files with their MIME type", async () => {
    const s = bindings();
    expect(await s.getBlob("missing")).toBeUndefined();
    await s.putBlob("refs/a", new Uint8Array([1]), "image/png");
    expect(await s.getBlob("refs/a")).toEqual({
      bytes: new Uint8Array([1]),
      mime: "image/png",
    });
  });
  it("serializes mutations and releases failed operations", async () => {
    const s = bindings();
    await s.lock("test", async () => {
      await expect(s.lock("test", async () => 1)).rejects.toThrow("progress");
    });
    await expect(
      s.lock("test", async () => {
        throw Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(await s.lock("test", async () => 2)).toBe(2);
  });
});

it("deletes records and blobs independently and idempotently", async () => {
  const store = bindings();
  await store.put("jobs", "one", { id: "one" });
  await store.putBlob("results/one", new Uint8Array([1]), "image/png");
  await store.delete("jobs", "one");
  await store.delete("jobs", "one");
  expect(await store.get("jobs", "one")).toBeUndefined();
  expect(await store.getBlob("results/one")).toBeTruthy();
  await store.deleteBlob("results/one");
  await store.deleteBlob("results/one");
  expect(await store.getBlob("results/one")).toBeUndefined();
});

it("enumerates Cloudflare records by storage ID without requiring an embedded ID", async () => {
  const store = bindings();
  await store.put("records", "legacy", { name: "Legacy" });
  expect(await store.entries("records")).toEqual([{ id: "legacy", value: { name: "Legacy" } }]);
});
