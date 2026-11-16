import { expect, it, vi } from "vitest";
import { DELETE, POST } from "../src/app/api/mcp/route";

it("preserves negotiated MCP Apps resources across authenticated HTTP requests", async () => {
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "local-test-token");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  const url = "http://localhost/api/mcp";
  const headers = {
    authorization: "Bearer local-test-token",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const send = (message: object, session?: string) => POST(new Request(url, {
    method: "POST",
    headers: { ...headers, ...(session && { "mcp-session-id": session }) },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  }));
  let session: string | null = null;
  try {
    const initialize = await send({
      id: 1, method: "initialize", params: {
        protocolVersion: "2025-11-25",
        capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
        clientInfo: { name: "browser-host", version: "1.0" },
      },
    });
    expect(initialize.status).toBe(200);
    session = initialize.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    expect((await send({ method: "notifications/initialized" }, session!)).status).toBe(202);
    const resources = await send({ id: 2, method: "resources/list" }, session!);
    expect((await resources.json()).result.resources.map((resource: { uri: string }) => resource.uri).sort())
      .toEqual(["ui://image-queue/gallery", "ui://image-queue/image", "ui://image-queue/job"]);
    const unauthorized = await POST(new Request(url, {
      method: "POST", headers: { "mcp-session-id": session! },
    }));
    expect(unauthorized.status).toBe(401);
    const removed = await DELETE(new Request(url, {
      method: "DELETE", headers: { ...headers, "mcp-session-id": session! },
    }));
    expect(removed.ok).toBe(true);
    expect((await send({ id: 3, method: "resources/list" }, session!)).status).toBe(404);
  } finally {
    if (session) await DELETE(new Request(url, {
      method: "DELETE", headers: { ...headers, "mcp-session-id": session },
    }));
    vi.unstubAllEnvs();
  }
});

it("expires inactive sessions and rejects deletion without a session", async () => {
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "local-test-token");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  const clock = vi.spyOn(Date, "now");
  const url = "http://localhost/api/mcp";
  const headers = {
    authorization: "Bearer local-test-token",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  let session: string | null = null;
  try {
    expect((await DELETE(new Request(url, { method: "DELETE", headers }))).status).toBe(405);
    const now = Date.now();
    clock.mockReturnValue(now);
    const response = await POST(new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "expiry-test", version: "1.0" },
        },
      }),
    }));
    session = response.headers.get("mcp-session-id");
    expect(response.status).toBe(200);
    expect(session).toBeTruthy();
    await response.json();

    clock.mockReturnValue(now + 30 * 60 * 1000);
    const expired = await DELETE(new Request(url, {
      method: "DELETE",
      headers: { ...headers, "mcp-session-id": session! },
    }));
    expect(expired.status).toBe(404);
  } finally {
    if (session) await DELETE(new Request(url, {
      method: "DELETE", headers: { ...headers, "mcp-session-id": session },
    }));
    clock.mockRestore();
    vi.unstubAllEnvs();
  }
});

it("evicts the least recently active session when the local session limit is reached", async () => {
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "local-test-token");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  const clock = vi.spyOn(Date, "now");
  const now = Date.now();
  const url = "http://localhost/api/mcp";
  const headers = {
    authorization: "Bearer local-test-token",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const ids: string[] = [];
  const close = (id: string) => DELETE(new Request(url, {
    method: "DELETE",
    headers: { ...headers, "mcp-session-id": id },
  }));
  try {
    for (let index = 0; index < 33; index++) {
      clock.mockReturnValue(now + index);
      if (index === 32) {
        const refreshed = await POST(new Request(url, {
          method: "POST",
          headers: { ...headers, "mcp-session-id": ids[0] },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }));
        expect(refreshed.status).toBe(200);
        await refreshed.json();
      }
      const response = await POST(new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "session-limit-test", version: "1.0" },
          },
        }),
      }));
      expect(response.status).toBe(200);
      ids.push(response.headers.get("mcp-session-id")!);
      await response.json();
    }
    expect(new Set(ids).size).toBe(33);
    expect((await close(ids[1])).status).toBe(404);
    expect((await close(ids[0])).ok).toBe(true);
    expect((await close(ids[32])).ok).toBe(true);
  } finally {
    for (const id of ids) await close(id);
    clock.mockRestore();
    vi.unstubAllEnvs();
  }
});

it("rejects DELETE for the stateless Cloudflare transport", async () => {
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "local-test-token");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  try {
    const response = await DELETE(new Request("http://localhost/api/mcp", {
      method: "DELETE",
      headers: { authorization: "Bearer local-test-token" },
    }));

    expect(response.status).toBe(405);
    expect(response.headers.has("mcp-session-id")).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("handles independent authenticated MCP requests in Cloudflare mode", async () => {
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "local-test-token");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  try {
    const send = (message: object, token = "local-test-token") => POST(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    }));

    const params = {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "stateless-test", version: "1.0" },
    };
    const initialize = await send({ id: 1, method: "initialize", params });
    expect(initialize.status).toBe(200);
    expect(initialize.headers.has("mcp-session-id")).toBe(false);
    expect(await initialize.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-11-25" } });

    const tools = await send({ id: 2, method: "tools/list" });
    expect(tools.status).toBe(200);
    expect(tools.headers.has("mcp-session-id")).toBe(false);
    expect(await tools.json()).toMatchObject({ id: 2, result: {
      tools: expect.arrayContaining([expect.objectContaining({ name: "request_image" })]),
    } });

    expect((await send({ id: 3, method: "tools/list" }, "wrong-token")).status).toBe(401);
  } finally {
    vi.unstubAllEnvs();
  }
});
