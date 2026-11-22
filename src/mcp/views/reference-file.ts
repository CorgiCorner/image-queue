/** A reference image ready for save_uploaded_reference: a PNG, JPEG or WebP file as base64. */
export type PreparedReference = { name: string; mime: string; data: string };

const accepted = new Set(["image/png", "image/jpeg", "image/webp"]);
/**
 * Files up to this size go to the server unchanged. Larger photos are scaled
 * down first, because the host relays every byte of a view's tool call.
 */
export const MAX_UNCHANGED_BYTES = 3 * 1024 * 1024;
/** Longest side of a scaled-down reference; the image models work below it. */
export const MAX_SCALED_SIDE = 2048;

/** Whether a file can be sent as it is, or must be decoded and re-encoded first. */
export function referenceUploadPlan(file: { type: string; size: number }) {
  return accepted.has(file.type) && file.size <= MAX_UNCHANGED_BYTES ? "as-is" : "re-encode";
}

/** The size a scaled-down copy gets, keeping the aspect ratio. */
export function scaledSize(width: number, height: number, maxSide = MAX_SCALED_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function renamed(name: string, mime: string) {
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[^./]+$/, "") || "reference";
  return `${base}.${extension}`;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function encode(canvas: HTMLCanvasElement, mime: string, quality?: number) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("This image could not be converted.");
  return blob;
}

/** Read a picked or dropped file, scaling photos down and converting HEIC or other formats to JPEG. */
export async function prepareReferenceFile(file: File): Promise<PreparedReference> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.type === "image/gif")
    throw new Error(`${file.name} is not a photo or picture. Use a PNG, JPEG or WebP image.`);
  if (referenceUploadPlan(file) === "as-is")
    return { name: file.name, mime: file.type, data: base64(new Uint8Array(await file.arrayBuffer())) };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} cannot be read here. Convert it to PNG or JPEG first.`);
  }
  const canvas = document.createElement("canvas");
  Object.assign(canvas, scaledSize(bitmap.width, bitmap.height));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps transparency; a photo that is still too large becomes JPEG.
  let mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  let blob = await encode(canvas, mime, mime === "image/jpeg" ? 0.9 : undefined);
  if (blob.size > MAX_UNCHANGED_BYTES && mime === "image/png") {
    mime = "image/jpeg";
    blob = await encode(canvas, mime, 0.9);
  }
  if (blob.size > MAX_UNCHANGED_BYTES) blob = await encode(canvas, "image/jpeg", 0.75);
  return { name: renamed(file.name, mime), mime, data: base64(new Uint8Array(await blob.arrayBuffer())) };
}
