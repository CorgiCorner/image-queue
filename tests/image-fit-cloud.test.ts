import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ transform: vi.fn(), output: vi.fn(), bytes: new Uint8Array() }));
vi.mock("../src/core/config", () => ({ configuration: () => "cloudflare" }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: { IMAGES: {
  input: () => ({ transform: mocks.transform }),
} } }) }));
import { fitImage } from "../src/sources/image-fit";
beforeEach(() => {
  mocks.transform.mockReturnValue({ output: mocks.output });
  mocks.output.mockImplementation(async () => ({ response: () => new Response(mocks.bytes as BodyInit) }));
});
it("requests a centered crop and validates returned dimensions", async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 4, background: "red" } }).png().toBuffer();
  mocks.bytes = new Uint8Array(await sharp(input).resize(80, 80).png().toBuffer());
  await fitImage(input, { width: 80, height: 80 });
  expect(mocks.transform).toHaveBeenCalledWith({ width: 80, height: 80, fit: "cover", gravity: "center" });
  mocks.bytes = new Uint8Array(input);
  await expect(fitImage(input, { width: 80, height: 80 })).rejects.toThrow("unexpected dimensions");
});

it("refuses to fit a GIF on Cloudflare so the animation is not flattened", async () => {
  const frame = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const gif = await sharp([frame, frame], { join: { animated: true } }).gif().toBuffer();
  mocks.transform.mockClear();
  await expect(fitImage(gif, { width: 40, height: 20 }, "gif")).rejects.toThrow("keeping the animation");
  expect(mocks.transform).not.toHaveBeenCalled();
});

it("rejects a failed Cloudflare transform even when the response contains matching image bytes", async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 4, background: "red" } }).png().toBuffer();
  const fitted = new Uint8Array(await sharp(input).resize(80, 80).png().toBuffer());
  mocks.output.mockResolvedValueOnce({ response: () => new Response(fitted, { status: 503 }) });
  await expect(fitImage(input, { width: 80, height: 80 })).rejects.toThrow("Image transformation failed (HTTP 503)");
});
