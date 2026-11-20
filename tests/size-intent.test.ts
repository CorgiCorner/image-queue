import {expect,it} from "vitest";
import {aspectRatios,resolveQueueSize} from "../src/core/size-intent";
it.each(aspectRatios)("resolves queue aspect ratio %s exactly",aspectRatio=>{
  const size=resolveQueueSize({aspectRatio});
  const [a,b]=aspectRatio.split(":").map(Number);
  expect(size.width*b).toBe(size.height*a);
});
it("preserves exact dimensions and rejects contradictory intent",()=>{
  expect(resolveQueueSize({width:1080,height:1920})).toEqual({width:1080,height:1920});
  expect(()=>resolveQueueSize({aspectRatio:"1:1",width:1080,height:1920})).toThrow("do not match");
  expect(()=>resolveQueueSize({width:1080})).toThrow();
  expect(()=>resolveQueueSize({})).toThrow();
});
it("resolves fixed profiles without upscaling", async()=>{
  const {resolveModelSize}=await import("../src/core/size-intent");
  const profile={mode:"fixed" as const,sizes:[{width:1024,height:1024},{width:1536,height:1024}]};
  expect(resolveModelSize(profile,{width:1200,height:800})).toEqual({target:{width:1200,height:800},parameters:{size:"1536x1024"},requiresResize:true});
  expect(()=>resolveModelSize(profile,{width:1920,height:1080})).toThrow("without upscaling");
});
it("validates model dimension and resolution constraints",async()=>{
  const {resolveModelSize}=await import("../src/core/size-intent");
  expect(resolveModelSize({mode:"aspect-ratio",ratios:["9:16"],levels:["1k"]},{aspectRatio:"9:16",resolution:"1k"}).parameters).toEqual({aspectRatio:"9:16",resolution:"1k"});
  expect(()=>resolveModelSize({mode:"aspect-ratio",ratios:["1:1"],levels:[]},{aspectRatio:"9:16"})).toThrow();
  const profile={mode:"dimensions" as const,minSide:256,maxSide:4096,multiple:16,minPixels:65536,maxPixels:9000000,minRatio:1/3,maxRatio:3};
  expect(resolveModelSize(profile,{width:1024,height:1024}).requiresResize).toBe(false);
  expect(resolveModelSize(profile,{width:1025,height:1024})).toEqual({target:{width:1025,height:1024},parameters:{size:"1040x1024"},requiresResize:true});
});

it("uses the model native size for ratio-only requests", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  const profile = { mode: "fixed" as const, sizes: [
    { width: 1024, height: 1024 },
    { width: 1024, height: 1536 },
  ] };
  expect(resolveModelSize(profile, { aspectRatio: "2:3" })).toEqual({
    target: { width: 1024, height: 1536 },
    parameters: { size: "1024x1536" },
    requiresResize: false,
  });
  expect(resolveModelSize(profile, { aspectRatio: "9:16" })).toEqual({
    target: { width: 864, height: 1536 },
    parameters: { size: "1024x1536" },
    requiresResize: true,
  });
});

it("rejects unsupported resolution options instead of silently ignoring them", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  expect(() => resolveModelSize({ mode: "fixed", sizes: [{ width: 1024, height: 1024 }] }, {
    aspectRatio: "1:1", resolution: "2k",
  })).toThrow("does not support resolution levels");
  expect(() => resolveModelSize({ mode: "aspect-ratio", ratios: ["1:1"], levels: ["1k"] }, {
    aspectRatio: "1:1", resolution: "",
  })).toThrow("Unsupported resolution level");
});

it("rejects malformed model profiles", async () => {
  const { sizeProfileSchema } = await import("../src/core/size-intent");
  for (const profile of [
    { mode: "fixed", sizes: [] },
    { mode: "fixed", sizes: [{ width: 0, height: 1024 }] },
    { mode: "aspect-ratio", ratios: ["0:1"], levels: [] },
    { mode: "aspect-ratio", ratios: ["1:1"], levels: [""] },
    { mode: "dimensions", minSide: 1024, maxSide: 256, multiple: 16, minPixels: 1, maxPixels: 1000000, minRatio: 1, maxRatio: 2 },
  ]) expect(sizeProfileSchema.safeParse(profile).success).toBe(false);
});

