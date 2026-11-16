import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const binding = vi.hoisted(() => ({ input: vi.fn(), draw: vi.fn(), output: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: { IMAGES: binding } }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each([false, true])("composes through the binding and checks dimensions, mismatch=%s", async mismatch => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  const output = await sharp({ create: { width: mismatch ? 50 : 100, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  binding.input.mockReturnValue(binding);
  binding.draw.mockReturnValue(binding);
  binding.output.mockResolvedValue({ response: () => new Response(output) });
  const { annotatedImage } = await import("../src/sources/annotated-image");
  const operation = annotatedImage(source, [{ id: "note", imageId: "image", text: "Fix", createdAt: "now", x: 0.5, y: 0.5 }]);
  if (mismatch) await expect(operation).rejects.toThrow("changed image dimensions");
  else expect((await operation).mime).toBe("image/png");
  expect(binding.draw).toHaveBeenCalledWith(expect.any(ReadableStream), { left: 0, top: 0 });
  expect(binding.output).toHaveBeenCalledWith({ format: "image/png" });
});

it("rejects a Cloudflare annotation failure even if the body is the original image", async () => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  binding.input.mockReturnValue(binding);
  binding.draw.mockReturnValue(binding);
  binding.output.mockResolvedValue({ response: () => new Response(source, { status: 503 }) });
  const { annotatedImage } = await import("../src/sources/annotated-image");
  await expect(annotatedImage(source, [
    { id: "note", imageId: "image", text: "Fix", createdAt: "now", x: 0.5, y: 0.5 },
  ])).rejects.toThrow("Image annotation failed (HTTP 503)");
});
