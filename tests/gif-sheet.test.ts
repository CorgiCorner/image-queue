import { expect, it } from "vitest";
import { assertGifSheetFits, gifSheetFits } from "../src/core/gif-sheet";
import type { SizeProfile } from "../src/core/size-intent";

const gptImage26: SizeProfile = {
  mode: "dimensions", minSide: 16, maxSide: 3840, multiple: 16,
  minPixels: 655360, maxPixels: 8294400, minRatio: 1 / 3, maxRatio: 3,
};
const square = (side: number) => ({ width: side, height: side });

it("rejects every 1024x1024 GIF OpenAI refused: 4, 6 and 8 frames need 4096x2048, 9 need 3072x3072", () => {
  for (const count of [2, 4, 6, 8, 9]) expect(gifSheetFits(gptImage26, square(1024), count), String(count)).toBe(false);
  expect(gifSheetFits(gptImage26, { width: 1536, height: 1024 }, 9)).toBe(false);
  expect(() => assertGifSheetFits(gptImage26, square(1024), 4))
    .toThrow("use 960x960 or smaller for 4 frames. Nothing was sent or billed.");
});

it("matches the published square caps: 960 up to 9 frames, 816 up to 12, 720 up to 16", () => {
  for (const [count, cap] of [[2, 960], [8, 960], [9, 960], [10, 816], [12, 816], [13, 720], [16, 720]] as const) {
    expect(gifSheetFits(gptImage26, square(cap), count), `${count} at ${cap}`).toBe(true);
    expect(gifSheetFits(gptImage26, square(cap + 16), count), `${count} at ${cap + 16}`).toBe(false);
  }
});

it("checks the default of 9 frames when the request names no count", () => {
  expect(() => assertGifSheetFits(gptImage26, square(1024), undefined)).toThrow("use 960x960 or smaller for 9 frames");
  expect(() => assertGifSheetFits(gptImage26, square(960), undefined)).not.toThrow();
});

it("offers fewer frames when no model size can hold the count", () => {
  // 13 to 16 frames need 720x720, below the smallest size this application sends (816x816).
  expect(() => assertGifSheetFits(gptImage26, square(816), 16)).toThrow(": use at most 12 frames at this size. Nothing was sent or billed.");
});

it("leaves fixed-size models alone", () => {
  expect(gifSheetFits({ mode: "fixed", sizes: [square(1024)] } as SizeProfile, square(1024), 16)).toBe(true);
});
