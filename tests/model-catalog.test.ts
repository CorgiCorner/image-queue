import { expect, it } from "vitest";
import type { Model } from "../src/core/schema";
import { modelsWithSizeProfiles } from "../src/core/model-catalog";

it("exposes only models with structurally valid size profiles", () => {
  const base = { name: "Model", provider: "openai", references: true, transparency: true } as const;
  const entries = [
    { ...base, id: "missing" },
    { ...base, id: "empty", sizeProfile: { mode: "fixed", sizes: [] } },
    { ...base, id: "invalid", sizeProfile: { mode: "fixed", sizes: [{ width: -1, height: 1024 }] } },
    { ...base, id: "fixed", sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } },
    { ...base, id: "ratio", sizeProfile: { mode: "aspect-ratio", ratios: ["1:1"], levels: [] } },
  ] as Model[];
  expect(modelsWithSizeProfiles(entries).map(model => model.id)).toEqual(["fixed", "ratio"]);
  expect(entries).toHaveLength(5);
});

it("prefers the current verified model without mutating the discovered catalog", () => {
  const base = { name: "Model", provider: "openai", references: true, transparency: false,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } } as const;
  const entries = ["gpt-image-1.5", "gpt-image-2.6-flare"].map(id => ({ ...base, id })) as unknown as Model[];
  expect(modelsWithSizeProfiles(entries).map(model => model.id)).toEqual(["gpt-image-2.6-flare", "gpt-image-1.5"]);
  expect(entries[0].id).toBe("gpt-image-1.5");
});

it("puts a newer supported version before the older registry preference", () => {
  const base = { name: "Model", provider: "openai", references: true, transparency: false,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } } as const;
  const entries = ["gpt-image-2.6-flare", "gpt-image-2.10-flare"].map(id => ({ ...base, id })) as unknown as Model[];
  expect(modelsWithSizeProfiles(entries)[0].id).toBe("gpt-image-2.10-flare");
});
