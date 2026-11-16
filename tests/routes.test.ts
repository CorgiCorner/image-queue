import * as thumbnailSource from "../src/sources/thumbnail";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: {
    get: vi.fn(),
    list: vi.fn(),
    getBlob: vi.fn(),
    put: vi.fn(),
    putBlob: vi.fn(),
  },
  api: { projects: vi.fn(), addReference: vi.fn(), importImage: vi.fn() },
  jobs: vi.fn(),
  verifyAccess: vi.fn(),
  cloudContext: vi.fn(),
}));
vi.mock("../src/storage", () => ({ storage: async () => mocks.store }));
vi.mock("../src/core/runtime", () => ({
  service: async () => ({ ...mocks.api, store: mocks.store }),
  refreshedJobs: mocks.jobs,
}));
vi.mock("../src/core/import-queue", () => ({
  importExistingQueue: async () => {},
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mocks.cloudContext }));
vi.mock("../src/core/access", () => ({ verifyAccess: mocks.verifyAccess }));
vi.mock("../src/mcp/server", () => ({
  createServer: () => ({ connect: async () => {} }),
}));
vi.mock(
  "@modelcontextprotocol/server",
  () => ({
    WebStandardStreamableHTTPServerTransport: class {
      async handleRequest() {
        return Response.json({ ok: true });
      }
    },
  }),
);
vi.mock("../src/sources/queue", () => ({
  configuredQueueRoot: async () => "/tmp",
  queueOutput: async () => new Uint8Array([1]),
}));

import { GET as asset } from "../src/app/api/asset/route";
import { POST as mcp } from "../src/app/api/mcp/route";
import { GET as state } from "../src/app/api/state/route";
import { StorageLockBusy } from "../src/storage/types";

