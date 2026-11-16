import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  localCredential,
  saveLocalCredential,
  removeLocalCredential,
} from "../src/storage/credentials";
let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
it("round-trips and removes a private fallback credential", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-credential-"));
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR", root);
  expect(await localCredential("openai")).toBeUndefined();
  await saveLocalCredential("openai", "test-credential");
  expect(await localCredential("openai")).toBe("test-credential");
  await removeLocalCredential("openai");
  expect(await localCredential("openai")).toBeUndefined();
});
it("supports replacing an existing credential", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-credential-"));
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR", root);
  await saveLocalCredential("openrouter", "first");
  await saveLocalCredential("openrouter", "second");
  expect(await localCredential("openrouter")).toBe("second");
  await removeLocalCredential("openrouter");
  await removeLocalCredential("openrouter");
});
it("propagates filesystem read errors", async () => {
  root = await mkdtemp(path.join(tmpdir(), "image-queue-credential-"));
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR", root);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "openai.key"));
  await expect(localCredential("openai")).rejects.toThrow();
});
