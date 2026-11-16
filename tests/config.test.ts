import { afterEach, expect, it, vi } from "vitest";
import { configuration } from "../src/core/config";
afterEach(() => vi.unstubAllEnvs());
it("prefers product-prefixed configuration and supports older installations", () => {
  vi.stubEnv("CODEX_QUEUE_DIR", "/legacy");
  expect(configuration("QUEUE_DIR", "CODEX_QUEUE_DIR")).toBe("/legacy");
  vi.stubEnv("IMAGE_QUEUE_QUEUE_DIR", "/new");
  expect(configuration("QUEUE_DIR", "CODEX_QUEUE_DIR")).toBe("/new");
});
