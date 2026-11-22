import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { applyVerifiedModelProfiles, verifiedModelProfiles, verifiedModelProfileSchema, type VerifiedModelProfile } from "../src/core/model-profiles";
import type { Model } from "../src/core/schema";

const model: Model = { id: "gpt-image-fixture", provider: "openai", name: "Fixture", references: true, transparency: false };
const profile: VerifiedModelProfile = {
  provider: "openai", model: model.id,
  references: true, transparency: false,
  sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
  qualities: ["low", "high"], complexities: [], outputFormats: ["png"], documentedOnly: [],
  documentation: "https://developers.openai.com/api/docs/guides/image-generation",
  verifiedAt: "2026-11-15T12:00:00Z",
  evidence: { generation: "fixture-generation", referenceEdit: "fixture-edit" },
};
it("adds verified profiles only to exact provider and model matches", () => {
  const unknown = { ...model, id: "gpt-image-other" };
  expect(applyVerifiedModelProfiles([model, unknown], [profile])).toEqual([{ ...model, sizeProfile: profile.sizeProfile, qualities: ["low", "high"], complexities: [], outputFormats: ["png"], documentedOnly: [], generationVerified: true }, unknown]);
  expect(model.sizeProfile).toBeUndefined();
  expect(applyVerifiedModelProfiles([model], [])).toEqual([model]);
});
it("requires dated generation and reference-edit evidence", () => {
  expect(verifiedModelProfileSchema.safeParse({ ...profile, evidence: { generation: "fixture" } }).success).toBe(false);
  expect(verifiedModelProfileSchema.safeParse({ ...profile, verifiedAt: "yesterday" }).success).toBe(false);
  expect(verifiedModelProfileSchema.safeParse({ ...profile, model: "gpt-chat" }).success).toBe(false);
});


it("keeps published profile evidence present with section anchors and image hashes", async () => {
  const ids = new Set<string>();
  for (const profile of verifiedModelProfiles) {
    expect(verifiedModelProfileSchema.safeParse(profile).success).toBe(true);
    expect(ids.has(profile.model)).toBe(false);
    ids.add(profile.model);
    for (const [kind, link] of Object.entries(profile.evidence ?? {})) {
      const [file, anchor] = link.split("#");
      expect(file).toMatch(/^docs\/verification\/[a-z0-9.-]+\.md$/);
      const text = await readFile(file, "utf8");
      expect(text.toLowerCase()).toContain(`## ${anchor.replaceAll("-", " ")}`);
      expect(text).toMatch(/[a-f0-9]{64}/);
      expect(kind === "generation" || kind === "referenceEdit").toBe(true);
    }
  }
});

it("does not inherit unverified capabilities from discovery", () => {
  const discovered = { ...model, transparency: true, references: false };
  expect(applyVerifiedModelProfiles([discovered], [profile])[0]).toMatchObject({ references: true, transparency: false });
});

it("removes cached size profiles without an exact verified registry entry", () => {
  const cached = { ...model, sizeProfile: profile.sizeProfile };
  const otherProvider = { ...cached, provider: "openrouter" as const };
  expect(applyVerifiedModelProfiles([cached], [])).toEqual([model]);
  expect(applyVerifiedModelProfiles([otherProvider], [profile])[0].sizeProfile).toBeUndefined();
  expect(cached.sizeProfile).toEqual(profile.sizeProfile);
});

it("publishes the documented gpt-image-2.6-flare and gpt-image-1.5 capabilities", () => {
  const flare = verifiedModelProfiles.find(entry => entry.model === "gpt-image-2.6-flare")!;
  expect(flare).toMatchObject({ transparency: true, references: true, qualities: expect.arrayContaining(["xhigh", "max"]) });
  expect(flare.sizeProfile).toEqual({ mode: "dimensions", minSide: 16, maxSide: 3840, multiple: 16, minPixels: 655360, maxPixels: 8294400, minRatio: 1 / 3, maxRatio: 3 });
  expect(flare.documentedOnly).toEqual(expect.arrayContaining(["transparent background"]));
  const legacy = verifiedModelProfiles.find(entry => entry.model === "gpt-image-1.5")!;
  expect(legacy.sizeProfile).toEqual({ mode: "fixed", sizes: [{ width: 1024, height: 1024 }, { width: 1024, height: 1536 }, { width: 1536, height: 1024 }] });
  expect(legacy.qualities).not.toContain("xhigh");
});

