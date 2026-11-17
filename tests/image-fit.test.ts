import { expect, it } from "vitest";
import { planImageFit } from "../src/core/image-fit";

it("centers portrait crops and preserves exact output dimensions", () => {
  expect(planImageFit({ width: 1024, height: 1536 }, { width: 864, height: 1536 })).toEqual({
    extract: { left: 80, top: 0, width: 864, height: 1536 },
    resize: { width: 864, height: 1536 },
  });
});
it("downscales from the largest centered matching crop", () => {
  expect(planImageFit({ width: 1536, height: 1024 }, { width: 800, height: 800 })).toEqual({
    extract: { left: 256, top: 0, width: 1024, height: 1024 },
    resize: { width: 800, height: 800 },
  });
});
it("rejects upscaling and invalid dimensions", () => {
  expect(() => planImageFit({ width: 1000, height: 1000 }, { width: 1080, height: 1920 })).toThrow("without upscaling");
  expect(() => planImageFit({ width: NaN, height: 1000 }, { width: 500, height: 500 })).toThrow("positive integers");
});

it("reports the actual and requested sizes for an undersized portrait", () => {
  expect(() => planImageFit({ width: 851, height: 1847 }, { width: 1024, height: 1536 }))
    .toThrow("received 851×1847; requested 1024×1536");
});
