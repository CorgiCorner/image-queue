import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
const { response } = vi.hoisted(() => ({ response: vi.fn(() => new Response(new Uint8Array([1, 2, 3]))) }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      IMAGES: {
        input: () => ({
          transform: () => ({
            output: async () => ({
              response,
            }),
          }),
        }),
      },
    },
  }),
}));
import { thumbnail } from "../src/sources/thumbnail";
afterEach(() => {
  delete process.env.STORAGE_DRIVER;
});
it("uses the Cloudflare Images binding and returns WebP bytes", async () => {
  process.env.STORAGE_DRIVER = "cloudflare";
  expect(await thumbnail(new Uint8Array([1]), 320)).toEqual({
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/webp",
    animated: false,
  });
});

it("rasterizes an SVG and the first GIF frame to WebP", async () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#00ff00"/></svg>`);
  const preview = await thumbnail(svg, 10);
  expect(preview.mime).toBe("image/webp");
  expect(await sharp(preview.bytes).metadata()).toMatchObject({ format: "webp", width: 10 });
  const red = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 40, height: 20, channels: 3, background: "blue" } }).png().toBuffer();
  const gif = await sharp([red, blue], { join: { animated: true } }).gif().toBuffer();
  const frame = await thumbnail(gif, 10);
  const { dominant } = await sharp(frame.bytes).stats();
  expect(dominant.r).toBeGreaterThan(dominant.b);
});

it("rejects a failed Cloudflare transform before returning bytes as WebP", async () => {
  process.env.STORAGE_DRIVER = "cloudflare";
  response.mockReturnValueOnce(new Response("Unavailable", { status: 503 }));
  await expect(thumbnail(new Uint8Array([1]), 320)).rejects.toThrow("Thumbnail transformation failed (HTTP 503)");
});
