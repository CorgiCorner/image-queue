import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { applyVerifiedModelProfiles, verifiedModelProfiles, verifiedModelProfileSchema, type VerifiedModelProfile } from "../src/core/model-profiles";
import type { Model } from "../src/core/schema";

const model: Model = { id: "gpt-image-fixture", provider: "openai", name: "Fixture", references: true, transparency: false };
const profile: VerifiedModelProfile = {
  provider: "openai", model: model.id,
  references: true, transparency: false,
  sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
  documentation: "https://developers.openai.com/api/docs/guides/image-generation",
  verifiedAt: "2026-11-15T12:00:00Z",
  evidence: { generation: "fixture-generation", referenceEdit: "fixture-edit" },
};
it("adds verified profiles only to exact provider and model matches", () => {
  const unknown = { ...model, id: "gpt-image-other" };
  expect(applyVerifiedModelProfiles([model, unknown], [profile])).toEqual([{ ...model, sizeProfile: profile.sizeProfile }, unknown]);
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
    for (const [kind, link] of Object.entries(profile.evidence)) {
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
