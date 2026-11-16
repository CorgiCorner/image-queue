// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { CompactApp } from "../src/mcp/views/compact-app";

it("negotiates with the parent, exchanges tool messages and acknowledges teardown", async () => {
  const frame = new EventTarget();
  const postMessage = vi.fn();
  const parent = { postMessage } as unknown as Window;
  Object.assign(frame, { parent, document });
  const origin = "https://host.example";
  const receive = (message: object) => frame.dispatchEvent(new MessageEvent("message", {
    origin, source: parent, data: { jsonrpc: "2.0", ...message },
  }));
  const app = new CompactApp({ name: "image-queue", version: "1.0" }, frame as unknown as Window);
  app.ontoolinput = vi.fn();
  app.onhostcontextchanged = vi.fn();
  try {
    const connected = app.connect();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 1, method: "ui/initialize",
      params: { protocolVersion: "2026-01-26", appInfo: { name: "image-queue", version: "1.0" }, appCapabilities: {} },
    }), "*");
    receive({ id: 1, result: { protocolVersion: "2026-01-26", hostContext: { theme: "light" } } });
    await connected;
    expect(postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, origin);
    receive({ method: "ui/notifications/tool-input", params: { arguments: { id: "job" } } });
    expect(app.ontoolinput).toHaveBeenCalledWith({ arguments: { id: "job" } });
    receive({ method: "ui/notifications/host-context-changed", params: { theme: "dark" } });
    expect(app.getHostContext()?.theme).toBe("dark");
    const request = app.callServerTool({ name: "get_job", arguments: { id: "job" } });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 2, method: "tools/call", params: { name: "get_job", arguments: { id: "job" } },
    }), origin);
    receive({ id: 2, result: { content: [] } });
    await expect(request).resolves.toEqual({ content: [] });
  } finally {
    receive({ id: 42, method: "ui/resource-teardown" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 42, result: {} }, origin));
  }
  await expect(app.callServerTool({ name: "get_job" })).rejects.toThrow("connection is closed");
});

it("interoperates with the official SDK host bridge", async () => {
  const { AppBridge } = await import("@modelcontextprotocol/ext-apps/app-bridge");
  const host = new AppBridge(null, { name: "test-host", version: "1.0" }, {});
  const frame = new EventTarget();
  const origin = "https://host.example";
  const transport: Parameters<typeof host.connect>[0] = {
    async start() {},
    async close() {},
    async send(message) {
      frame.dispatchEvent(new MessageEvent("message", { origin, source: parent, data: message }));
    },
  };
  const parent = {
    postMessage(message: Parameters<typeof transport.send>[0]) {
      transport.onmessage?.(message);
    },
  } as unknown as Window;
  Object.assign(frame, { parent, document });

  const app = new CompactApp({ name: "image-queue", version: "1.0" }, frame as unknown as Window);
  const initialized = vi.fn();
  const result = vi.fn();
  host.oninitialized = initialized;
  host.oncalltool = async ({ name }) => ({ content: [{ type: "text", text: name }] });
  host.onreadresource = async ({ uri }) => ({ contents: [{ uri, mimeType: "image/webp", blob: "AQ==" }] });
  host.onrequestdisplaymode = async ({ mode }) => ({ mode });
  app.ontoolresult = result;

  await host.connect(transport);
  try {
    await app.connect();
    await vi.waitFor(() => expect(initialized).toHaveBeenCalledOnce());
    await host.sendToolInput({ arguments: {} });
    await host.sendToolResult({ content: [{ type: "text", text: "ready" }] });
    expect(result).toHaveBeenCalledWith({ content: [{ type: "text", text: "ready" }] });
    const uri = "ui://image-queue/thumbnail/fixture";
    await expect(app.callServerTool({ name: "get_job" })).resolves.toEqual({
      content: [{ type: "text", text: "get_job" }],
    });
    await expect(app.readServerResource({ uri })).resolves.toEqual({
      contents: [{ uri, mimeType: "image/webp", blob: "AQ==" }],
    });
    await expect(app.requestDisplayMode({ mode: "fullscreen" })).resolves.toEqual({ mode: "fullscreen" });
    await expect(host.teardownResource({})).resolves.toEqual({});
  } finally {
    await host.close();
  }
});

it("rejects an unsupported host protocol without announcing initialization", async () => {
  const frame = new EventTarget();
  const postMessage = vi.fn();
  const parent = { postMessage } as unknown as Window;
  Object.assign(frame, { parent, document });
  const app = new CompactApp({ name: "image-queue", version: "1.0" }, frame as unknown as Window);
  const connection = app.connect();
  frame.dispatchEvent(new MessageEvent("message", {
    origin: "https://host.example",
    source: parent,
    data: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2000-01-01" } },
  }));

  await expect(connection).rejects.toThrow("Unsupported MCP Apps protocol");
  expect(postMessage).toHaveBeenCalledTimes(1);
  await expect(app.callServerTool({ name: "get_job" })).rejects.toThrow("connection is closed");
});
