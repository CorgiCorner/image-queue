import { afterEach, expect, it, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn(async (_transport: unknown) => {}) }));
vi.mock("../src/mcp/server", () => ({ createServer: () => ({ connect }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  connect.mockReset();
  process.exitCode = 0;
});

it.each([undefined, "ENOENT"])("starts stdio when loading .env.local yields %s", async (code) => {
  const chdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
  const load = vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
    if (code) throw Object.assign(new Error("Missing env file"), { code });
  });
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");

  await import("../src/mcp/stdio");

  expect(chdir).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith(".env.local");
  expect(connect).toHaveBeenCalledOnce();
  expect(connect.mock.calls[0][0]).toBeInstanceOf(StdioServerTransport);
});

it("reports an unreadable env file without exposing its exception", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "chdir").mockImplementation(() => {});
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
    throw Object.assign(new Error("secret-test-value /private/folder"), { code: "EACCES" });
  });

  await import("../src/mcp/stdio");
  expect(process.exitCode).toBe(1);
  expect(stderr).toHaveBeenCalledWith("image-queue could not start. Check configuration and folder permissions.\n");
  expect(JSON.stringify(stderr.mock.calls)).not.toContain("secret-test-value");
  expect(connect).not.toHaveBeenCalled();
});

it("keeps connection failures out of both protocol output and diagnostics", async () => {
  vi.spyOn(process, "chdir").mockImplementation(() => {});
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  const stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  const stdout=vi.spyOn(process.stdout,"write").mockImplementation(()=>true);
  connect.mockRejectedValueOnce(new Error("secret-test-value"));
  await import("../src/mcp/stdio");
  expect(process.exitCode).toBe(1);
  expect(stdout).not.toHaveBeenCalled();
  expect(JSON.stringify(stderr.mock.calls)).not.toContain("secret-test-value");
});

it("sanitizes failures before configuration or module initialization", async () => {
  vi.spyOn(process,"chdir").mockImplementation(()=>{throw new Error("private-startup-secret");});
  const stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  await import("../src/mcp/stdio");
  expect(process.exitCode).toBe(1);
  expect(connect).not.toHaveBeenCalled();
  expect(JSON.stringify(stderr.mock.calls)).not.toContain("private-startup-secret");
});
