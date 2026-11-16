// Only application-owned validation messages may cross the upload boundary.
const validationMessages = new Set([
  "Project does not exist",
  "Image must be between 1 byte and 20 MB",
  "Import supports images only",
  "Unsupported reference format",
  "Reference must be between 1 byte and 20 MB",
  "File contents do not match the selected image format",
  "Reference image dimensions are not supported",
  "Frame timestamp must be a non-negative number",
  "A video frame must be an image",
  "Frame must belong to a video in this project",
]);

export function uploadErrorMessage(error: unknown) {
  return error instanceof Error && validationMessages.has(error.message)
    ? error.message
    : "Upload failed";
}
