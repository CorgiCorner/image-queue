/** Stored MIME type for an OpenAI image output format. */
export const outputMime = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
} as const;

export function extensionForMime(mime: string) {
  switch (mime.split(";")[0]?.trim().toLowerCase()) {
    case "image/webp": return "webp";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}

/** MIME for an `image-size` type, when the bytes identify a format this app stores. */
export function mimeForDetectedType(type?: string) {
  switch (type) {
    case "png": return outputMime.png;
    case "jpg":
    case "jpeg": return outputMime.jpeg;
    case "webp": return outputMime.webp;
    case "gif": return outputMime.gif;
    case "svg": return outputMime.svg;
    default: return undefined;
  }
}

/** True when the bytes are an SVG document with an `<svg` root. */
export function svgDocument(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trimStart();
  return /^(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s>/]/i.test(text);
}

export const unsupportedReferenceMessage = "GIF and SVG results cannot be used as references.";

/** PNG, JPEG and WebP results can become references. GIF and SVG cannot. */
export function referenceFormatError(format?: string) {
  return format === "gif" || format === "svg" ? unsupportedReferenceMessage : undefined;
}

/**
 * How the next version of a finished image is made. "edit" sends the image itself
 * as the reference. An animation this application generated cannot be a reference,
 * so it is generated again from its own prompt with the requested changes
 * ("regenerate"). Anything else has no next version.
 */
export function nextVersionMode(job: { outputFormat?: string; source?: string; imported?: boolean }): "edit" | "regenerate" | "none" {
  if (!referenceFormatError(job.outputFormat)) return "edit";
  return job.outputFormat === "gif" && job.source === "api" && !job.imported ? "regenerate" : "none";
}

/** File extension for a requested format. Omitted and unknown values stay PNG. */
export function extensionForOutputFormat(format?: string) {
  if (format === "jpeg") return "jpg";
  if (format === "webp" || format === "gif" || format === "svg" || format === "png") return format;
  return "png";
}
