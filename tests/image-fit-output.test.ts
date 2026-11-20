import { expect, it } from "vitest";
import sharp from "sharp";
import { imageSize } from "image-size";
import { fitImage } from "../src/sources/image-fit";
it("produces the exact requested dimensions from a centered crop", async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 4, background: "red" } }).png().toBuffer();
  const result = await fitImage(input, { width: 80, height: 80 });
  expect(imageSize(result.bytes)).toMatchObject({ width: 80, height: 80 });
  expect(result.mime).toBe("image/png");
});
it("refuses to upscale a generated file", async () => {
  const input = await sharp({ create: { width: 20, height: 20, channels: 4, background: "red" } }).png().toBuffer();
  await expect(fitImage(input, { width: 40, height: 40 })).rejects.toThrow("without upscaling");
});

it("preserves transparency when fitting a PNG", async () => {
  const input = await sharp({ create: {
    width: 120, height: 80, channels: 4,
    background: { r: 10, g: 20, b: 30, alpha: 0 },
  } }).png().toBuffer();
  const result = await fitImage(input, { width: 40, height: 40 });
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  expect(data[3]).toBe(0);
});

it("fits WebP and JPEG without converting them to PNG", async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } }).png().toBuffer();
  for (const format of ["webp", "jpeg"] as const) {
    const result = await fitImage(input, { width: 80, height: 40 }, format);
    expect(result.mime).toBe(format === "jpeg" ? "image/jpeg" : "image/webp");
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 80, height: 40, format });
  }
});

it("fits an animated GIF down without dropping frames or upscaling", async () => {
  const red = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 80, height: 40, channels: 3, background: "blue" } }).png().toBuffer();
  const gif = await sharp([red, blue], { join: { animated: true } }).gif().toBuffer();
  const result = await fitImage(gif, { width: 40, height: 20 }, "gif");
  expect(result.mime).toBe("image/gif");
  expect(await sharp(result.bytes, { animated: true }).metadata()).toMatchObject({ width: 40, pageHeight: 20, pages: 2 });
  await expect(fitImage(gif, { width: 160, height: 80 }, "gif")).rejects.toThrow("without upscaling");
});

it("crops the center rather than either edge", async () => {
  const center = await sharp({ create: { width: 100, height: 100, channels: 4, background: "blue" } }).png().toBuffer();
  const input = await sharp({ create: { width: 200, height: 100, channels: 4, background: "red" } })
    .composite([{ input: center, left: 50, top: 0 }]).png().toBuffer();
  const result = await fitImage(input, { width: 100, height: 100 });
  const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  expect([...data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
  expect([...data.slice(-4)]).toEqual([0, 0, 255, 255]);
});
