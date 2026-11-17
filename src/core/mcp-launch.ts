import path from "node:path";
import { configuration } from "./config";
import type { PathSettings } from "./paths";
import type { McpLaunch } from "./mcp-configuration";

/** Match the running panel's local workspace without exporting any credential values. */
export function localMcpLaunch(paths: PathSettings, node = process.execPath): McpLaunch {
  const root = process.cwd();
  const env: Record<string, string> = {
    IMAGE_QUEUE_STORAGE_DRIVER: "disk",
    IMAGE_QUEUE_STORAGE_DIR: path.resolve(configuration("STORAGE_DIR") ?? path.join(root, "storage")),
    IMAGE_QUEUE_QUEUE_DIR: path.resolve(paths.queueDirectory),
    IMAGE_QUEUE_REFERENCE_ROOTS: paths.referenceDirectories.map(directory => path.resolve(directory)).join(path.delimiter),
  };
  if (configuration("EXECUTOR") === "scheduled") env.IMAGE_QUEUE_EXECUTOR = "scheduled";
  const credentials = configuration("CREDENTIALS_DIR");
  // An absent/empty override keeps macOS keychain mode; do not replace it with a directory.
  if (credentials !== undefined) env.IMAGE_QUEUE_CREDENTIALS_DIR = credentials ? path.resolve(credentials) : "";
  const dashboard = configuration("DASHBOARD_URL");
  if (dashboard) {
    try {
      const url = new URL(dashboard);
      if (["http:", "https:"].includes(url.protocol)) env.IMAGE_QUEUE_DASHBOARD_URL = url.origin;
    } catch { /* The browser supplies its own origin when no valid URL is configured. */ }
  }
  return { command: node, args: [path.join(root, "dist", "mcp.mjs")], env };
}
