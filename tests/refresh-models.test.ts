import { afterEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { refreshModelCatalog } from "../src/core/model-refresh";
import type { Model } from "../src/core/schema";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", () => { throw new Error("Real network access is disabled in tests. Mock the provider transport."); });
});

it("saves every discovered image model and returns the ones with a verified profile, newest first", async () => {
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "server-key-fixture");
  const fetchModels = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-key-fixture");
    return Response.json({ data: [
      { id: "gpt-image-1.5" }, { id: "gpt-image-2.6-flare" }, { id: "gpt-image-2.5-sunburst" },
      { id: "gpt-image-9-preview" }, { id: "gpt-6.1-sol" },
    ] });
  });
  vi.stubGlobal("fetch", fetchModels);
  const store = new MemoryStorage();
  await store.put("models", "openai", [{ id: "gpt-image-1.5", name: "old", provider: "openai" }]);

  const usable = await refreshModelCatalog(store, "openai");

  expect(fetchModels).toHaveBeenCalledOnce();
  expect(String(fetchModels.mock.calls[0]![0])).toBe("https://api.openai.com/v1/models");
  expect(usable.map(model => model.id)).toEqual(["gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-1.5"]);
  const saved = await store.get<Model[]>("models", "openai");
  expect(saved?.map(model => model.id).sort()).toEqual(["gpt-image-1.5", "gpt-image-2.5-sunburst", "gpt-image-2.6-flare", "gpt-image-9-preview"]);
  expect(JSON.stringify([usable, saved])).not.toContain("server-key-fixture");
});

it("keeps the saved catalog when the key cannot list any image model", async () => {
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "server-key-fixture");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "gpt-6.1-sol" }] })));
  const store = new MemoryStorage();
  const before = [{ id: "gpt-image-1.5", name: "GPT Image 1.5", provider: "openai" }];
  await store.put("models", "openai", before);
  await expect(refreshModelCatalog(store, "openai")).rejects.toThrow("no supported image models");
  expect(await store.get("models", "openai")).toEqual(before);
});