it("checks every dimension boundary with an actionable error", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  const profile = {
    mode: "dimensions" as const, minSide: 256, maxSide: 2048, multiple: 16,
    minPixels: 262144, maxPixels: 2097152, minRatio: 0.5, maxRatio: 2,
  };
  expect(resolveModelSize(profile, { width: 512, height: 512 }).requiresResize).toBe(false);
  expect(resolveModelSize(profile, { width: 2048, height: 1024 }).requiresResize).toBe(false);
  expect(() => resolveModelSize(profile, { width: 2064, height: 1024 })).toThrow("between 256 and 2048 pixels");
  expect(resolveModelSize(profile, { width: 1025, height: 1024 }).parameters).toEqual({ size: "1040x1024" });
  expect(resolveModelSize(profile, { width: 256, height: 256 })).toEqual({ target: { width: 256, height: 256 }, parameters: { size: "512x512" }, requiresResize: true });
  expect(() => resolveModelSize(profile, { width: 1536, height: 1536 })).toThrow("total pixels");
  expect(() => resolveModelSize(profile, { width: 1536, height: 512 })).toThrow("width/height between 0.5 and 2");
});

it("resolves exact dimensions using ratios declared by the model", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  expect(resolveModelSize({ mode: "aspect-ratio", ratios: ["5:4"], levels: [] }, {
    width: 1280, height: 1024,
  }).parameters).toEqual({ aspectRatio: "5:4" });
  expect(resolveModelSize({ mode: "aspect-ratio", ratios: ["21:9"], levels: [] }, {
    width: 2520, height: 1080,
  }).parameters).toEqual({ aspectRatio: "21:9" });
});

it("accepts matching explicit dimensions and selects the smaller equal-ratio native size", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  expect(resolveQueueSize({ aspectRatio: "9:16", width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
  const result = resolveModelSize({
    mode: "fixed", sizes: [{ width: 2048, height: 2048 }, { width: 1024, height: 1024 }],
  }, { width: 512, height: 512 });
  expect(result.parameters).toEqual({ size: "1024x1024" });
});


it("rejects a native size too small to produce the requested aspect ratio", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  expect(() => resolveModelSize({ mode: "fixed", sizes: [{ width: 1, height: 1 }] },
    { aspectRatio: "21:9" })).toThrow("No native size can represent");
});

it("resolves gpt-image-2.6-flare sizes on its 16-pixel grid", async () => {
  const { resolveModelSize } = await import("../src/core/size-intent");
  const { verifiedModelProfiles } = await import("../src/core/model-profiles");
  const flare = verifiedModelProfiles.find(entry => entry.model === "gpt-image-2.6-flare")!.sizeProfile;
  expect(resolveModelSize(flare, { aspectRatio: "16:9" })).toEqual({ target: { width: 2048, height: 1152 }, parameters: { size: "2048x1152" }, requiresResize: false });
  expect(resolveModelSize(flare, { aspectRatio: "9:16" }).parameters).toEqual({ size: "1152x2048" });
  expect(resolveModelSize(flare, { aspectRatio: "21:9" }).parameters).toEqual({ size: "2688x1152" });
  expect(resolveModelSize(flare, { width: 1536, height: 864 })).toMatchObject({ parameters: { size: "1536x864" }, requiresResize: false });
  expect(resolveModelSize(flare, { width: 3840, height: 2160 })).toMatchObject({ parameters: { size: "3840x2160" }, requiresResize: false });
  // Small sprites are generated at the smallest allowed size and fitted down, never upscaled.
  const sprite = resolveModelSize(flare, { width: 256, height: 256 });
  expect(sprite).toEqual({ target: { width: 256, height: 256 }, parameters: { size: "816x816" }, requiresResize: true });
  expect(816 * 816).toBeGreaterThanOrEqual(655360);
  expect(resolveModelSize(flare, { width: 1920, height: 1080 })).toEqual({ target: { width: 1920, height: 1080 }, parameters: { size: "1920x1088" }, requiresResize: true });
  expect(() => resolveModelSize(flare, { width: 4096, height: 2304 })).toThrow("between 16 and 3840 pixels");
  expect(() => resolveModelSize(flare, { width: 3200, height: 1024 })).toThrow("width/height between 1/3 and 3");
  expect(() => resolveModelSize(flare, { width: 3840, height: 3840 })).toThrow("total pixels");
});
