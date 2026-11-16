import { expect, it } from "vitest";
import { mcpConfigurations } from "../src/core/mcp-configuration";

it("copies an absolute node and server path without requiring a global executable", () => {
  const config = { command: '/runtime/Node 24/node', args: ['/workspace/quoted "folder"/dist/mcp.mjs'] };
  const [codex, claude] = mcpConfigurations(config);
  expect(codex.value).toContain(`command = ${JSON.stringify(config.command)}`);
  expect(codex.value).toContain(`args = ${JSON.stringify(config.args)}`);
  expect(JSON.parse(claude.value).mcpServers['image-queue']).toEqual(config);
});
it("serializes workspace environment in both client formats without copying secrets", () => {
  const [codex, claude] = mcpConfigurations({command:"node",args:["/app/dist/mcp.mjs"],env:{
    IMAGE_QUEUE_STORAGE_DIR:'/workspace/quoted "folder"',
    IMAGE_QUEUE_CREDENTIALS_DIR:"",
    OPENAI_API_KEY:"private-provider-value",
    IMAGE_QUEUE_SETTINGS_SECRET:"private-settings-value",
    IMAGE_QUEUE_MCP_TOKEN:"private-http-value",
  }}, "http://127.0.0.1:3391/some-page?token=private-link-value");
  const env=JSON.parse(claude.value).mcpServers['image-queue'].env;
  expect(env).toEqual({IMAGE_QUEUE_STORAGE_DIR:'/workspace/quoted "folder"',IMAGE_QUEUE_CREDENTIALS_DIR:"",IMAGE_QUEUE_DASHBOARD_URL:"http://127.0.0.1:3391"});
  expect(codex.value).toContain(`${JSON.stringify("IMAGE_QUEUE_STORAGE_DIR")} = ${JSON.stringify(env.IMAGE_QUEUE_STORAGE_DIR)}`);
  for(const format of [codex.value,claude.value]) expect(format).not.toMatch(/private-(provider|settings|http|link)-value/);
});