it("refuses options a model cannot honour", async () => {
  const { assertModelOptions } = await import("../src/core/model-profiles");
  const [withProfile] = applyVerifiedModelProfiles([model], [profile]);
  expect(() => assertModelOptions(withProfile, { quality: "high" })).not.toThrow();
  expect(() => assertModelOptions(withProfile, { quality: "max" })).toThrow('does not support quality "max". Supported: low, high.');
  expect(() => assertModelOptions(withProfile, { transparent: true })).toThrow("does not support transparency");
  expect(() => assertModelOptions({ ...withProfile, references: false }, { referenceIds: ["ref-1"] })).toThrow("image references");
  expect(() => assertModelOptions(model, { quality: "low" })).toThrow("Supported: none.");
});

it("requires documentation-only entries to name generation and reference edit as unverified", () => {
  expect(verifiedModelProfileSchema.safeParse({ ...profile, evidence: null }).success).toBe(false);
  expect(verifiedModelProfileSchema.safeParse({ ...profile, evidence: null, documentedOnly: ["generation", "reference edit"] }).success).toBe(true);
  for (const entry of verifiedModelProfiles.filter(item => item.evidence === null))
    expect(entry.documentedOnly).toEqual(expect.arrayContaining(["generation", "reference edit"]));
});

it("keeps complexity, SVG and GIF to GPT Image 2.6 and xhigh/max to 2.5 and 2.6", () => {
  for (const entry of verifiedModelProfiles) {
    const is26 = entry.model.startsWith("gpt-image-2.6-");
    const isNew = is26 || entry.model.startsWith("gpt-image-2.5-");
    expect(entry.complexities.length > 0).toBe(is26);
    expect(entry.outputFormats.includes("svg")).toBe(is26);
    expect(entry.qualities.includes("max")).toBe(isNew);
  }
  expect(verifiedModelProfiles[0].model).toBe("gpt-image-2.6-sunburst");
});

it("refuses an output format, transparency pairing, SVG combination or frame setting the model cannot honour", async () => {
  const { assertModelOptions } = await import("../src/core/model-profiles");
  const [raster] = applyVerifiedModelProfiles([model], [profile]);
  const [vector] = applyVerifiedModelProfiles(
    [{ ...model, transparency: true }],
    [{ ...profile, transparency: true, outputFormats: ["png", "webp", "jpeg", "gif", "svg"] }],
  );
  expect(() => assertModelOptions(vector, { outputFormat: "webp" })).not.toThrow();
  expect(() => assertModelOptions(vector, { outputFormat: "svg" })).not.toThrow();
  expect(() => assertModelOptions(raster, { outputFormat: "gif" })).toThrow('does not support output format "gif". Supported: png.');
  expect(() => assertModelOptions(vector, { transparent: true, outputFormat: "jpeg" })).toThrow("Transparent background requires PNG or WebP");
  expect(() => assertModelOptions(vector, { transparent: true, outputFormat: "webp" })).not.toThrow();
  expect(() => assertModelOptions(vector, { transparent: true })).not.toThrow();
  expect(() => assertModelOptions(vector, { outputFormat: "svg", referenceIds: ["ref-1"] })).toThrow("cannot be combined with reference images");
  expect(() => assertModelOptions(vector, { outputFormat: "gif", referenceIds: ["ref-1"] })).not.toThrow();
  expect(() => assertModelOptions(vector, { outputFormat: "gif", frameCount: 4 })).not.toThrow();
  expect(() => assertModelOptions(vector, { outputFormat: "svg", frameCount: 4 })).toThrow("only to GIF");
  expect(() => assertModelOptions(vector, { outputFormat: "png", frameDurationMs: 200 })).toThrow("only to GIF");
  expect(() => assertModelOptions(vector, { frameCount: 2 })).toThrow("only to GIF");
  expect(() => assertModelOptions(vector, { outputFormat: "gif", frameCount: 8, frameDurationMs: 200 })).not.toThrow();
});

it("refuses complexity a model does not offer", async () => {
  const { assertModelOptions } = await import("../src/core/model-profiles");
  const [withProfile] = applyVerifiedModelProfiles([model], [{ ...profile, complexities: ["low"] }]);
  expect(() => assertModelOptions(withProfile, { complexity: "low" })).not.toThrow();
  expect(() => assertModelOptions(withProfile, { complexity: "high" })).toThrow('does not support complexity "high". Supported: low.');
});
