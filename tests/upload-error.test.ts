import { expect, it } from "vitest";
import { uploadErrorMessage } from "../src/core/upload-error";
it.each([new Error("private credential"), "private credential", null, { message: "Project does not exist" }])("hides unknown failures %j", error => {
  expect(uploadErrorMessage(error)).toBe("Upload failed");
});
it.each(["Project does not exist", "Unsupported reference format", "Reference image dimensions are not supported"])("preserves validation: %s", message => {
  expect(uploadErrorMessage(new Error(message))).toBe(message);
});
