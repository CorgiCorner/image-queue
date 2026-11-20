export type McpLaunch = { command: string; args: string[]; env?: Record<string, string> };
const environmentKeys = [
  "IMAGE_QUEUE_STORAGE_DRIVER", "IMAGE_QUEUE_STORAGE_DIR", "IMAGE_QUEUE_QUEUE_DIR",
  "IMAGE_QUEUE_REFERENCE_ROOTS", "IMAGE_QUEUE_CREDENTIALS_DIR", "IMAGE_QUEUE_DASHBOARD_URL", "IMAGE_QUEUE_EXECUTOR",
];

/** JSON strings are also valid TOML basic strings for these path values. */
export function mcpConfigurations(local?: McpLaunch, dashboardOrigin?: string) {
  const launch = local ?? { command: "node", args: ["/path/to/image-queue/dist/mcp.mjs"] };
  // Never copy provider keys, encryption secrets or HTTP tokens into client config.
  const env = Object.fromEntries(Object.entries(launch.env ?? {}).filter(([key]) => environmentKeys.includes(key)));
  const dashboard = env.IMAGE_QUEUE_DASHBOARD_URL || dashboardOrigin;
  delete env.IMAGE_QUEUE_DASHBOARD_URL;
  if (dashboard) {
    const url = new URL(dashboard);
    if (["http:", "https:"].includes(url.protocol)) env.IMAGE_QUEUE_DASHBOARD_URL = url.origin;
  }
  const config = { command: launch.command, args: launch.args, ...(Object.keys(env).length ? { env } : {}) };
  const environment = Object.keys(env).length
    ? `\nenv = { ${Object.entries(env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(", ")} }`
    : "";
  return [
    { name: "Codex", format: "TOML", value: `[mcp_servers.image_queue]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}${environment}` },
    { name: "Claude Code", format: "JSON", value: JSON.stringify({ mcpServers: { "image-queue": config } }, null, 2) },
  ];
}

/**
 * How each client connects to a hosted deployment's remote MCP endpoint. The
 * endpoint signs clients in through OAuth, so nothing here carries a key.
 */
export function remoteMcpClients(origin: string) {
  const url = `${new URL(origin).origin}/api/mcp`;
  return {
    url,
    clients: [
      {
        name: "Claude",
        steps: [
          "In Claude on the web, desktop or phone, open Settings, then Connectors, then Add custom connector.",
          "Name it image-queue, paste the server URL and leave the advanced OAuth fields empty.",
          "Select Connect and sign in on the page that opens.",
          "In a chat, enable the connector and ask for an image.",
        ],
        note: "One connector serves Claude on the web, desktop and phone.",
        after: "After an update that changes tools, disconnect and connect the connector again, then start a new chat.",
      },
      {
        name: "Claude Code",
        format: "Shell",
        value: `claude mcp add --transport http image-queue ${url}`,
        note: "Run in a terminal. Then run /mcp in Claude Code, select image-queue and authenticate.",
      },
      {
        name: "Codex",
        format: "Shell",
        value: `codex mcp add image-queue --url ${url}\ncodex mcp login image-queue`,
        note: "Run in a terminal. The login command opens the sign-in page in your browser.",
      },
    ],
  };
}
