import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("image-size", () => ({
  imageSize: () => ({ width: 1024, height: 1024 }),
}));
vi.mock("../src/sources/image-fit", () => ({ fitImage: vi.fn(async (bytes) => ({ bytes, mime: "image/png" })) }));
vi.mock("ai", () => ({ generateImage: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({
    image: (id: string) => ({
      id,
      supportsFileInputs: id.includes("gpt-image"),
    }),
  }),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => ({
    image: (id: string) => ({ id, supportsFileInputs: false }),
  }),
}));
vi.mock("@ai-sdk/gateway", () => ({
  createGateway: () => ({
    image: (id: string) => ({ id, supportsFileInputs: true }),
  }),
}));

import { generateImage } from "ai";
import type { Job } from "../src/core/schema";
import {
  discoverModels,
  generate,
  providerModel,
} from "../src/sources/providers";

afterEach(() => vi.unstubAllGlobals());
describe("providers", () => {
  it("constructs supported providers", () => {
    for (const provider of ["openai", "google", "gateway"] as const)
      expect(providerModel(provider, "key", "model")).toHaveProperty(
        "id",
        "model",
      );
  });
  it("discovers image models only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "text", type: "image" }, { id: "gemini-test-image" }, { id: "chat-gpt-image-fake" }, { id: "gpt-image-2.6-flare" }],
        }),
      }),
    );
    expect(await discoverModels("openai", "key")).toEqual([
      {
        id: "gpt-image-2.6-flare",
        name: "gpt-image-2.6-flare",
        provider: "openai",
        references: true,
        transparency: true,
      },
    ]);
  });
  it("discovers Google names and gateway types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            {
              name: "models/gemini-3.1-flash-image-preview",
              displayName: "Imagen",
            },
          ],
        }),
      }),
    );
    expect((await discoverModels("google", "key"))[0].id).toBe(
      "gemini-3.1-flash-image-preview",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "custom", type: "image" }] }),
      }),
    );
    expect((await discoverModels("gateway", "key"))[0].references).toBe(true);
  });
  it("rejects invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(discoverModels("openai", "key")).rejects.toThrow("401");
  });
  it("generates with and without references with retries disabled", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" },
      usage: {},
    } as never);
    const j = {
      provider: "openai",
      model: "gpt-image-2.6-flare",
      prompt: "Panda",
      width: 1024,
      height: 1024,
      transparent: true,
    } as Job;
    expect((await generate(j, "key", [new Uint8Array([1])])).mime).toBe(
      "image/png",
    );
    expect(generateImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        prompt: expect.objectContaining({ text: "Panda" }),
      }),
    );
    await generate({ ...j, transparent: false }, "key", []);
  });
  it("rejects unsupported features before calling the model", async () => {
    const j = {
      provider: "google",
      model: "gemini-3.1-flash-image-preview",
      transparent: false,
    } as Job;
    await expect(generate(j, "key", [new Uint8Array([1])])).rejects.toThrow(
      "references",
    );
    await expect(
      generate({ ...j, transparent: true }, "key", []),
    ).rejects.toThrow("Transparency");
  });
});

it("uses aspect ratio for Google image generation", async () => {
  vi.mocked(generateImage).mockResolvedValue({
    image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" },
    usage: {},
  } as never);
  await generate(
    {
      provider: "google",
      model: "gemini-image",
      prompt: "panda",
      width: 1536,
      height: 1024,
      transparent: false,
    } as Job,
    "key",
    [],
  );
  expect(generateImage).toHaveBeenLastCalledWith(
    expect.objectContaining({ aspectRatio: "3:2" }),
  );
});
it("handles an empty provider model response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  expect(await discoverModels("openai", "key")).toEqual([]);
});

it("discovers OpenRouter image models and their reference capabilities", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "bytedance/seedream",
            name: "Seedream",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["image"],
            },
          },
        ],
      }),
    }),
  );
  const models = await discoverModels("openrouter", "key");
  expect(models).toEqual([
    {
      id: "bytedance/seedream",
      name: "Seedream",
      provider: "openrouter",
      references: true,
      transparency: false,
    },
  ]);
  expect(
    providerModel("openrouter", "key", "bytedance/seedream").provider,
  ).toBe("openrouter");
});

it("uses explicit ratio profile parameters regardless of provider name", async () => {
  vi.mocked(generateImage).mockResolvedValue({
    image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" }, usage: {},
  } as never);
  await generate({ provider: "openai", model: "custom", prompt: "panda",
    width: 1280, height: 720, transparent: false } as Job, "key", [],
    { mode: "aspect-ratio", ratios: ["16:9"], levels: [] });
  const call = vi.mocked(generateImage).mock.calls.at(-1)![0];
  expect(call.aspectRatio).toBe("16:9");
  expect(call.size).toBeUndefined();
});

it("fits profiled provider output when returned dimensions differ", async () => {
  const { fitImage } = await import("../src/sources/image-fit");
  vi.mocked(generateImage).mockResolvedValue({
    image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" }, usage: {},
  } as never);
  const result = await generate({ provider: "openai", model: "custom", prompt: "panda",
    width: 800, height: 800, transparent: false } as Job, "key", [],
    { mode: "fixed", sizes: [{width:1024,height:1024}] });
  expect(fitImage).toHaveBeenCalledWith(new Uint8Array([1]), {width:800,height:800});
  expect(result.generatedDimensions).toMatchObject({width:1024,height:1024});
});

