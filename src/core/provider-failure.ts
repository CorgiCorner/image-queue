import { APICallError } from "ai";
import { ImageRequestError } from "./api-rejection";

export function providerFailure(error: unknown, now = Date.now()) {
  // Image requests sent without the SDK report their status through ImageRequestError.
  const direct = ImageRequestError.isInstance(error) ? error : undefined;
  const status = APICallError.isInstance(error) ? error.statusCode : direct?.statusCode;
  if (status === 429) {
    const details = APICallError.isInstance(error)
      ? (error.data as { error?: { code?: string; type?: string } } | undefined)
      : { error: { code: direct?.providerCode, type: direct?.providerType } };
    if (
      details?.error?.code === "insufficient_quota" ||
      details?.error?.type === "insufficient_quota"
    )
      return {
        status: "failed" as const,
        stop: true,
        error:
          "OpenAI rejected this request due to insufficient API credit. Check billing before resuming.",
      };
    const header = APICallError.isInstance(error) ? error.responseHeaders?.["retry-after"]?.trim() : undefined;
    const time = !header
      ? NaN
      : /^\d+$/.test(header)
        ? now + Number(header) * 1000
        : Date.parse(header);
    const resumeAt =
      Number.isFinite(time) && time >= now && time < 8.64e15
        ? new Date(time).toISOString()
        : undefined;
    return {
      status: "failed" as const,
      stop: true,
      resumeAt,
      error: resumeAt
        ? "OpenAI rate limit reached. Waiting requests can continue after the reset."
        : "OpenAI rejected the request due to its usage limit. Check usage and billing before resuming.",
    };
  }
  if (status === 401 || status === 402 || status === 403)
    return {
      status: "failed" as const,
      stop: true,
      error:
        "OpenAI rejected access. Check the API key, permissions and billing, then resume API processing.",
    };
  if ([400, 404, 413, 415, 422].includes(status ?? 0))
    return {
      status: "failed" as const,
      error: `OpenAI rejected this image request (HTTP ${status}). Check the model, dimensions and references before retrying.`,
    };
  return {
    status: "uncertain" as const,
    error:
      "Generation did not complete locally. Check the provider before creating another request; it may have been charged.",
  };
}
