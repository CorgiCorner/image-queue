import { afterEach, expect, it, vi } from "vitest";
const { start, storage, runner } = vi.hoisted(() => ({ start: vi.fn(() => vi.fn()), storage: vi.fn(), runner: vi.fn(async()=>({stop:vi.fn()})) }));
vi.mock("../src/storage/local-runner",()=>({startLocalRunner:runner}));
vi.mock("../src/core/maintenance", () => ({ startTrashMaintenance: start }));
vi.mock("../src/storage", () => ({ storage }));
import { register } from "../src/instrumentation";
const state = globalThis as typeof globalThis & { imageQueueTrashMaintenance?: () => void; imageQueueLocalRunner?: unknown };
afterEach(() => {
  delete state.imageQueueTrashMaintenance;
  delete state.imageQueueLocalRunner;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("starts exactly one local maintenance timer across repeated registration", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "disk");
  await register();
  await register();
  expect(start).toHaveBeenCalledTimes(1);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith(storage, expect.any(Function));
});

it("leaves Cloudflare maintenance to its scheduled handler", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  await register();
  expect(start).not.toHaveBeenCalled();
});

it("does not start local timers in an edge runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  await register();
  expect(start).not.toHaveBeenCalled();
});
