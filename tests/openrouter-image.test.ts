import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { Job } from "../src/core/schema";
import { generate } from "../src/sources/providers";

afterEach(() => vi.unstubAllGlobals());

it("encodes the image reference and decodes the OpenRouter response through the installed SDK", async () => {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#4080a0" },
  }).png().toBuffer();
  const fetchImage = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({ data: [{ b64_json: png.toString("base64") }] }),
  );
  vi.stubGlobal("fetch", fetchImage);

  const result = await generate({
    provider: "openrouter",
    model: "fixture/image-model",
    prompt: "Keep the original composition",
    width: 1024,
    height: 1024,
    transparent: false,
  } as Job, "fixture-key", [new Uint8Array(png)]);

  expect(fetchImage).toHaveBeenCalledOnce();
  const [url, options] = fetchImage.mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/images");
  expect(new Headers(options.headers).get("authorization")).toBe("Bearer fixture-key");
  expect(JSON.parse(String(options.body))).toMatchObject({
    model: "fixture/image-model",
    prompt: "Keep the original composition",
    size: "1024x1024",
    input_references: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }],
  });
  expect(result).toMatchObject({ width: 32, height: 32, mime: "image/png" });
  expect(Buffer.from(result.bytes)).toEqual(png);
});

it("preserves the OpenRouter error without retrying an image request", async () => {
  const fetchImage = vi.fn(async () => Response.json({
    error: { message: "Provider temporarily unavailable", code: 503 },
  }, { status: 503 }));
  vi.stubGlobal("fetch", fetchImage);

  await expect(generate({
    provider: "openrouter",
    model: "fixture/image-model",
    prompt: "Draw a mountain",
    width: 1024,
    height: 1024,
    transparent: false,
  } as Job, "fixture-key", [])).rejects.toThrow("Provider temporarily unavailable");

  expect(fetchImage).toHaveBeenCalledOnce();
});
