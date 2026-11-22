import { REFERENCE_VIEW_URI } from "../src/mcp/apps";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer } from "../src/mcp/server";
import { png } from "./fixtures";
import { referenceUploadPlan, renamed, scaledSize } from "../src/mcp/views/reference-file";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mcp-reference-upload-"));
  process.env.STORAGE_DIR = path.join(root, "store");
  process.env.CODEX_QUEUE_DIR = path.join(root, "queue");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.STORAGE_DIR;
  delete process.env.CODEX_QUEUE_DIR;
  delete process.env.STORAGE_DRIVER;
});

async function connected() {
  const server = createServer({ appViews: "always" });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text);

it("offers an upload card for images attached to the chat and keeps the storing tool for the card only", async () => {
  const { client, close } = await connected();
  const tools = Object.fromEntries((await client.listTools()).tools.map(tool => [tool.name, tool]));
  const resources = (await client.listResources()).resources.map(resource => resource.uri);
  await close();
  expect(tools.upload_reference?._meta).toMatchObject({ ui: { resourceUri: REFERENCE_VIEW_URI } });
  expect(tools.upload_reference?.annotations).toMatchObject({ readOnlyHint: true });
  expect(tools.upload_reference?.description).toContain("attached");
  expect(tools.save_uploaded_reference?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect(resources).toContain(REFERENCE_VIEW_URI);
});

it("stores an image the card sends and returns a reference ID that request tools accept", async () => {
  const { client, close } = await connected();
  try {
    expect(text(await client.callTool({ name: "upload_reference", arguments: { projectId: "inbox" } }))).toMatchObject({ projectId: "inbox" });
    const saved = text(await client.callTool({ name: "save_uploaded_reference", arguments: {
      projectId: "inbox", name: "cat.png", mime: "image/png", data: Buffer.from(png).toString("base64"),
    } }));
    expect(saved).toMatchObject({ name: "cat.png", projectId: "inbox", mime: "image/png" });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    const rejected = await client.callTool({ name: "save_uploaded_reference", arguments: {
      projectId: "inbox", name: "fake.png", mime: "image/png", data: Buffer.from("not an image").toString("base64"),
    } });
    expect(rejected.isError).toBe(true);
  } finally {
    await close();
  }
});

it("tells Claude on the hosted server to use the upload card instead of a local path", async () => {
  process.env.STORAGE_DRIVER = "cloudflare";
  const { addLocalReference } = await import("../src/storage/local-references");
  await expect(addLocalReference({} as never, "inbox", "/tmp/a.png")).rejects.toThrow("upload_reference");
});

it("sends small PNG, JPEG and WebP files unchanged and re-encodes large or other photos", () => {
  expect(referenceUploadPlan({ type: "image/jpeg", size: 1_000_000 })).toBe("as-is");
  expect(referenceUploadPlan({ type: "image/png", size: 5_000_000 })).toBe("re-encode");
  expect(referenceUploadPlan({ type: "image/heic", size: 900_000 })).toBe("re-encode");
  expect(scaledSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
  expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  expect(renamed("IMG_0001.HEIC", "image/jpeg")).toBe("IMG_0001.jpg");
});

it("refuses a hosted GIF that would need resizing, naming the size the model renders, before anything is billed", async () => {
  const { ImageService } = await import("../src/core/service");
  const { MemoryStorage } = await import("../src/storage/memory");
  const store = new MemoryStorage();
  const api = new ImageService(store);
  const project = await api.createProject("GIF");
  await store.put("models", "openai", [{
    id: "gpt-image-2.6-sunburst", provider: "openai", name: "Sunburst", references: true, transparency: true,
    sizeProfile: { mode: "dimensions", minSide: 16, maxSide: 3840, multiple: 16, minPixels: 655360, maxPixels: 8294400, minRatio: 1 / 3, maxRatio: 3 },
    outputFormats: ["png", "gif"],
  }]);
  const gif = { projectId: project.id, prompt: "A cat hides under a blanket", source: "api" as const, provider: "openai" as const,
    model: "gpt-image-2.6-sunburst", transparent: false, outputFormat: "gif" as const, frameCount: 12, referenceIds: [] };
  process.env.STORAGE_DRIVER = "cloudflare";
  await expect(api.create({ ...gif, width: 448, height: 800, idempotencyKey: "small-gif" }))
    .rejects.toThrow("Request 608x1088, or pass only aspectRatio. Nothing was sent or billed.");
  await expect(api.create({ ...gif, width: 608, height: 1088, idempotencyKey: "native-gif" })).resolves.toMatchObject({ width: 608, height: 1088 });
  delete process.env.STORAGE_DRIVER;
  await expect(api.create({ ...gif, width: 448, height: 800, idempotencyKey: "local-gif" })).resolves.toMatchObject({ width: 448, height: 800 });
});

it("shows and downloads a generated file that was saved but blocked because its size could not be adapted", async () => {
  const { readImageFile, readThumbnail } = await import("../src/mcp/apps");
  const { storage } = await import("../src/storage");
  const store = await storage();
  const sharp = (await import("sharp")).default;
  const image = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer());
  await store.putBlob("results/blocked", image, "image/png");
  await store.put("jobs", "IMG-blocked", { id: "IMG-blocked", projectId: "inbox", prompt: "p", source: "api", status: "blocked",
    error: "The generated image was saved. It could not be fitted.", blobKey: "results/blocked", width: 256, height: 256, transparent: false, referenceIds: [] });
  await store.put("jobs", "IMG-waiting", { id: "IMG-waiting", projectId: "inbox", prompt: "p", source: "queue", status: "blocked",
    width: 256, height: 256, transparent: false, referenceIds: [] });
  expect((await readImageFile("IMG-blocked")).mime).toBe("image/png");
  expect((await readThumbnail("IMG-blocked")).bytes.length).toBeGreaterThan(0);
  await expect(readThumbnail("IMG-waiting")).rejects.toThrow("Image is unavailable");
});
