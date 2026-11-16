import { beforeEach, expect, it, vi } from "vitest";
const importImage = vi.hoisted(() => vi.fn());
vi.mock("../src/core/access", () => ({ verifyAccess: async () => {} }));
vi.mock("../src/core/runtime", () => ({
  service: async () => ({ importImage }),
}));
import { POST } from "../src/app/api/import/route";
beforeEach(() => vi.resetAllMocks());
function request(form: FormData, origin = "http://localhost:3215") {
  return new Request("http://localhost:3215/api/import", {
    method: "POST",
    headers: { origin },
    body: form,
  });
}
it("imports a file to Inbox by default", async () => {
  importImage.mockResolvedValue({ job: { id: "one" } });
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([1, 2])], "image.png", { type: "image/png" }),
  );
  const response = await POST(request(form));
  expect(response.status).toBe(200);
  expect(importImage).toHaveBeenCalledWith(
    "image.png",
    "image/png",
    new Uint8Array([1, 2]),
    "inbox",
  );
});
it("rejects missing files and invalid origins", async () => {
  expect((await POST(request(new FormData()))).status).toBe(400);
  expect((await POST(request(new FormData(), "invalid"))).status).toBe(403);
});
it.each([
  [new Error("Unsupported image"), "Upload failed"],
  [new Error("Import supports images only"), "Import supports images only"],
  ["Unexpected rejection", "Upload failed"],
])("reports import failure %s without claiming success", async (error, message) => {
  importImage.mockRejectedValue(error);
  const form = new FormData();
  form.set("file", new File(["x"], "x.png"));
  const response = await POST(request(form));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: message });
});
