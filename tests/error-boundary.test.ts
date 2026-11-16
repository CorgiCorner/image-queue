import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { UserFacingError, publicErrorMessage } from "../src/core/user-facing-error";
import { protectToolErrors } from "../src/mcp/error-boundary";

it("only exposes explicitly public errors", () => {
  expect(publicErrorMessage(new Error("Authorization: Bearer private-fixture"))).not.toContain("private-fixture");
  expect(publicErrorMessage(new UserFacingError("Project does not exist"))).toBe("Project does not exist");
});

it("protects MCP handlers registered before and after connection", async () => {
  const server = new McpServer({ name: "boundary", version: "1" });
  protectToolErrors(server);
  server.registerTool("private_failure", {}, async () => { throw new Error("Authorization: Bearer private-fixture"); });
  server.registerResource("private-resource", "test://private", {}, async () => { throw new Error("Authorization: Bearer private-fixture"); });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  server.registerTool("public_failure", {}, async () => { throw new UserFacingError("Project does not exist"); });
  try {
    const hidden = await client.callTool({ name: "private_failure", arguments: {} });
    expect(hidden.isError).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain("private-fixture");
    const visible = await client.callTool({ name: "public_failure", arguments: {} });
    expect(visible.isError).toBe(true);
    expect(JSON.stringify(visible)).toContain("Project does not exist");
    await expect(client.readResource({ uri: "test://private" })).rejects.toThrow("The operation could not be completed");
    try { await client.readResource({ uri: "test://private" }); }
    catch (error) { expect(String(error)).not.toContain("private-fixture"); }
  } finally { await client.close(); await server.close(); }
});
