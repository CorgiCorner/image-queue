import { expect, it } from "vitest";
import { readCustomSizes, rememberCustomSize } from "../src/core/custom-sizes";
it("restores valid custom dimensions and their last selection", () => {
  expect(readCustomSizes('{"sizes":["1080x1920","1080x1920"],"selected":"1080x1920"}')).toEqual({sizes:["1080x1920"],selected:"1080x1920"});
});
it.each([null, "bad", '{"sizes":["1x999999"]}', '{"sizes":["NaNx512"]}'])("ignores malformed saved sizes %s", raw => {
  expect(readCustomSizes(raw)).toEqual({sizes:[]});
});
it("deduplicates and bounds saved formats", () => {
  expect(rememberCustomSize(["1080x1920"],"1080x1920")).toEqual(["1080x1920"]);
  expect(rememberCustomSize(Array.from({length:50},(_,i)=>`${300+i}x512`),"512x512")).toHaveLength(50);
  expect(()=>rememberCustomSize([],"20x20")).toThrow();
});
