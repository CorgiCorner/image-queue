import { UserFacingError } from "./user-facing-error";
import { imageSize } from "image-size";
export function validateReference(mime: string, bytes: Uint8Array) {
  const signatures: Record<string, (data: Uint8Array) => boolean> = {
    "image/png": (data) =>
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => data[index] === value,
      ),
    "image/jpeg": (data) =>
      data[0] === 255 && data[1] === 216 && data[2] === 255,
    "image/webp": (data) =>
      new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(data.slice(8, 12)) === "WEBP",

  };
  if (!signatures[mime]?.(bytes))
    throw new UserFacingError(
      "File contents do not match the selected image format");
  if (mime.startsWith("image/")) {
    const size = imageSize(bytes);
    if (
      !size.width ||
      !size.height ||
      size.width > 20000 ||
      size.height > 20000
    )
      throw new UserFacingError("Reference image dimensions are not supported");
  }
}
