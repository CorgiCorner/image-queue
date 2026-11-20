import sharp from "sharp";
import { expect, it } from "vitest";
import { isAnimatedWebp, thumbnail } from "../src/sources/thumbnail";

async function gif(frames: number, side = 96) {
  const colours = ["#c0392b", "#27ae60", "#2980b9", "#f1c40f"];
  const pages = await Promise.all(Array.from({ length: frames }, (_, index) =>
    sharp({ create: { width: side, height: side, channels: 3, background: colours[index % colours.length] } }).png().toBuffer()));
  return new Uint8Array(await sharp(pages, { join: { animated: true } }).gif({ delay: 120 }).toBuffer());
}

it("keeps every frame of a GIF in an animated preview and resizes them", async () => {
  const preview = await thumbnail(await gif(4), 48, { animated: true });
  expect(preview.mime).toBe("image/webp");
  expect(preview.animated).toBe(true);
  const meta = await sharp(preview.bytes, { animated: true }).metadata();
  expect(meta.pages).toBe(4);
  expect(meta.width).toBe(48);
  expect(meta.pageHeight).toBe(48);
});

it("still returns the first frame only when animation is not asked for", async () => {
  const preview = await thumbnail(await gif(4), 48);
  expect(preview.animated).toBe(false);
  expect((await sharp(preview.bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);
});

it("reports a still source as not animated even when animation is asked for", async () => {
  const still = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#333" } }).png().toBuffer());
  expect((await thumbnail(still, 48, { animated: true })).animated).toBe(false);
  expect(isAnimatedWebp(new Uint8Array([1, 2, 3]))).toBe(false);
});

it("serves the animated preview of a GIF job through the app-only tool, and a still for other images", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const root = await mkdtemp(path.join(os.tmpdir(), "animated-preview-"));
  process.env.STORAGE_DIR = path.join(root, "store");
  process.env.CODEX_QUEUE_DIR = path.join(root, "queue");
  try {
    const { createServer } = await import("../src/mcp/server");
    const { service } = await import("../src/core/runtime");
    const api = await service();
    const project = await api.createProject("Animated preview");
    await api.store.putBlob("results/corgi-gif", await gif(3), "image/gif");
    await api.store.put("jobs", "IMG-corgi-gif", {
      id: "IMG-corgi-gif", projectId: project.id, source: "api", status: "done", blobKey: "results/corgi-gif", outputFormat: "gif",
      prompt: "A corgi typing", width: 96, height: 96, referenceIds: [], createdAt: "2026-11-20T01:00:00.000Z", updatedAt: "2026-11-20T01:00:00.000Z",
    });
    const server = createServer({ appViews: "always" });
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const read = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "read_thumbnail", arguments: args }) as { content: { type: string; text?: string; data?: string }[] };
      const bytes = new Uint8Array(Buffer.from(result.content.find(item => item.type === "image")!.data!, "base64"));
      return { note: JSON.parse(result.content.find(item => item.type === "text")!.text!), pages: (await sharp(bytes, { animated: true }).metadata()).pages ?? 1 };
    };
    expect(await read({ id: "IMG-corgi-gif", animated: true })).toEqual({ note: { animated: true }, pages: 3 });
    expect(await read({ id: "IMG-corgi-gif" })).toEqual({ note: { animated: false }, pages: 1 });
    await client.close();
    await server.close();
  } finally {
    await rm(root, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
    delete process.env.CODEX_QUEUE_DIR;
  }
});
