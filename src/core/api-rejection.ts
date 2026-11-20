import { UserFacingError } from "./user-facing-error";

const marker = Symbol.for("image-queue.image-request-error");
const definiteStatuses = new Set([400, 401, 403, 404, 409, 413, 415, 422, 429]);
const billingUrl = "https://platform.openai.com/settings/organization/billing";
const maxProviderText = 300;

export type ProviderErrorFields = {
  message?: string;
  code?: string;
  type?: string;
};

/** An image-request HTTP error. Carries only the status and the provider's short error fields. */
export class ImageRequestError extends UserFacingError {
  private readonly [marker] = true;
  readonly statusCode: number;
  readonly providerMessage?: string;
  readonly providerCode?: string;
  readonly providerType?: string;

  constructor(statusCode: number, message: string, details?: ProviderErrorFields) {
    super(message);
    this.name = "ImageRequestError";
    this.statusCode = statusCode;
    this.providerMessage = details?.message;
    this.providerCode = details?.code;
    this.providerType = details?.type;
  }

  static isInstance(error: unknown): error is ImageRequestError {
    return Boolean(
      error &&
      typeof error === "object" &&
      marker in error &&
      (error as Record<symbol, unknown>)[marker] === true,
    );
  }
}

/** Read `error.message` / `code` / `type` from a provider JSON body. Never returns the raw body. */
export async function readProviderError(response: { json: () => Promise<unknown> }): Promise<ProviderErrorFields | undefined> {
  try {
    return publishedFields(rawFields(await response.json()));
  } catch {
    return undefined;
  }
}

/** A stored error for a definite image-request rejection, or undefined when the outcome is still ambiguous. */
export async function definiteRejectionMessage(error: unknown): Promise<string | undefined> {
  const rejection = await rejectionOf(error);
  if (!rejection) return undefined;
  const quote = rejection.fields?.message ? `: ${rejection.fields.message}` : "";
  if (rejection.statusCode === 429 && isQuota(rejection.fields))
    return `The OpenAI account has no credits and must be topped up at ${billingUrl} (HTTP 429)${quote}. No image was generated.`;
  if (rejection.statusCode === 429)
    return `The provider rejected the image request (HTTP 429)${quote}. Retry later. No image was generated.`;
  if (rejection.statusCode === 401)
    return `The provider rejected this API key (HTTP 401)${quote}. Check the key and try again. No image was generated.`;
  if (rejection.statusCode === 403)
    return `This API key cannot generate images (HTTP 403)${quote}. Check its permissions. No image was generated.`;
  return `The provider rejected the image request (HTTP ${rejection.statusCode})${quote}. No image was generated.`;
}

async function rejectionOf(error: unknown): Promise<{ statusCode: number; fields?: ProviderErrorFields } | undefined> {
  if (ImageRequestError.isInstance(error) && definiteStatuses.has(error.statusCode))
    return {
      statusCode: error.statusCode,
      fields: publishedFields({ message: error.providerMessage, code: error.providerCode, type: error.providerType }),
    };
  const { APICallError } = await import("ai");
  if (APICallError.isInstance(error) && error.statusCode != null && definiteStatuses.has(error.statusCode)) {
    const parsed = parseBody(error.responseBody) ?? error.data;
    return { statusCode: error.statusCode, fields: publishedFields(rawFields(parsed)) };
  }
  return undefined;
}

function isQuota(fields?: ProviderErrorFields) {
  if (!fields) return false;
  return /insufficient_quota/i.test(`${fields.code ?? ""} ${fields.type ?? ""}`) || /no credits/i.test(fields.message ?? "");
}

function parseBody(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function rawFields(value: unknown): ProviderErrorFields | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const body = error as { message?: unknown; code?: unknown; type?: unknown };
  const message = typeof body.message === "string" ? body.message : undefined;
  const code = typeof body.code === "string" ? body.code : typeof body.code === "number" ? String(body.code) : undefined;
  const type = typeof body.type === "string" ? body.type : undefined;
  if (message === undefined && code === undefined && type === undefined) return undefined;
  return { message, code, type };
}

function publishedFields(fields: ProviderErrorFields | undefined): ProviderErrorFields | undefined {
  if (!fields) return undefined;
  const message = fields.message ? sanitize(fields.message) : undefined;
  const code = fields.code ? sanitize(fields.code).slice(0, 80) : undefined;
  const type = fields.type ? sanitize(fields.type).slice(0, 80) : undefined;
  if (!message && !code && !type) return undefined;
  return { message: message || undefined, code: code || undefined, type: type || undefined };
}

function sanitize(value: string) {
  return value
    .replace(/authorization\s*:\s*\S+/gi, "Authorization: [redacted]")
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxProviderText);
}
