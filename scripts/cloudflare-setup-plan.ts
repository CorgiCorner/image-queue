/** Pure parts of `pnpm cloudflare:setup`, kept separate so they can be tested without Cloudflare. */

export const claudeCallbacks = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];
export const applicationName = "image-queue";

export type SetupOptions = {
  domain: string;
  emails: string[];
  accountId?: string;
  skipAccess: boolean;
  skipDeploy: boolean;
  skipBuild: boolean;
};

const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const email = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parseOptions(argv: readonly string[], env: Record<string, string | undefined> = {}): SetupOptions {
  const options: SetupOptions = { domain: "", emails: [], skipAccess: false, skipDeploy: false, skipBuild: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === "--domain") options.domain = value().trim().toLowerCase();
    else if (argument === "--email") options.emails.push(...value().split(",").map(item => item.trim().toLowerCase()).filter(Boolean));
    else if (argument === "--account-id") options.accountId = value().trim();
    else if (argument === "--skip-access") options.skipAccess = true;
    else if (argument === "--skip-deploy") options.skipDeploy = true;
    else if (argument === "--skip-build") options.skipBuild = true;
    else throw new Error(`Unknown option ${argument}`);
  }
  options.accountId ??= env.CLOUDFLARE_ACCOUNT_ID;
  if (!hostname.test(options.domain)) throw new Error("--domain must be a host name such as app.example.com, without a scheme or path");
  if (!options.skipAccess && options.emails.length === 0) throw new Error("--email is required to set up Cloudflare Access");
  const invalid = options.emails.find(item => !email.test(item));
  if (invalid) throw new Error(`Not an e-mail address: ${invalid}`);
  if (options.accountId !== undefined && !/^[0-9a-f]{32}$/.test(options.accountId)) throw new Error("--account-id must be a 32-character Cloudflare account ID");
  options.emails = [...new Set(options.emails)];
  return options;
}

/** The only account ID in `wrangler whoami` output; several accounts need --account-id. */
export function accountFromWhoami(output: string) {
  const ids = [...new Set(output.match(/\b[0-9a-f]{32}\b/g) ?? [])];
  if (ids.length === 1) return ids[0]!;
  throw new Error(ids.length === 0
    ? "Run `pnpm exec wrangler login` first"
    : "Several Cloudflare accounts are available. Pass --account-id.");
}

type WranglerConfig = {
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  routes?: unknown[];
  workers_dev?: boolean;
  preview_urls?: boolean;
  [key: string]: unknown;
};

/** Deployment configuration: the repository's wrangler.jsonc with the real D1 ID and the custom domain. */
export function deploymentConfig(base: WranglerConfig, databaseId: string, domain: string): WranglerConfig {
  if (!/^[0-9a-f-]{36}$/.test(databaseId)) throw new Error("Unexpected D1 database ID");
  return {
    ...base,
    d1_databases: (base.d1_databases ?? []).map(database =>
      database.binding === "DB" ? { ...database, database_id: databaseId } : database),
    routes: [{ pattern: domain, custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
  };
}

/** Migration files not yet recorded, in order. */
export function pendingMigrations(files: readonly string[], applied: readonly string[]) {
  const done = new Set(applied);
  return files.filter(name => /^\d{4}[\w-]*\.sql$/.test(name) && !done.has(name)).sort();
}

/** The self-hosted Access application, with Managed OAuth for MCP clients. */
export function accessApplication(domain: string, emails: readonly string[], identityProviderId: string) {
  return {
    type: "self_hosted",
    name: applicationName,
    domain,
    session_duration: "24h",
    allowed_idps: [identityProviderId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [{
      name: "image-queue owners",
      decision: "allow",
      include: emails.map(address => ({ email: { email: address } })),
    }],
    oauth_configuration: {
      enabled: true,
      dynamic_client_registration: {
        enabled: true,
        allowed_uris: claudeCallbacks,
        // Claude Code and Codex receive the sign-in on a local port.
        allow_any_on_localhost: true,
        allow_any_on_loopback: true,
      },
      grant: { access_token_lifetime: "15m", session_duration: "336h" },
    },
  };
}

/** Values the Worker needs; never printed. */
export function workerSecrets(input: { teamDomain: string; audience: string; emails: readonly string[]; openAiKey?: string }) {
  return {
    IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN: input.teamDomain,
    IMAGE_QUEUE_CF_ACCESS_AUDIENCE: input.audience,
    IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS: input.emails.join(","),
    ...(input.openAiKey ? { IMAGE_QUEUE_OPENAI_API_KEY: input.openAiKey } : {}),
  };
}
