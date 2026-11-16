import { afterEach, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, BLOBS: {} } })),
}));

import { storage } from "../src/storage";
import { CloudflareStorage } from "../src/storage/cloudflare";
import { ProjectStorage } from "../src/storage/project-storage";
import { FileStorage } from "../src/storage/fs";

afterEach(() => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.STORAGE_DIR;
});
it("selects the filesystem by default", async () => {
  const store = await storage();
  expect(store).toBeInstanceOf(ProjectStorage);
  expect((store as ProjectStorage).workspace).toBeInstanceOf(FileStorage);
});
it("selects D1 and R2 for Cloudflare", async () => {
  process.env.STORAGE_DRIVER = "cloudflare";
  expect(await storage()).toBeInstanceOf(CloudflareStorage);
});
