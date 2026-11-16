import { afterEach, expect, it, vi } from "vitest";
import { localRequestDenied } from "../src/core/local-request";
import { accessDeniedResponse } from "../src/core/access-response";
import { POST as mcp } from "../src/app/api/mcp/route";

afterEach(() => vi.unstubAllEnvs());

it.each([
  { host: "evil.example", origin: undefined },
  { host: "evil@localhost", origin: undefined },
  { host: "localhost/path", origin: undefined },
  { host: "127.0.0.1:3215", origin: "https://evil.example" },
  { host: "127.0.0.1:3215", origin: "null" },
  { host: "127.0.0.1:3215", origin: "http://127.0.0.1:9999" },
  { host: "127.0.0.1:3215", origin: "http://user:password@127.0.0.1:3215" },
])("rejects foreign local request %j before API or MCP work", async ({ host, origin }) => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  const request = new Request("http://127.0.0.1:3215/api/state", { headers: { host, ...(origin ? { origin } : {}) } });
  expect(localRequestDenied(request)).toBe(true);
  expect((await accessDeniedResponse(request))?.status).toBe(403);
  expect((await mcp(request)).status).toBe(403);
});

it.each(["127.0.0.1:3215", "localhost:3215", "[::1]:3215"])("allows same-origin and non-browser loopback requests for %s", host => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  for (const origin of [undefined, `http://${host}`]) {
    expect(localRequestDenied(new Request(`http://${host}/api/state`, { headers: { host, ...(origin ? { origin } : {}) } }))).toBe(false);
  }
});

it("leaves cloud deployment authentication to Cloudflare Access", () => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  expect(localRequestDenied(new Request("https://workspace.example/api/state"))).toBe(false);
});
