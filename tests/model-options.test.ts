import { expect, it } from "vitest";
import { sizeLabel, ratioFirstLabel, queueSizes, closestAspectSize, modelSizes } from "../src/core/model-options";
it("shows reduced image proportions", () => {
  expect(sizeLabel("1024x1024")).toBe("1024 × 1024 · 1:1");
  expect(sizeLabel("1536x864")).toBe("1536 × 864 · 16:9");
});
it("handles malformed stored dimensions without recursion", () => {
  for (const value of [
    "",
    "auto",
    "0x0",
    "-1x20",
    "1x",
    "99999999999999999999x1",
  ])
    expect(sizeLabel(value)).toBe(value);
});

it("shows ratio before exact dimensions and includes standard queue formats", () => {
  expect(ratioFirstLabel("1080x1920")).toBe("9:16 · 1080 × 1920");
  expect(ratioFirstLabel("1920x1080")).toBe("16:9 · 1920 × 1080");
  expect(ratioFirstLabel("custom")).toBe("custom");
  expect(queueSizes).toContain("1080x1920");
  expect(queueSizes).not.toContain("1792x1024");
});

it("preserves the nearest aspect ratio when the model changes", () => {
  expect(closestAspectSize("1080x1920",["1024x1024","1536x1024","1024x1536"])).toBe("1024x1536");
  expect(closestAspectSize("1920x1080",["1024x1024","1536x1024","1024x1536"])).toBe("1536x1024");
});

it("uses a model fixed profile instead of provider defaults", () => {
  expect(modelSizes("openai", "custom", { mode: "fixed", sizes: [
    { width: 1664, height: 928 }, { width: 928, height: 1664 },
  ] })).toEqual(["1664x928", "928x1664"]);
});

it("rejects invalid stored fixed profiles before exposing options", () => {
  expect(() => modelSizes("openai", "custom", {
    mode: "fixed", sizes: [{ width: 0, height: 1024 }],
  })).toThrow();
  expect(() => modelSizes("openai", "custom", {
    mode: "fixed", sizes: [],
  })).toThrow();
});

it("filters dimension and ratio profiles by their declared constraints", () => {
  expect(modelSizes("openai", "custom", {
    mode: "dimensions", minSide: 256, maxSide: 1536, multiple: 16,
    minPixels: 65536, maxPixels: 2000000, minRatio: 0.5, maxRatio: 2,
  })).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
  expect(modelSizes("google", "custom", {
    mode: "aspect-ratio", ratios: ["1:1", "9:16"], levels: [],
  })).toEqual(["1024x1024", "1080x1920"]);
});

it("preserves the standard ultrawide ratio label", () => {
  expect(ratioFirstLabel("2520x1080")).toBe("21:9 · 2520 × 1080");
});

it("does not invent standard presets for a custom-only ratio profile", () => {
  expect(modelSizes("google", "custom", {
    mode: "aspect-ratio", ratios: ["5:4"], levels: [],
  })).toEqual([]);
});
