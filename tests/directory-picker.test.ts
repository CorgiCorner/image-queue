import { beforeEach, expect, it, vi } from "vitest";
const { execute, configuration } = vi.hoisted(() => ({ execute: vi.fn(), configuration: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execute }));
vi.mock("../src/core/config", () => ({ configuration }));
import { POST } from "../src/app/api/directory-picker/route";

beforeEach(() => {
  execute.mockReset();
  configuration.mockReset();
});
function request(origin = "http://127.0.0.1:3215") {
  return new Request("http://127.0.0.1:3215/api/directory-picker", {
    method: "POST", headers: { origin },
  });
}
it("rejects cross-origin invocation before opening a picker", async () => {
  expect((await POST(request("https://example.com"))).status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});
it("returns the selected path without executing it", async () => {
  if (process.platform !== "darwin") return;
  execute.mockImplementation((...args) => (typeof args.at(-1) === "function" ? args.at(-1) : () => undefined)(null, "/tmp/image folders/\n", ""));
  expect(await (await POST(request())).json()).toEqual({ path: "/tmp/image folders/" });
  expect(execute).toHaveBeenCalledWith("/usr/bin/osascript", expect.any(Array), expect.objectContaining({ timeout: 120000 }), expect.any(Function));
});
it("treats native cancellation as an unchanged selection", async () => {
  if (process.platform !== "darwin") return;
  execute.mockImplementation((...args) => (typeof args.at(-1) === "function" ? args.at(-1) : () => undefined)(new Error("User canceled. (-128)")));
  expect(await (await POST(request())).json()).toEqual({ cancelled: true });
});
it("reports native errors without exposing command output", async () => {
  if (process.platform !== "darwin") return;
  execute.mockImplementation((...args) => (typeof args.at(-1) === "function" ? args.at(-1) : () => undefined)(new Error("private command details")));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("private command details");
});

it("rejects a non-local host even when origin matches", async () => {
  const response = await POST(new Request("https://example.com/api/directory-picker", {
    method: "POST", headers: { origin: "https://example.com" },
  }));
  expect(response.status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});
it("rejects requests without an origin", async () => {
  const response = await POST(new Request("http://127.0.0.1:3215/api/directory-picker", { method: "POST" }));
  expect(response.status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});

it("allows only one native picker at a time and releases it afterward", async () => {
  if (process.platform !== "darwin") return;
  let finish: (error: Error | null, stdout: string) => void = () => {};
  execute.mockImplementation((...args) => {
    if (typeof args.at(-1) === "function") finish = args.at(-1);
  });
  const first = POST(request());
  expect((await POST(request())).status).toBe(409);
  finish(null, "/tmp/folder/");
  expect((await first).status).toBe(200);
  execute.mockImplementation((...args) => {
    if (typeof args.at(-1) === "function") args.at(-1)(new Error("cancel (-128)"));
  });
  expect((await POST(request())).status).toBe(200);
});

it("rejects folder selection on Cloudflare before launching the system dialog", async () => {
  configuration.mockReturnValue("cloudflare");
  expect((await POST(request())).status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});

it("offers manual path entry on platforms without the macOS dialog", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  try {
    const response = await POST(request());
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Use the path field on this operating system." });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});

it.each(["localhost", "127.0.0.1"])("accepts the loopback browser origin for request host %s", async (hostname) => {
  if (process.platform !== "darwin") return;
  execute.mockImplementation((_file, _args, _options, callback) => callback(null, "/tmp/folder/\n"));
  const response = await POST(new Request(`http://${hostname}:3215/api/directory-picker`, {
    method: "POST",
    headers: { host: "127.0.0.1:3215", origin: "http://127.0.0.1:3215" },
  }));
  expect(await response.json()).toEqual({ path: "/tmp/folder/" });
});

it.each(["http://127.0.0.1:9999", "http://example.com:3215", "https://127.0.0.1:3215", "invalid-origin"])(
  "rejects mismatched browser origin %s after Next normalizes the URL",
  async origin => {
    const response = await POST(new Request("http://localhost:3215/api/directory-picker", {
      method: "POST",
      headers: { host: "127.0.0.1:3215", origin },
    }));
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  },
);

it("allows a successful retry after the native chooser exits with an error", async () => {
  if (process.platform !== "darwin") return;
  execute
    .mockImplementationOnce((_file, _args, _options, callback) => callback(new Error("chooser exited")))
    .mockImplementationOnce((_file, _args, _options, callback) => callback(null, "/tmp/retry-folder/"));

  expect((await POST(request())).status).toBe(500);
  const retry = await POST(request());
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ path: "/tmp/retry-folder/" });
  expect(execute).toHaveBeenCalledTimes(2);
});