import { POST as importImages } from "../src/app/api/import/route";
import { POST as upload } from "../src/app/api/upload/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.get.mockResolvedValue(undefined);
  mocks.store.list.mockResolvedValue([]);
  mocks.store.getBlob.mockResolvedValue(undefined);
  mocks.api.projects.mockResolvedValue([]);
  mocks.jobs.mockResolvedValue([]);
  delete process.env.STORAGE_DRIVER;
  delete process.env.MCP_TOKEN;
});
describe("HTTP adapters", () => {
  it.each([
    { endpoint: "state", method: "GET", handle: state },
    { endpoint: "asset", method: "GET", handle: asset },
    { endpoint: "import", method: "POST", handle: importImages },
    { endpoint: "upload", method: "POST", handle: upload },
    { endpoint: "mcp", method: "POST", handle: mcp },
  ])("rejects a foreign Host and Origin on $endpoint before reading data", async ({ endpoint, method, handle }) => {
    for (const headers of [
      { host: "foreign.example" },
      { host: "localhost", origin: "https://foreign.example" },
      { host: "localhost", origin: "null" },
    ] as Record<string, string>[]) {
      const response = await handle(new Request(`http://localhost/api/${endpoint}`, { method, headers }));
      expect(response.status).toBe(403);
    }
    expect(mocks.store.get).not.toHaveBeenCalled();
    expect(mocks.store.getBlob).not.toHaveBeenCalled();
    expect(mocks.api.projects).not.toHaveBeenCalled();
    expect(mocks.api.addReference).not.toHaveBeenCalled();
  });
  it("returns state with provider and worker metadata", async () => {
    expect(
      (await state(new Request("http://localhost/api/state"))).status,
    ).toBe(200);
  });
  it.each([
    { endpoint: "state", method: "GET", handle: state },
    { endpoint: "asset", method: "GET", handle: asset },
    { endpoint: "import", method: "POST", handle: importImages },
    { endpoint: "upload", method: "POST", handle: upload },
  ])("denies $endpoint before accessing data when access verification fails", async ({ endpoint, method, handle }) => {
    mocks.verifyAccess.mockRejectedValueOnce(new Error("Invalid assertion"));
    const response = await handle(new Request(`http://localhost/api/${endpoint}`, { method }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Access denied" });
    expect(mocks.api.projects).not.toHaveBeenCalled();
    expect(mocks.store.get).not.toHaveBeenCalled();
    expect(mocks.store.getBlob).not.toHaveBeenCalled();
    expect(mocks.api.addReference).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated MCP and accepts its configured bearer", async () => {
    expect(
      (await mcp(new Request("http://localhost/api/mcp", { method: "POST" })))
        .status,
    ).toBe(401);
    process.env.MCP_TOKEN = "test";
    expect(
      (
        await mcp(
          new Request("http://localhost/api/mcp", {
            method: "POST",
            headers: { authorization: "Bearer test" },
          }),
        )
      ).status,
    ).toBe(200);
    delete process.env.MCP_TOKEN;
  });
  it("rejects cross-origin and missing upload files", async () => {
    expect(
      (
        await upload(
          new Request("http://localhost/api/upload", { method: "POST" }),
        )
      ).status,
    ).toBe(403);
    const body = new FormData();
    body.set("projectId", "test");
    expect(
      (
        await upload(
          new Request("http://localhost/api/upload", {
            method: "POST",
            headers: { origin: "http://localhost" },
            body,
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("uploads references and reports errors", async () => {
    const body = new FormData();
    body.set("projectId", "p");
    body.set("file", new File(["x"], "x.png", { type: "image/png" }));
    body.set("parentId", "parent");
    body.set("timestampMs", "20");
    mocks.api.addReference.mockResolvedValue({ id: "ref" });
    expect(
      await (
        await upload(
          new Request("http://localhost/api/upload", {
            method: "POST",
            headers: { origin: "http://localhost" },
            body,
          }),
        )
      ).json(),
    ).toEqual({ id: "ref" });
    mocks.api.addReference.mockRejectedValue(new Error("bad upload"));
    expect(
      (
        await upload(
          new Request("http://localhost/api/upload", {
            method: "POST",
            headers: { origin: "http://localhost" },
            body,
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("returns missing images safely", async () => {
    expect(
      (await asset(new Request("http://localhost/api/asset"))).status,
    ).toBe(404);
    expect(
      (await asset(new Request("http://localhost/api/asset?job=missing")))
        .status,
    ).toBe(404);
    mocks.store.get.mockRejectedValue(new Error("invalid"));
    expect(
      (await asset(new Request("http://localhost/api/asset?job=bad"))).status,
    ).toBe(404);
  });
  it("serves uploaded images and cached thumbnail bytes", async () => {
    mocks.store.list.mockResolvedValue([{ blobKey: "ref" }]);
    mocks.store.getBlob.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mime: "image/png",
    });
    expect(
      (
        await asset(new Request("http://localhost/api/asset?key=ref"))
      ).headers.get("content-type"),
    ).toBe("image/png");
    mocks.store.get.mockImplementation(async (collection: string) => collection === "jobs" ? { status: "done" } : { hash: "hash" });
    expect(
      (
        await asset(new Request("http://localhost/api/asset?job=one&thumb=160"))
      ).headers.get("cache-control"),
    ).toContain("immutable");
  });
  it("builds and caches a real WebP thumbnail with dominant color", async () => {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#aa00aa" },
    })
      .png()
      .toBuffer();
    mocks.store.get.mockResolvedValue({
      status: "done",
      blobKey: "result",
      source: "api",
    });
    mocks.store.get.mockImplementation(async (c: string) =>
      c === "jobs"
        ? { status: "done", blobKey: "result", source: "api" }
        : undefined,
    );
    mocks.store.getBlob.mockResolvedValue({ bytes, mime: "image/png" });
    const response = await asset(
      new Request("http://localhost/api/asset?job=one&thumb=160"),
    );
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(mocks.store.put).toHaveBeenCalledWith(
      "asset-meta",
      "one",
      expect.objectContaining({ dominantColor: expect.any(String) }),
    );
    expect(mocks.store.putBlob).toHaveBeenCalled();
  });
  it("renders identical concurrent thumbnail requests once", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    mocks.store.get.mockImplementation(async (collection: string) =>
      collection === "jobs" ? { status: "done", blobKey: "result", source: "api" } : undefined,
    );
    mocks.store.getBlob.mockResolvedValue({ bytes, mime: "image/png" });
    const render = vi.spyOn(thumbnailSource, "thumbnail");
    try {
      const results = await Promise.all(["one", "two", "three"].map(id =>
        asset(new Request(`http://localhost/api/asset?job=${id}&thumb=160`)),
      ));
      expect(results.map(response => response.status)).toEqual([200, 200, 200]);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      render.mockRestore();
    }
  });
  it.each(["put", "putBlob"] as const)("serves WebP when cache %s fails", async (write) => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    mocks.store.get.mockImplementation(async (collection: string) =>
      collection === "jobs" ? { status: "done", blobKey: "result", source: "api" } : undefined,
    );
    mocks.store.getBlob.mockResolvedValue({ bytes, mime: "image/png" });
    mocks.store[write].mockRejectedValueOnce(new Error("Cache write contention"));
    const response = await asset(new Request("http://localhost/api/asset?job=one&thumb=160"));
    expect(response.status).toBe(200);
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe("webp");
  });
  it("reads queue originals and excludes local queues in cloud mode", async () => {
    mocks.store.get.mockImplementation(async (c: string) =>
      c === "jobs" ? { status: "done", source: "queue" } : undefined,
    );
    expect(
      (await asset(new Request("http://localhost/api/asset?job=one"))).status,
    ).toBe(200);
    process.env.STORAGE_DRIVER = "cloudflare";
    expect(
      (await asset(new Request("http://localhost/api/asset?job=one"))).status,
    ).toBe(404);
    delete process.env.STORAGE_DRIVER;
  });
});

it("merges asset colors into listed jobs", async () => {
  mocks.jobs.mockResolvedValue([{ id: "one" }]);
  mocks.store.list.mockImplementation(async (collection: string) =>
    collection === "asset-meta" ? [{ id: "one", dominantColor: "red" }] : [],
  );
  const result = await (
    await state(new Request("http://localhost/api/state"))
  ).json();
  expect(result.jobs[0].dominantColor).toBe("red");
});
it("accepts a matching Host when Next uses an internal request URL", async () => {
  const body = new FormData();
  body.set("projectId", "p");
  body.set("file", new File(["x"], "x.png", { type: "image/png" }));
  mocks.api.addReference.mockResolvedValue({ id: "ref" });
  expect(
    (
      await upload(
        new Request("http://localhost/api/upload", {
          method: "POST",
          headers: { host: "127.0.0.1:3215", origin: "http://127.0.0.1:3215" },
          body,
        }),
      )
    ).status,
  ).toBe(200);
});
it("maps non-Error upload failures", async () => {
  const body = new FormData();
  body.set("projectId", "p");
  body.set("file", new File(["x"], "x.png", { type: "image/png" }));
  mocks.api.addReference.mockRejectedValue("bad");
  expect(
    await (
      await upload(
        new Request("http://localhost/api/upload", {
          method: "POST",
          headers: { origin: "http://localhost" },
          body,
        }),
      )
    ).json(),
  ).toEqual({ error: "Upload failed" });
});

it("rejects arbitrary blob keys even if a blob exists", async () => {
  mocks.store.getBlob.mockResolvedValue({
    bytes: new Uint8Array([1]),
    mime: "application/json",
  });
  expect(
    (await asset(new Request("http://localhost/api/asset?key=secrets/openai")))
      .status,
  ).toBe(404);
});
it("rejects malformed upload origins", async () => {
  expect(
    (
      await upload(
        new Request("http://localhost/api/upload", {
          method: "POST",
          headers: { origin: "invalid url" },
        }),
      )
    ).status,
  ).toBe(403);
});
it("imports images through the same-origin endpoint", async () => {
  const { POST } = await import("../src/app/api/import/route");
  expect(
    (await POST(new Request("http://localhost/api/import", { method: "POST" })))
      .status,
  ).toBe(403);
});

it("serves a retained blocked output and rejects blocked jobs without a file", async () => {
  mocks.store.get.mockImplementation(async (collection: string) => collection === "jobs"
    ? { id: "retained", status: "blocked", blobKey: "results/retained" }
    : undefined);
  mocks.store.getBlob.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png" });
  const result = await asset(new Request("http://localhost/api/asset?job=retained"));
  expect(result.status).toBe(200);
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  mocks.store.get.mockResolvedValue({ id: "missing", status: "blocked" });
  expect((await asset(new Request("http://localhost/api/asset?job=missing"))).status).toBe(404);
});

it("checks job availability before returning a cached thumbnail", async () => {
  mocks.store.get.mockImplementation(async (collection: string) => collection === "asset-meta"
    ? { hash: "cached", dominantColor: "red" }
    : undefined);
  mocks.store.getBlob.mockResolvedValue({ bytes: new Uint8Array([1]), mime: "image/webp" });
  expect((await asset(new Request("http://localhost/api/asset?job=missing&thumb=160"))).status).toBe(404);
});

it.each([
  ["bytes=0-", 206, "bytes 0-3/4", [10, 20, 30, 40]],
  ["bytes=1-2", 206, "bytes 1-2/4", [20, 30]],
  ["bytes=-2", 206, "bytes 2-3/4", [30, 40]],
  ["bytes=4-", 416, "bytes */4", []],
  ["bytes=3-999", 206, "bytes 3-3/4", [40]],
  ["bytes=-99", 206, "bytes 0-3/4", [10, 20, 30, 40]],
  ["bytes=3-2", 416, "bytes */4", []],
  ["bytes=-0", 416, "bytes */4", []],
  ["bytes=-", 200, null, [10, 20, 30, 40]],
  ["items=1-2", 200, null, [10, 20, 30, 40]],
  [null, 200, null, [10, 20, 30, 40]],
] as const)("serves video reference range %s", async (range, status, contentRange, bytes) => {
  mocks.store.list.mockResolvedValueOnce([{ blobKey: "video" }]);
  mocks.store.getBlob.mockResolvedValueOnce({
    mime: "video/mp4",
    bytes: Uint8Array.of(10, 20, 30, 40),
  });
  const response = await asset(new Request("http://localhost/api/asset?key=video", {
    headers: range === null ? undefined : { Range: range },
  }));
  expect(response.status).toBe(status);
  expect(response.headers.get("content-range")).toBe(contentRange);
  if (status !== 416) {
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
  }
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(bytes);
});

it("caches reference thumbnails without creating job metadata", async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ff0000" },
  }).png().toBuffer();
  mocks.store.list.mockResolvedValueOnce([{ blobKey: "ref" }]);
  mocks.store.getBlob.mockResolvedValueOnce({ mime: "image/png", bytes });
  const response = await asset(new Request("http://localhost/api/asset?key=ref&thumb=160"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(mocks.store.put).not.toHaveBeenCalled();
  expect(mocks.store.putBlob).toHaveBeenCalledWith(
    expect.stringMatching(/^thumbs\/[a-f0-9]+\/160\.webp$/),
    expect.any(Uint8Array),
    "image/webp",
  );
});

it("uses the Cloudflare image binding and preserves cached dominant color", async () => {
  const webp = Uint8Array.of(1, 2, 3);
  const output = vi.fn(async () => ({ response: () => new Response(webp) }));
  const transform = vi.fn(() => ({ output }));
  const input = vi.fn(() => ({ transform }));
  mocks.cloudContext.mockResolvedValueOnce({ env: { IMAGES: { input } } });
  mocks.store.get.mockImplementation(async (collection: string) =>
    collection === "jobs" ? { status: "done", blobKey: "original" } :
    { hash: "old", dominantColor: "red" },
  );
  mocks.store.getBlob.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
    mime: "image/png", bytes: Uint8Array.of(10, 20, 30),
  });
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  try {
    const response = await asset(new Request("http://localhost/api/asset?job=one&thumb=160"));
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...webp]);
    expect(transform).toHaveBeenCalledWith({ width: 160 });
    expect(output).toHaveBeenCalledWith({ format: "image/webp" });
    expect(mocks.store.put).toHaveBeenCalledWith("asset-meta", "one",
      expect.objectContaining({ dominantColor: "red" }));
  } finally {
    vi.unstubAllEnvs();
  }
});

it("retries an overlapping project write while loading workspace state", async () => {
  mocks.jobs.mockRejectedValueOnce(new StorageLockBusy("record-write"))
    .mockResolvedValueOnce([{ id: "saved", status: "queued" }]);
  const response = await state(new Request("http://localhost/api/state"));
  expect(response.status).toBe(200);
  expect((await response.json()).jobs).toEqual([{ id: "saved", status: "queued" }]);
  expect(mocks.jobs).toHaveBeenCalledTimes(2);
});

it("returns a retryable response when a workspace write stays locked", async () => {
  const lock = new StorageLockBusy("record-write");
  const failure = vi.spyOn(mocks, "jobs");
  try {
    for (let attempt = 0; attempt < 4; attempt++) failure.mockRejectedValueOnce(lock);
    const response = await state(new Request("http://localhost/api/state"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Workspace update in progress" });
    expect(failure).toHaveBeenCalledTimes(4);
  } finally {
    failure.mockRestore();
  }
});

it("stops retrying workspace state after the request is aborted", async () => {
  const controller = new AbortController();
  mocks.jobs.mockImplementationOnce(async () => {
    controller.abort();
    throw new StorageLockBusy("record-write");
  });
  const request = new Request("http://localhost/api/state", { signal: controller.signal });
  await expect(state(request)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.jobs).toHaveBeenCalledOnce();
});

it.each([0, 3])("contains a private workspace read failure after %i lock conflicts", async (conflicts) => {
  const error = new Error("private-key-fixture inside internal filesystem failure");
  for (let attempt = 0; attempt < conflicts; attempt++) {
    mocks.jobs.mockRejectedValueOnce(new StorageLockBusy("record-write"));
  }
  mocks.jobs.mockRejectedValueOnce(error);

  const response = await state(new Request("http://localhost/api/state"));
  expect(response.status).toBe(500);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "Workspace could not be loaded. Try again." });
  expect(mocks.jobs).toHaveBeenCalledTimes(conflicts + 1);
});

it("caches only the successful retry after Cloudflare thumbnail generation fails", async () => {
  const webp = Uint8Array.of(1, 2, 3);
  const output = vi.fn(async () => ({ response: () => new Response(webp) }))
    .mockResolvedValueOnce({ response: () => new Response("Unavailable", { status: 503 }) });
  mocks.cloudContext.mockResolvedValue({ env: { IMAGES: {
    input: () => ({ transform: () => ({ output }) }),
  } } });
  mocks.store.get.mockImplementation(async (collection: string) =>
    collection === "jobs" ? { status: "done", blobKey: "original" } : undefined,
  );
  mocks.store.getBlob.mockResolvedValue({ mime: "image/png", bytes: Uint8Array.of(10, 20, 30) });
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  try {
    const response = await asset(new Request("http://localhost/api/asset?job=one&thumb=160"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.store.putBlob).not.toHaveBeenCalled();

    const retry = await asset(new Request("http://localhost/api/asset?job=one&thumb=160"));
    expect(retry.status).toBe(200);
    expect(retry.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await retry.arrayBuffer())).toEqual(webp);
    expect(mocks.store.putBlob).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllEnvs();
  }
});


it.each(["Authorization: Bearer private-fixture", "storage path /private/fixture", "Project does not exist"])(
  "limits upload errors to application-owned validation messages: %s", async message => {
    const body = new FormData();
    body.set("projectId", "p");
    body.set("file", new File(["x"], "x.png", { type: "image/png" }));
    mocks.api.addReference.mockRejectedValueOnce(new Error(message));
    const response = await upload(new Request("http://localhost/api/upload", {
      method: "POST", headers: { origin: "http://localhost" }, body,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message === "Project does not exist" ? message : "Upload failed" });
  },
);


it("hides internal import failures", async () => {
  const body = new FormData();
  body.set("file", new File(["x"], "x.png", { type: "image/png" }));
  mocks.api.importImage.mockRejectedValueOnce(new Error("Authorization: private-import-fixture"));
  const response = await importImages(new Request("http://localhost/api/import", {
    method: "POST", headers: { origin: "http://localhost" }, body,
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Upload failed" });
});
