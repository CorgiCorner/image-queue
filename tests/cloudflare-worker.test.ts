import { expect, it, vi } from "vitest";
const { maintain, fetchHandler, bindings } = vi.hoisted(() => ({
  maintain: vi.fn().mockResolvedValue([]), fetchHandler: vi.fn(), bindings: vi.fn(),
}));
vi.mock("./.open-next/worker.js", () => ({ default: { fetch: fetchHandler } }));
vi.mock("../src/core/maintenance", () => ({ maintainTrash: maintain }));
vi.mock("../src/storage/cloudflare", () => ({
  CloudflareStorage: class { constructor(db: unknown, blobs: unknown) { bindings(db, blobs); } },
}));
import worker from "../cloudflare-worker";

it("preserves the app handler and awaits scheduled maintenance with event time", async () => {
  const env = { DB: {}, BLOBS: {} } as Parameters<typeof worker.scheduled>[1];
  await worker.scheduled({ scheduledTime: 12345 }, env);
  expect(worker.fetch).toBe(fetchHandler);
  expect(bindings).toHaveBeenCalledWith(env.DB, env.BLOBS);
  expect(maintain).toHaveBeenCalledWith(expect.anything(), 12345);
});

it("keeps the hourly trigger and custom entry point in deployment configuration", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  expect(config.main).toBe("cloudflare-worker.ts");
  expect(config.triggers.crons).toEqual(["0 * * * *"]);
});

it("propagates maintenance failure to the scheduled invocation", async () => {
  maintain.mockRejectedValueOnce(new Error("maintenance failed"));
  const env = { DB: {}, BLOBS: {} } as Parameters<typeof worker.scheduled>[1];
  await expect(worker.scheduled({ scheduledTime: 12345 }, env)).rejects.toThrow("maintenance failed");
});
