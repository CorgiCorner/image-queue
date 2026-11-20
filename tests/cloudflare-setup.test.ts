import { expect, it } from "vitest";
import {
  accessApplication, accountFromWhoami, claudeCallbacks, deploymentConfig, parseOptions, pendingMigrations, workerSecrets,
} from "../scripts/cloudflare-setup-plan";

it("parses and validates setup options", () => {
  expect(parseOptions(["--domain", "App.Example.com", "--email", "A@example.com,b@example.com", "--email", "a@example.com"]))
    .toEqual({ domain: "app.example.com", emails: ["a@example.com", "b@example.com"], skipAccess: false, skipDeploy: false, skipBuild: false });
  expect(parseOptions(["--domain", "app.example.com", "--skip-access"], { CLOUDFLARE_ACCOUNT_ID: "0".repeat(32) }))
    .toMatchObject({ emails: [], skipAccess: true, accountId: "0".repeat(32) });
  for (const [argv, message] of [
    [["--domain", "https://app.example.com", "--email", "a@example.com"], /host name/],
    [["--domain", "app.example.com/api", "--email", "a@example.com"], /host name/],
    [["--domain", "app.example.com"], /--email is required/],
    [["--domain", "app.example.com", "--email", "not-an-address"], /Not an e-mail/],
    [["--domain", "app.example.com", "--email", "a@example.com", "--account-id", "abc"], /32-character/],
    [["--domain"], /needs a value/],
    [["--domain", "app.example.com", "--force"], /Unknown option/],
  ] as const) expect(() => parseOptions(argv)).toThrow(message);
});

it("reads the single account from wrangler whoami and refuses to guess between several", () => {
  const id = "0123456789abcdef0123456789abcdef";
  expect(accountFromWhoami(`│ Someone's Account │ ${id} │`)).toBe(id);
  expect(() => accountFromWhoami(`${id}\n${"a".repeat(32)}`)).toThrow(/--account-id/);
  expect(() => accountFromWhoami("You are not authenticated")).toThrow(/wrangler login/);
});

it("adds the D1 ID and the custom domain without changing the rest of the configuration", () => {
  const base = {
    name: "image-queue",
    d1_databases: [{ binding: "DB", database_name: "image-queue", database_id: "local-image-queue" }],
    queues: { producers: [] },
    workers_dev: true,
  };
  const id = "6f1c2a8e-0b4d-4c55-9a1e-3f2b7d9e0c11";
  expect(deploymentConfig(base, id, "app.example.com")).toEqual({
    ...base,
    d1_databases: [{ binding: "DB", database_name: "image-queue", database_id: id }],
    routes: [{ pattern: "app.example.com", custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
  });
  expect(base.d1_databases[0]!.database_id).toBe("local-image-queue");
  expect(() => deploymentConfig(base, "local-image-queue", "app.example.com")).toThrow(/D1/);
});

it("applies only unrecorded migration files, in order", () => {
  expect(pendingMigrations(["0002.sql", "README.md", "0001.sql", "0003_add_index.sql"], ["0001.sql"]))
    .toEqual(["0002.sql", "0003_add_index.sql"]);
  expect(pendingMigrations(["0001.sql"], ["0001.sql"])).toEqual([]);
});

it("protects the whole domain with one allow policy and Managed OAuth for Claude, Claude Code and Codex", () => {
  const application = accessApplication("app.example.com", ["a@example.com"], "pin-id");
  expect(application).toMatchObject({
    type: "self_hosted",
    domain: "app.example.com",
    allowed_idps: ["pin-id"],
    policies: [{ decision: "allow", include: [{ email: { email: "a@example.com" } }] }],
    oauth_configuration: {
      enabled: true,
      dynamic_client_registration: { enabled: true, allowed_uris: claudeCallbacks, allow_any_on_localhost: true, allow_any_on_loopback: true },
    },
  });
  expect(claudeCallbacks).toEqual(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
  expect(JSON.stringify(application)).not.toMatch(/everyone|any_valid_service_token|"ip"/);
});

it("sets the provider key only when one is given", () => {
  const base = { teamDomain: "team.cloudflareaccess.com", audience: "aud", emails: ["a@example.com", "b@example.com"] };
  expect(workerSecrets(base)).toEqual({
    IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    IMAGE_QUEUE_CF_ACCESS_AUDIENCE: "aud",
    IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS: "a@example.com,b@example.com",
  });
  expect(workerSecrets({ ...base, openAiKey: "sk-test" })).toHaveProperty("IMAGE_QUEUE_OPENAI_API_KEY", "sk-test");
});
