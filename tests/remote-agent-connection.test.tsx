// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { remoteMcpClients } from "../src/core/mcp-configuration";

vi.mock("../src/actions", () => ({ openAgentConfigDirectoryAction: vi.fn() }));
import { AgentConnection } from "../src/components/agent-connection";

afterEach(cleanup);

it("builds remote connection steps from the deployment origin, without keys", () => {
  const { url, clients } = remoteMcpClients("https://app.example.com/settings?x=1#agent-connection");
  expect(url).toBe("https://app.example.com/api/mcp");
  expect(clients.map(client => client.name)).toEqual(["Claude", "Claude Code", "Codex"]);
  expect(clients[1].value).toBe("claude mcp add --transport http image-queue https://app.example.com/api/mcp");
  expect(clients[2].value).toBe("codex mcp add image-queue --url https://app.example.com/api/mcp\ncodex mcp login image-queue");
  expect(JSON.stringify(clients)).not.toMatch(/token|secret|sk-/i);
});

it("shows a hosted workspace how to connect Claude and coding agents to its remote MCP server", () => {
  render(<AgentConnection remote dashboardOrigin="https://app.example.com" onNotice={() => {}} />);
  expect(screen.getByRole("region", { name: "Server URL" }).textContent).toBe("https://app.example.com/api/mcp");
  // Claude comes first: numbered steps for the connector, not a local stdio configuration.
  expect(screen.getByRole("list", { name: "Claude steps" }).querySelectorAll("li").length).toBe(4);
  expect(screen.queryByText("pnpm build:mcp")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
  expect(screen.getByRole("region", { name: "Claude Code command" }).textContent)
    .toBe("claude mcp add --transport http image-queue https://app.example.com/api/mcp");
});

it("keeps the local stdio configuration for a local workspace", () => {
  render(<AgentConnection dashboardOrigin="http://127.0.0.1:3215" onNotice={() => {}} />);
  expect(screen.getByText("pnpm build:mcp")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Server URL" })).toBeNull();
});
