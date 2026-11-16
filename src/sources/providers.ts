import { UserFacingError } from "../core/user-facing-error";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage } from "ai";
import { imageSize } from "image-size";
import { z } from "zod";
import { resolveModelSize, type SizeProfile } from "../core/size-intent";
import type { Job, Model, Provider } from "../core/schema";
export function providerModel(provider: Provider, key: string, model: string) {
  if (provider === "openrouter")
    return createOpenRouter({ apiKey: key }).imageModel(model) as ReturnType<
      ReturnType<typeof createOpenAI>["image"]
    >;
  if (provider === "openai") return createOpenAI({ apiKey: key }).image(model);
  if (provider === "google")
    return createGoogleGenerativeAI({ apiKey: key }).image(model);
  return createGateway({ apiKey: key }).image(model);
}
export async function discoverModels(
  provider: Provider,
  key: string,
): Promise<Model[]> {
  const urls = {
    openai: "https://api.openai.com/v1/models",
    google: "https://generativelanguage.googleapis.com/v1beta/models",
    gateway: "https://ai-gateway.vercel.sh/v1/models",
    openrouter: "https://openrouter.ai/api/v1/images/models",
  };
  const headers: Record<string, string> =
    provider === "google"
      ? { "x-goog-api-key": key }
      : { Authorization: `Bearer ${key}` };
  const response = await fetch(urls[provider], {
    headers,
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    // Transport errors may include request headers or credentials.
    throw new UserFacingError("Could not reach the provider. Check your connection and try again.");
  });
  if (response.status === 401)
    throw new UserFacingError("The provider rejected this API key (401). Check the key and try again.");
  if (response.status === 403)
    throw new UserFacingError("This API key cannot list image models (403). Check its permissions.");
  if (!response.ok)
    throw new Error(`Provider rejected model discovery (${response.status})`);
  const result = await response.json().catch(() => {
    throw new UserFacingError("The provider returned an unreadable model list. Try again later.");
  });
  const entrySchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    displayName: z.string().optional(),
    type: z.string().optional(),
    architecture: z.object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    }).optional(),
  }).refine(entry => Boolean(entry.id || entry.name));
  const catalog = z.object({
    data: z.array(entrySchema).optional(),
    models: z.array(entrySchema).optional(),
  }).safeParse(result);
  if (!catalog.success)
    throw new UserFacingError("The provider returned an unreadable model list. Try again later.");
  const entries = catalog.data.data ?? catalog.data.models ?? [];
  const models = entries.filter(
    (item) =>
      provider === "openai" ? /^gpt-image(?:-|$)/.test(item.id ?? item.name ?? "") :
      /gemini-.*(?:image|banana)/.test(item.id ?? item.name ?? "") ||
      item.type === "image" ||
      provider === "openrouter",
  );
  return Promise.all(
    models.map(async (item) => {
      const id = (item.id ?? item.name ?? "").replace(/^models\//, "");
      const model = providerModel(provider, key, id);
      return {
        id,
        name: item.displayName ?? item.name ?? id,
        provider,
        references:
          provider === "openrouter"
            ? item.architecture?.input_modalities?.includes("image") === true
            : (await Promise.resolve(model.supportsFileInputs).catch(() => {
                throw new UserFacingError("Could not check this model's reference support. Try again later.");
              })) === true,
        transparency: provider !== "openrouter" && /gpt-image/.test(id),
      };
    }),
  );
}
export async function generate(
  job: Job,
  key: string,
  references: Uint8Array[],
  sizeProfile?: SizeProfile,
) {
  const model = providerModel(job.provider, key, job.model);
  if (
    references.length &&
    job.provider !== "openrouter" &&
    (await model.supportsFileInputs) !== true
  )
    throw new UserFacingError(
      "This model does not advertise support for image references");
  if (job.transparent && !/gpt-image/.test(job.model))
    throw new UserFacingError("Transparency is not supported for this model");
  if (job.resolution && (job.provider !== "google" || !sizeProfile))
    throw new UserFacingError("Resolution levels require a supported Google image model");
  const sizeParameters: { size?: `${number}x${number}`; aspectRatio?: `${number}:${number}` } =
    sizeProfile
      ? resolveModelSize(sizeProfile, job).parameters as {
          size?: `${number}x${number}`; aspectRatio?: `${number}:${number}`;
        }
      : job.provider === "google"
        ? { aspectRatio: `${job.width / gcd(job.width, job.height)}:${job.height / gcd(job.width, job.height)}` }
        : { size: `${job.width}x${job.height}` };
  const providerOptions: Parameters<typeof generateImage>[0]["providerOptions"] = job.resolution && job.provider === "google"
    ? { google: { imageConfig: { imageSize: job.resolution } } }
    : job.transparent ? { openai: { background: "transparent" } } : undefined;
  const result = await generateImage({
    model,
    prompt: references.length
      ? { text: job.prompt, images: references }
      : job.prompt,
    size: sizeParameters.size,
    aspectRatio: sizeParameters.aspectRatio,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(240000),
    providerOptions,
  });
  const generatedDimensions = imageSize(result.image.uint8Array);
  let output = { bytes: result.image.uint8Array, mime: result.image.mediaType };
  let adaptationError: string | undefined;
  if (sizeProfile && job.exactDimensions !== false && (generatedDimensions.width !== job.width || generatedDimensions.height !== job.height)) {
    const { fitImage } = await import("./image-fit");
    try {
      output = await fitImage(output.bytes, { width: job.width, height: job.height });
    } catch {
      adaptationError = "The generated image was saved, but could not be fitted to the requested dimensions without upscaling.";
    }
  }
  return {
    ...imageSize(output.bytes),
    ...output,
    generatedDimensions,
    adaptationError,
    usage: result.usage,
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