it("keeps exact-size provider bytes without fitting", async () => {
  const { fitImage } = await import("../src/sources/image-fit");
  vi.mocked(fitImage).mockClear();
  const bytes = new Uint8Array([9, 8, 7]);
  vi.mocked(generateImage).mockResolvedValue({ image: { uint8Array: bytes, mediaType: "image/png" }, usage: {} } as never);
  const result = await generate({ provider: "openai", model: "custom", prompt: "panda",
    width: 1024, height: 1024, transparent: false } as Job, "key", [],
    { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] });
  expect(fitImage).not.toHaveBeenCalled();
  expect(result.bytes).toBe(bytes);
});

it("returns original output with an error when fitting fails", async () => {
  const { fitImage } = await import("../src/sources/image-fit");
  vi.mocked(fitImage).mockRejectedValueOnce(new Error("Too small"));
  const bytes = new Uint8Array([3, 2, 1]);
  vi.mocked(generateImage).mockResolvedValue({ image: { uint8Array: bytes, mediaType: "image/png" }, usage: {} } as never);
  const result = await generate({ provider: "openai", model: "custom", prompt: "panda",
    width: 800, height: 800, transparent: false } as Job, "key", [],
    { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] });
  expect(result.bytes).toBe(bytes);
  expect(result.adaptationError).toContain("generated image was saved");
  expect(vi.mocked(generateImage).mock.calls.at(-1)![0].maxRetries).toBe(0);
});

it("preserves native provider bytes for an aspect-only request", async () => {
  const { fitImage } = await import("../src/sources/image-fit");
  vi.mocked(fitImage).mockClear();
  const bytes = new Uint8Array([7, 5, 3]);
  vi.mocked(generateImage).mockResolvedValue({
    image: { uint8Array: bytes, mediaType: "image/png" }, usage: {},
  } as never);
  const result = await generate({
    provider: "openai", model: "custom", prompt: "panda",
    width: 800, height: 800, transparent: false, exactDimensions: false,
  } as Job, "key", [], { mode: "aspect-ratio", ratios: ["1:1"], levels: [] });
  expect(result).toMatchObject({ width: 1024, height: 1024 });
  expect(result.bytes).toBe(bytes);
  expect(fitImage).not.toHaveBeenCalled();
  expect(generateImage).toHaveBeenLastCalledWith(expect.objectContaining({ aspectRatio: "1:1" }));
});

it("forwards a supported Google resolution alongside the aspect ratio", async () => {
  const bytes = new Uint8Array([5, 2, 1]);
  vi.mocked(generateImage).mockResolvedValue({
    image: { uint8Array: bytes, mediaType: "image/png" },
    usage: {},
  } as never);
  const job = {
    provider: "google", model: "gemini-test-image", prompt: "panda",
    width: 1920, height: 1080, resolution: "2K", exactDimensions: false,
  } as Job;
  const profile = { mode: "aspect-ratio", ratios: ["16:9"], levels: ["1K", "2K"] } as const;
  const sizeProfile = { ...profile, ratios: [...profile.ratios], levels: [...profile.levels] };
  await expect(generate(job, "key", [], sizeProfile)).resolves.toMatchObject({ bytes });
  expect(generateImage).toHaveBeenLastCalledWith(expect.objectContaining({
    aspectRatio: "16:9",
    size: undefined,
    providerOptions: { google: { imageConfig: { imageSize: "2K" } } },
  }));
  await expect(generate({ ...job, resolution: "4K" }, "key", [], sizeProfile)).rejects.toThrow("Unsupported resolution level");
});

it("routes an OpenRouter request with an image reference through its image model", async () => {
  const reference = new Uint8Array([1, 2, 3]);
  const output = new Uint8Array([4, 5, 6]);
  vi.mocked(generateImage).mockResolvedValueOnce({
    image: { uint8Array: output, mediaType: "image/png" },
    usage: {},
  } as Awaited<ReturnType<typeof generateImage>>);

  const result = await generate({
    provider: "openrouter",
    model: "bytedance/seedream",
    prompt: "Preserve the composition",
    width: 1024,
    height: 1024,
    transparent: false,
  } as Job, "test-key", [reference]);

  expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({
    model: expect.objectContaining({ provider: "openrouter" }),
    prompt: { text: "Preserve the composition", images: [reference] },
    size: "1024x1024",
    maxRetries: 0,
  }));
  expect(result).toMatchObject({ bytes: output, mime: "image/png", width: 1024, height: 1024 });
});

it("reports a credential rejection without reading the provider error body", async () => {
  const json = vi.fn(async () => ({ error: "fixture-key" }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json })));
  await expect(discoverModels("openrouter", "fixture-key"))
    .rejects.toThrow("This API key cannot list image models (403). Check its permissions.");
  expect(json).not.toHaveBeenCalled();
});

it.each(["transport", "response"])("does not expose credentials from a failed model-discovery %s", async stage => {
  const secret = "private-provider-credential-fixture";
  const failure = new Error(`Authorization: Bearer ${secret}`);
  const fetch = vi.fn(stage === "transport"
    ? async () => { throw failure; }
    : async () => ({ ok: true, json: async () => { throw failure; } }));
  vi.stubGlobal("fetch", fetch);
  const error = await discoverModels("openai", secret).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toContain(secret);
  expect((error as Error).cause).toBeUndefined();
  expect((error as Error).message).toMatch(/Could not reach|unreadable model list/);
});


it.each([null, { data: "private-catalog-value" }, { data: [null] }, { models: [{ id: 123 }] }, { data: [{ architecture: { input_modalities: "private-catalog-value" } }] }])(
  "rejects malformed model catalog without leaking its contents: %j", async catalog => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalog })));
    await expect(discoverModels("openai", "key")).rejects.toThrow("The provider returned an unreadable model list. Try again later.");
  },
);
