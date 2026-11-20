import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "./.open-next/worker.js": fileURLToPath(new URL("./tests/generated-worker-stub.ts", import.meta.url)),
    "./.open-next/cloudflare/init.js": fileURLToPath(new URL("./tests/generated-init-stub.ts", import.meta.url)),
  } },
  test: {
    maxWorkers: 4,
    setupFiles: ["./tests/network-guard.ts"],
    pool: "threads",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // The build embeds third-party bundles as string literals. View source remains covered.
        "src/mcp/views/*-html.ts",
      ],
      reporter: ["text", "json-summary", "json"],
      thresholds: { lines: 90, branches: 84 },
    },
  },
});
