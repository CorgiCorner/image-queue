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
