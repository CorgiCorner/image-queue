import { describe, expect, it } from "vitest";
import { validateReference } from "../src/core/reference-validation";
import { modelSizes } from "../src/core/model-options";
import { png, mp4 } from "./fixtures";
describe("reference and model options", () => {
  it("accepts supported image signatures and rejects video", () => {
    expect(() => validateReference("image/png", png)).not.toThrow();
    expect(() => validateReference("video/mp4", mp4)).toThrow();
    expect(() => validateReference("video/quicktime", mp4)).toThrow();
    expect(() =>
      validateReference("video/webm", new Uint8Array([26, 69, 223, 163])),
    ).toThrow();
  });
  it("rejects disguised content and invalid headers", () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "text/plain",
    ])
      expect(() =>
        validateReference(mime, new Uint8Array([1, 2, 3])),
      ).toThrow();
    expect(() =>
      validateReference("image/jpeg", new Uint8Array([255, 216, 255])),
    ).toThrow();
  });
  it("provides only supported preset families", () => {
    expect(modelSizes("google", "gemini-image")).toContain("1536x864");
    expect(modelSizes("gateway", "google/gemini-image")).toContain("864x1536");
    expect(modelSizes("openai", "gpt-image")).not.toContain("1792x1024");
  });
});
it("rejects excessive image dimensions", () => {
  const bytes = png.slice();
  new DataView(bytes.buffer).setUint32(16, 20001);
  expect(() => validateReference("image/png", bytes)).toThrow("dimensions");
});
