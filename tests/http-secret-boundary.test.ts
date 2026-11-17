import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { service } from "../src/core/runtime";
import { saveKey, readKey, removeKey } from "../src/core/settings";
import { GET as state } from "../src/app/api/state/route";
import { GET as asset } from "../src/app/api/asset/route";
import { POST as upload } from "../src/app/api/upload/route";
import { POST as importImage } from "../src/app/api/import/route";
import { POST as mcp, DELETE as closeMcp } from "../src/app/api/mcp/route";
import { POST as picker } from "../src/app/api/directory-picker/route";
import { png } from "./fixtures";

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

it("keeps a stored provider credential out of every HTTP surface and its logs", async () => {
  root = await mkdtemp(path.join(tmpdir(), "http-secret-boundary-"));
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DIR", path.join(root, "store"));
  vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", path.join(root, "queue"));
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR", path.join(root, "credentials"));
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN", "test-mcp-token");
  const logs = ["log", "warn", "error", "info", "debug"].map(method =>
    vi.spyOn(console, method as "log").mockImplementation(() => {}));
  const secret = "provider-private-fixture-never-return";
  const api = await service();
  await saveKey(api.store, "openai", secret);
  expect(await readKey(api.store, "openai")).toBe(secret);
  const project = await api.createProject("Secret boundary test");
  const base = "http://127.0.0.1:3215";
  const formRequest = (endpoint: string) => {
    const body = new FormData();
    body.set("projectId", project.id);
    body.set("file", new File([png], "reference.png", { type: "image/png" }));
    return new Request(`${base}/api/${endpoint}`, { method: "POST", headers: { origin: base }, body });
  };
  const responses = [
    await state(new Request(`${base}/api/state`)),
    await asset(new Request(`${base}/api/asset?key=secrets/openai`)),
    await upload(formRequest("upload")),
    await importImage(formRequest("import")),
    await mcp(new Request(`${base}/api/mcp`, { method: "POST" })),
    // A foreign origin must be rejected before any native picker is launched.
    await picker(new Request(`${base}/api/directory-picker`, { method: "POST", headers: { origin: "https://foreign.example" } })),
  ];
  const headers = {
    authorization: "Bearer test-mcp-token",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const send = (message: object, session?: string) => mcp(new Request(`${base}/api/mcp`, {
    method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  }));
  const initialized = await send({ id: 1, method: "initialize", params: {
    protocolVersion: "2025-11-25", capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, clientInfo: { name: "secret-boundary", version: "1" },
  } });
  const session = initialized.headers.get("mcp-session-id");
  expect(session).toBeTruthy();
  try {
    expect(await initialized.text()).not.toContain(secret);
    await send({ method: "notifications/initialized" }, session!);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_queue_processing", {}], ["set_queue_processing", { source: "all", paused: true }],
      ["get_generation_source", {}], ["set_generation_source", { source: "queue" }],
      ["list_thumbnails", {}], ["get_image_details", { id: "missing" }],
      ["get_job_state", { id: "missing" }],
      ["add_notes_to_queue", { imageId: "missing", idempotencyKey: "audit-notes" }],
      ["list_models", {}], ["list_projects", {}], ["list_jobs", {}],
      ["create_project", { name: "MCP audit project" }],
      ["get_job", { id: "missing" }], ["show_job", { id: "missing" }],
      ["show_image", { id: "missing" }], ["show_images", {}],
      ["wait_for_job", { id: "missing", timeoutSeconds: 0 }],
      ["cancel_job", { id: "missing" }], ["retry_image", { id: "missing" }],
      ["mark_uncertain_failed", { id: "missing" }],
      ["add_reference", { projectId: project.id, filePath: path.join(root!, "missing.png") }],
      ["create_topic", { projectId: project.id, name: "Audit topic" }],
      ["list_topics", {}], ["move_to_topic", { ids: ["missing"], topicId: "missing" }],
      ["tag_image", { id: "missing", tags: ["audit"] }], ["list_untagged", {}],
      ["add_note", { imageId: "missing", text: "Audit note" }],
      ["list_notes", { imageId: "missing" }],
      ["iterate_image", { parentId: "missing", referenceId: "missing", prompt: "Audit iteration", idempotencyKey: "audit-iteration" }],
      ["request_image", { projectId: "missing", idempotencyKey: "audit-request", prompt: "Audit image", source: "queue", width: 1024, height: 1024 }],
      ["request_images", { requests: [{ projectId: "missing", idempotencyKey: "audit-batch", prompt: "Audit image", source: "queue", width: 1024, height: 1024 }] }],
    ];
    const listed = await send({ id: 50, method: "tools/list", params: {} }, session!);
    const inventory = await listed.json();
    expect(calls.map(([name]) => name).sort()).toEqual(inventory.result.tools.map((tool: { name: string }) => tool.name).sort());
    for (const [index, [name, args]] of calls.entries()) {
      const response = await send({ id: index + 100, method: "tools/call", params: { name, arguments: args } }, session!);
      expect(response.status, name).toBe(200);
      expect(await response.text(), name).not.toContain(secret);
    }
    await api.store.put("models", "openai", [{ id: "unprofiled", name: "Unprofiled", provider: "openai", references: true, transparency: false }]);
    const rejected = await send({ id: 10, method: "tools/call", params: {
      name: "request_image", arguments: {
        projectId: project.id, idempotencyKey: "unprofiled-http", prompt: "A simple blue square",
        source: "api", provider: "openai", model: "unprofiled", width: 1024, height: 1024,
      },
    } }, session!);
    const rejection = await rejected.json();
    expect(rejection.result.isError).toBe(true);
    expect(JSON.stringify(rejection)).toContain("no valid size profile");
    expect(JSON.stringify(rejection)).not.toContain(secret);
    const job = await api.store.get<{ status: string; attemptId?: string }>("jobs", "IMG-unprofiled-http");
    expect(job).toBeUndefined();
  } finally {
    await closeMcp(new Request(`${base}/api/mcp`, { method: "DELETE", headers: { ...headers, "mcp-session-id": session! } }));
  }
  expect(responses.map(response => response.status)).toEqual([200, 404, 200, 200, 401, 403]);
  for (const response of responses) expect(await response.text()).not.toContain(secret);
  expect(await api.store.get("secrets", "openai")).toEqual({ external: true });
  expect(JSON.stringify(logs.flatMap(log => log.mock.calls))).not.toContain(secret);
  await removeKey(api.store, "openai");
  await expect(readKey(api.store, "openai")).rejects.toThrow("Connect this provider");
});
