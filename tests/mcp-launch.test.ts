import { afterEach, expect, it, vi } from "vitest";
import path from "node:path";
import { localMcpLaunch } from "../src/core/mcp-launch";
afterEach(()=>vi.unstubAllEnvs());
const paths={queueDirectory:"/workspace/custom-queue",referenceDirectories:["/workspace/references","/workspace/project two"]};
it("carries the running workspace and credential-file override without key values",()=>{
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DIR","./custom-store");
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR","./private-credentials");
  vi.stubEnv("IMAGE_QUEUE_OPENAI_API_KEY","must-not-export-this-key");
  vi.stubEnv("IMAGE_QUEUE_MCP_TOKEN","must-not-export-this-token");
  const launch=localMcpLaunch(paths);
  expect(launch.env).toMatchObject({IMAGE_QUEUE_STORAGE_DRIVER:"disk",IMAGE_QUEUE_STORAGE_DIR:path.resolve("./custom-store"),IMAGE_QUEUE_QUEUE_DIR:paths.queueDirectory,IMAGE_QUEUE_REFERENCE_ROOTS:paths.referenceDirectories.join(path.delimiter),IMAGE_QUEUE_CREDENTIALS_DIR:path.resolve("./private-credentials")});
  expect(JSON.stringify(launch)).not.toContain("must-not-export");
});
it("does not switch keychain mode to a credential directory",()=>{
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR",undefined);vi.stubEnv("CREDENTIALS_DIR",undefined);
  expect(localMcpLaunch(paths).env).not.toHaveProperty("IMAGE_QUEUE_CREDENTIALS_DIR");
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR","");
  expect(localMcpLaunch(paths).env?.IMAGE_QUEUE_CREDENTIALS_DIR).toBe("");
});
it("preserves a configured dashboard origin without copying URL credentials or tokens",()=>{
  vi.stubEnv("IMAGE_QUEUE_DASHBOARD_URL","https://user:private-password@images.example/app?token=private-token");
  expect(localMcpLaunch(paths).env?.IMAGE_QUEUE_DASHBOARD_URL).toBe("https://images.example");
  vi.stubEnv("IMAGE_QUEUE_DASHBOARD_URL","invalid");
  expect(localMcpLaunch(paths).env).not.toHaveProperty("IMAGE_QUEUE_DASHBOARD_URL");
});

it("uses an explicitly resolved stable Node executable",()=>{expect(localMcpLaunch(paths,"/opt/homebrew/bin/node").command).toBe("/opt/homebrew/bin/node");});
