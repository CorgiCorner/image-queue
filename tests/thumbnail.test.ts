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
  });
});

it("rejects a failed Cloudflare transform before returning bytes as WebP", async () => {
  process.env.STORAGE_DRIVER = "cloudflare";
  response.mockReturnValueOnce(new Response("Unavailable", { status: 503 }));
  await expect(thumbnail(new Uint8Array([1]), 320)).rejects.toThrow("Thumbnail transformation failed (HTTP 503)");
});
