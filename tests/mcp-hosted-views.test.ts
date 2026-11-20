import { GALLERY_VIEW_URI, IMAGE_VIEW_URI, JOB_VIEW_URI } from "../src/mcp/apps";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer } from "../src/mcp/server";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mcp-hosted-"));
  process.env.STORAGE_DIR = path.join(root, "store");
  process.env.CODEX_QUEUE_DIR = path.join(root, "queue");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.STORAGE_DIR;
  delete process.env.CODEX_QUEUE_DIR;
});

async function tools(appViews?: "always") {
  const server = createServer(appViews ? { appViews } : undefined);
  // A client without the MCP Apps extension, like a stateless request after initialize.
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const listed = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources.map(resource => resource.uri);
  await client.close();
  await server.close();
  return { listed, resources };
}

it("lists the MCP Apps views on a stateless hosted server without negotiation", async () => {
  const { listed, resources } = await tools("always");
  const byName = Object.fromEntries(listed.map(tool => [tool.name, tool]));
  expect(byName.request_image?._meta).toMatchObject({ ui: { resourceUri: JOB_VIEW_URI } });
  expect(byName.show_image?._meta).toMatchObject({ ui: { resourceUri: IMAGE_VIEW_URI } });
  expect(byName.show_images?._meta).toMatchObject({ ui: { resourceUri: GALLERY_VIEW_URI } });
  expect(resources).toEqual(expect.arrayContaining([JOB_VIEW_URI, IMAGE_VIEW_URI, GALLERY_VIEW_URI]));
});

it("keeps views off for a host that does not advertise MCP Apps", async () => {
  const { listed } = await tools();
  expect(listed.find(tool => tool.name === "request_image")?._meta?.ui).toBeUndefined();
});

it("marks reading tools read-only and billing or cancelling tools as such", async () => {
  const { listed } = await tools("always");
  const hints = Object.fromEntries(listed.map(tool => [tool.name, tool.annotations]));
  for (const name of ["list_models", "wait_for_job", "get_job", "show_job", "list_projects", "view_image", "get_job_state"])
    expect(hints[name], name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const name of ["request_image", "retry_image", "create_project", "set_generation_source"])
    expect(hints[name], name).toMatchObject({ readOnlyHint: false });
  expect(hints.request_image).toMatchObject({ openWorldHint: true, destructiveHint: false });
  expect(hints.cancel_job).toMatchObject({ destructiveHint: true });
  // Every listed tool carries an explicit hint.
  for (const tool of listed) expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf("boolean");
});

it("gives each view an address that changes with its content, so hosts do not show a cached old view", async () => {
  const { jobViewHtml, jobViewVersion } = await import("../src/mcp/views/job-html");
  const { createHash } = await import("node:crypto");
  expect(jobViewVersion).toBe(createHash("sha256").update(jobViewHtml).digest("hex").slice(0, 10));
  expect(JOB_VIEW_URI).toBe(`ui://image-queue/job-${jobViewVersion}`);
  for (const uri of [GALLERY_VIEW_URI, IMAGE_VIEW_URI]) expect(uri).toMatch(/^ui:\/\/image-queue\/[a-z]+-[0-9a-f]{10}$/);
});

it("links the hosted request view to the deployment that served it, not the local default", async () => {
  const server = createServer({ appViews: "always", panelUrl: "https://app.example.com" });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const view = await client.readResource({ uri: JOB_VIEW_URI });
  await client.close();
  await server.close();
  const html = "text" in view.contents[0] ? view.contents[0].text : "";
  expect(html).toContain(`data-dashboard="${encodeURIComponent("https://app.example.com")}"`);
  expect(html).not.toContain("127.0.0.1");
});
