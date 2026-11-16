import { expect, it } from "vitest";
import sharp from "sharp";
import { annotatedImage } from "../src/sources/annotated-image";
it("composites a note marker into a PNG at the original dimensions", async () => {
  const original = await sharp({ create: { width: 200, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  const result = await annotatedImage(original, [{ id: "note", imageId: "image", text: "Change here", createdAt: "now", x: 0.5, y: 0.5 }]);
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.width).toBe(200);
  expect(metadata.height).toBe(100);
  expect(metadata.format).toBe("png");
  expect(Buffer.from(result.bytes).equals(original)).toBe(false);
  const { data } = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const markerPixel = (50 * 200 + 105) * 3;
  expect([...data.subarray(markerPixel, markerPixel + 3)]).not.toEqual([255, 255, 255]);
});
it("rejects malformed source bytes", async () => {
  await expect(annotatedImage(new Uint8Array([1, 2, 3]), [])).rejects.toThrow();
});
