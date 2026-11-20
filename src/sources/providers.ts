import { ImageRequestError, readProviderError } from "../core/api-rejection";
import { mimeForDetectedType, outputMime, svgDocument } from "../core/image-format";
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
  if ((job.quality || job.complexity) && job.provider !== "openai")
    throw new UserFacingError("Quality and complexity settings require an OpenAI image model");
  if (job.outputFormat === "svg")
    return generateSvg(job, key, sizeParameters.size, references.length);
  if ((job.outputFormat || job.frameCount !== undefined || job.frameDurationMs !== undefined) && job.provider !== "openai")
    throw new UserFacingError("Output format and frame settings require an OpenAI image model");
  const rasterFormat = job.outputFormat;
  const openaiOptions = {
    ...(job.transparent ? { background: "transparent" as const, outputFormat: rasterFormat ?? "png" as const } : {}),
    ...(!job.transparent && rasterFormat ? { outputFormat: rasterFormat } : {}),
    ...(job.quality ? { quality: job.quality } : {}),
    ...(job.complexity ? { complexity: job.complexity } : {}),
    ...(rasterFormat === "gif" && job.frameCount !== undefined ? { frameCount: job.frameCount } : {}),
    ...(rasterFormat === "gif" && job.frameDurationMs !== undefined ? { frameDurationMs: job.frameDurationMs } : {}),
  };
  const providerOptions: Parameters<typeof generateImage>[0]["providerOptions"] = job.resolution && job.provider === "google"
    ? { google: { imageConfig: { imageSize: job.resolution } } }
    : Object.keys(openaiOptions).length ? { openai: openaiOptions } : undefined;
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
  let bytes = result.image.uint8Array;
  let mime = mimeOf(bytes);
  let adaptationError: string | undefined;
  const needsFit = Boolean(sizeProfile && job.exactDimensions !== false && (generatedDimensions.width !== job.width || generatedDimensions.height !== job.height));
  const fitFailure = (error: unknown) => error instanceof UserFacingError
    ? `The generated image was saved. ${error.message}`
    : "The generated image was saved, but could not be fitted to the requested dimensions without upscaling.";
  if (rasterFormat) {
    const requestedMime = outputMime[rasterFormat];
    if (mime !== requestedMime)
      adaptationError = `The generated image was saved. The provider returned ${mime} instead of the requested ${rasterFormat} output.`;
    else if (needsFit) {
      const { fitImage } = await import("./image-fit");
      try {
        const fitted = await fitImage(bytes, { width: job.width, height: job.height }, rasterFormat);
        bytes = fitted.bytes;
        mime = mimeOf(bytes);
        if (mime !== requestedMime)
          adaptationError = `The generated image was saved. The provider returned ${mime} instead of the requested ${rasterFormat} output.`;
      } catch (error) {
        adaptationError = fitFailure(error);
      }
    }
  } else if (needsFit) {
    const { fitImage } = await import("./image-fit");
    try {
      const fitted = await fitImage(bytes, { width: job.width, height: job.height }, "png");
      bytes = fitted.bytes;
      mime = outputMime.png;
    } catch (error) {
      adaptationError = fitFailure(error);
    }
  }
  return {
    ...imageSize(bytes),
    bytes,
    mime,
    generatedDimensions,
    adaptationError,
    usage: result.usage,
  };
}

/** Prefer the bytes over the provider's declared media type. */
function mimeOf(bytes: Uint8Array) {
  let detected: string | undefined;
  try { detected = mimeForDetectedType(imageSize(bytes).type); } catch { detected = undefined; }
  if (detected) return detected;
  if (svgDocument(bytes)) return outputMime.svg;
  throw new UserFacingError("The provider returned an unreadable image. Try again later.");
}

/** SVG is rejected by the installed SDK schema, and the edits endpoint cannot return it. */
async function generateSvg(job: Job, key: string, size: `${number}x${number}` | undefined, referenceCount: number) {
  if (job.provider !== "openai")
    throw new UserFacingError("SVG output requires an OpenAI image model");
  if (referenceCount)
    throw new UserFacingError("SVG output cannot be combined with reference images.");
  if (!size) throw new UserFacingError("SVG output requires a pixel size.");
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) throw new UserFacingError("SVG output requires a pixel size.");
  const body = {
    model: job.model,
    prompt: job.prompt,
    n: 1,
    size,
    output_format: "svg",
    ...(job.quality ? { quality: job.quality } : {}),
    ...(job.complexity ? { complexity: job.complexity } : {}),
    ...(job.transparent ? { background: "transparent" } : {}),
  };
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  }).catch(() => {
    throw new UserFacingError("Could not reach the provider. Check your connection and try again.");
  });
  if (response.status === 401)
    throw new ImageRequestError(401, "The provider rejected this API key (401). Check the key and try again.");
  if (response.status === 403)
    throw new ImageRequestError(403, "This API key cannot generate images (403). Check its permissions.");
  if (!response.ok)
    throw new ImageRequestError(
      response.status,
      `The provider rejected image generation (${response.status}).`,
      await readProviderError(response),
    );
  const payload = await response.json().catch(() => {
    throw new UserFacingError("The provider returned an unreadable image. Try again later.");
  });
  const parsed = z.object({
    data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
  }).safeParse(payload);
  if (!parsed.success)
    throw new UserFacingError("The provider returned an unreadable image. Try again later.");
  let bytes: Uint8Array;
  try {
    const binary = atob(parsed.data.data[0].b64_json);
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new UserFacingError("The provider returned an unreadable image. Try again later.");
  }
  if (!bytes.length || !svgDocument(bytes))
    throw new UserFacingError("The provider returned an unreadable image. Try again later.");
  return {
    bytes,
    mime: outputMime.svg,
    width,
    height,
    generatedDimensions: { width, height },
    adaptationError: undefined,
    usage: undefined,
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
