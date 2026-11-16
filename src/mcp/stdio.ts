#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

try {
  process.chdir(fileURLToPath(new URL(import.meta.url.endsWith("/dist/mcp.mjs") ? ".." : "../..", import.meta.url)));
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { createServer } = await import("./server");
  await createServer().connect(new StdioServerTransport());
} catch {
  // Startup exceptions can contain credential values or private paths. Keep stdout
  // exclusively for MCP and never serialize the underlying exception to stderr.
  process.stderr.write("image-queue could not start. Check configuration and folder permissions.\n");
  process.exitCode = 1;
}
