import { expect, it, vi } from "vitest";
import { loadThumbnail } from "../src/mcp/views/thumbnail";

const resource = { contents: [{ uri: "image-queue://thumbnail/one", mimeType: "image/webp", blob: "cmVzb3VyY2U=" }] };
function host(tool: () => Promise<unknown>, read: () => Promise<unknown> = async () => resource) {
  return { callServerTool: vi.fn(tool), readServerResource: vi.fn(read) } as any;
}

it("loads the preview through the app-only tool without reading the resource", async () => {
  const app = host(async () => ({ content: [{ type: "image", mimeType: "image/webp", data: "dG9vbA==" }] }));
  await expect(loadThumbnail(app, "one", () => false)).resolves.toBe("data:image/webp;base64,dG9vbA==");
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "one" } });
  expect(app.readServerResource).not.toHaveBeenCalled();
});

it.each([
  ["a rejected call", async () => { throw new Error("Unknown tool"); }],
  ["an error result", async () => ({ isError: true, content: [{ type: "image", mimeType: "image/webp", data: "dG9vbA==" }] })],
  ["a result without an image", async () => ({ content: [{ type: "text", text: "{}" }] })],
  ["an image of another type", async () => ({ content: [{ type: "image", mimeType: "text/html", data: "dG9vbA==" }] })],
  ["no result", async () => undefined],
])("falls back to the private resource after %s", async (_, tool) => {
  const app = host(tool);
  await expect(loadThumbnail(app, "a b", () => false)).resolves.toBe("data:image/webp;base64,cmVzb3VyY2U=");
  expect(app.readServerResource).toHaveBeenCalledWith({ uri: "image-queue://thumbnail/a%20b" });
});

it.each([
  ["rejects", async () => { throw new Error("Resource unavailable"); }],
  ["is empty", async () => ({ contents: [] })],
  ["is not an image", async () => ({ contents: [{ uri: "ui://image-queue/job", mimeType: "text/html", blob: "PGI+" }] })],
])("reports an unavailable preview when the tool fails and the resource %s", async (_, read) => {
  const app = host(async () => ({ isError: true, content: [{ type: "text", text: "Image is unavailable" }] }), read);
  await expect(loadThumbnail(app, "one", () => false)).rejects.toThrow();
  expect(app.callServerTool).toHaveBeenCalledTimes(1);
  expect(app.readServerResource).toHaveBeenCalledTimes(1);
});

it("skips the fallback once the preview is no longer wanted", async () => {
  const app = host(async () => { throw new Error("Unknown tool"); });
  await expect(loadThumbnail(app, "one", () => true)).rejects.toThrow();
  expect(app.readServerResource).not.toHaveBeenCalled();
});

it("asks for the frames of a GIF and reports whether the preview kept them", async () => {
  const { loadPreview } = await import("../src/mcp/views/thumbnail");
  const app = host(async () => ({ content: [{ type: "image", mimeType: "image/webp", data: "dG9vbA==" }, { type: "text", text: '{"animated":true}' }] }));
  await expect(loadPreview(app, "one", () => false, { animated: true })).resolves.toEqual({ url: "data:image/webp;base64,dG9vbA==", animated: true });
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "one", animated: true } });
  // An older server sends the image alone: treated as a still.
  const old = host(async () => ({ content: [{ type: "image", mimeType: "image/webp", data: "dG9vbA==" }] }));
  await expect(loadPreview(old, "one", () => false, { animated: true })).resolves.toEqual({ url: "data:image/webp;base64,dG9vbA==", animated: false });
});
