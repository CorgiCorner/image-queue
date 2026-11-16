import { afterEach, expect, it, vi } from "vitest";
import { generate } from "../src/sources/providers";
import type { Job } from "../src/core/schema";
import { png } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

it("uses Image API with the exact prompt and ordered reference bytes", async () => {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(url, init));
    return Response.json({ created: 1, data: [{ b64_json: Buffer.from(png).toString("base64") }] });
  }));
  const job = { provider: "openai", model: "gpt-image-1", prompt: "Change ONLY the hat to blue. Keep REF-7391.", width: 1024, height: 1024, transparent: false, exactDimensions: false } as Job;
  await generate(job, "fixture-only-key", []);
  expect(new URL(requests[0].url).pathname).toBe("/v1/images/generations");
  expect(await requests[0].json()).toMatchObject({ model: job.model, prompt: job.prompt, size: "1024x1024" });
  const references = [png, new Uint8Array([...png, 0])];
  await generate(job, "fixture-only-key", references);
  expect(new URL(requests[1].url).pathname).toBe("/v1/images/edits");
  const form = await requests[1].formData();
  expect(form.get("prompt")).toBe(job.prompt);
  const images = form.getAll("image[]") as File[];
  expect(images).toHaveLength(2);
  for (const [index, image] of images.entries()) expect(new Uint8Array(await image.arrayBuffer())).toEqual(references[index]);
  expect(requests.every(request => !request.url.includes("responses"))).toBe(true);
});

it.each([400, 429, 500])("does not retry or drop references after an edit rejection (%i)", async status => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    paths.push(new URL(new Request(url, init).url).pathname);
    return Response.json({ error: { message: "Fixture rejection", type: "invalid_request_error", code: "fixture" } }, { status });
  }));
  const job = { provider: "openai", model: "gpt-image-1", prompt: "Change the hat to blue", width: 1024, height: 1024, transparent: false } as Job;
  await expect(generate(job, "fixture-only-key", [png])).rejects.toThrow();
  expect(paths).toEqual(["/v1/images/edits"]);
});
