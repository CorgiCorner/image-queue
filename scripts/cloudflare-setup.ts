// Sets up a private image-queue deployment on Cloudflare, or brings an existing one up to date.
//
//   pnpm cloudflare:setup --domain app.example.com --email you@example.com
//
// Every step can be repeated. Resources and the deployment use your `wrangler login`.
// Cloudflare Access needs an API token with "Access: Apps and Policies Edit" and
// "Access: Organizations, Identity Providers, and Groups Edit"; the script reads it from
// CLOUDFLARE_ACCESS_API_TOKEN or asks for it without echoing. The OpenAI key is read from
// IMAGE_QUEUE_OPENAI_API_KEY or asked for the same way. Neither is printed or written to disk.
import { execFile, spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import {
  accessApplication, accountFromWhoami, applicationName, claudeCallbacks, deploymentConfig, parseOptions,
  pendingMigrations, workerSecrets, type SetupOptions,
} from "./cloudflare-setup-plan";

const run = promisify(execFile);
const wranglerBin = "node_modules/.bin/wrangler";
const deployConfigPath = "wrangler.deploy.jsonc";
const names = { database: "image-queue", bucket: "image-queue", queue: "image-queue-generation" };

const step = (text: string) => console.log(`\n▸ ${text}`);

async function wrangler(args: string[], input?: string) {
  if (input === undefined) {
    const { stdout } = await run(wranglerBin, args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(wranglerBin, args, { stdio: ["pipe", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`wrangler ${args[0]} ${args[1] ?? ""} failed`)));
    child.stdin.end(input);
  });
}

/** Runs a create command and treats "already exists" as success. */
async function ensure(label: string, args: string[]) {
  try {
    await wrangler(args);
    console.log(`  created ${label}`);
  } catch (error) {
    const text = String((error as { stderr?: string; stdout?: string }).stderr ?? "") +
      String((error as { stdout?: string }).stdout ?? "");
    if (!/already exists|already taken|already own/i.test(text)) throw new Error(`Could not create ${label}: ${text.trim().split("\n").at(-1)}`);
    console.log(`  ${label} already exists`);
  }
}

async function hiddenPrompt(question: string) {
  if (!process.stdin.isTTY) return undefined;
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise<string>(resolve => {
    reader.question(question, answer => {
      reader.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function cloudflare<T>(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!response.ok || !body.success) {
    const reason = body.errors?.map(error => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API ${init.method ?? "GET"} ${path.replace(/[0-9a-f]{32}/g, "<account>")}: ${reason}`);
  }
  return body.result as T;
}

async function resourcesAndDeployment(options: SetupOptions) {
  step("Resources");
  const databases = JSON.parse(await wrangler(["d1", "list", "--json"])) as { name: string; uuid: string }[];
  let database = databases.find(entry => entry.name === names.database);
  if (!database) {
    await wrangler(["d1", "create", names.database, "--no-update-config"]);
    database = (JSON.parse(await wrangler(["d1", "list", "--json"])) as { name: string; uuid: string }[])
      .find(entry => entry.name === names.database);
    if (!database) throw new Error("The D1 database was not created");
    console.log(`  created D1 ${names.database}`);
  } else console.log(`  D1 ${names.database} already exists`);
  await ensure(`R2 bucket ${names.bucket}`, ["r2", "bucket", "create", names.bucket]);
  await ensure(`queue ${names.queue}`, ["queues", "create", names.queue]);

  step("Deployment configuration");
  const base = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  await writeFile(deployConfigPath, `${JSON.stringify(deploymentConfig(base, database.uuid, options.domain), null, 2)}\n`);
  console.log(`  wrote ${deployConfigPath} (not committed)`);

  step("Database migrations");
  const tracking = "CREATE TABLE IF NOT EXISTS image_queue_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";
  await wrangler(["d1", "execute", names.database, "--remote", "-y", "-c", deployConfigPath, "--command", tracking]);
  const appliedOutput = JSON.parse(await wrangler(["d1", "execute", names.database, "--remote", "-y", "-c", deployConfigPath,
    "--json", "--command", "SELECT name FROM image_queue_migrations"])) as { results: { name: string }[] }[];
  const applied = appliedOutput.flatMap(entry => entry.results.map(row => row.name));
  const pending = pendingMigrations(await readdir("migrations"), applied);
  for (const migration of pending) {
    await wrangler(["d1", "execute", names.database, "--remote", "-y", "-c", deployConfigPath, "--file", `migrations/${migration}`]);
    await wrangler(["d1", "execute", names.database, "--remote", "-y", "-c", deployConfigPath, "--command",
      `INSERT INTO image_queue_migrations(name, applied_at) VALUES('${migration}', datetime('now'))`]);
    console.log(`  applied ${migration}`);
  }
  if (pending.length === 0) console.log("  up to date");

  if (!options.skipBuild) {
    step("Build");
    await run("pnpm", ["build:cloudflare"], { maxBuffer: 256 * 1024 * 1024 });
    console.log("  built");
  }
  step("Deploy");
  await wrangler(["deploy", "-c", deployConfigPath]);
  console.log(`  deployed to https://${options.domain}`);
}

async function access(options: SetupOptions, accountId: string) {
  step("Cloudflare Access");
  const token = process.env.CLOUDFLARE_ACCESS_API_TOKEN ?? await hiddenPrompt("  Cloudflare API token for Access (input hidden): ");
  if (!token) throw new Error("Set CLOUDFLARE_ACCESS_API_TOKEN or run in a terminal to enter it");
  const account = `/accounts/${accountId}/access`;
  const organization = await cloudflare<{ auth_domain?: string }>(token, `${account}/organizations`).catch(() => {
    throw new Error("No Zero Trust organization. Open https://one.dash.cloudflare.com/, choose a team name and the Free plan, then run this again.");
  });
  if (!organization.auth_domain) throw new Error("The Zero Trust organization has no team domain yet");

  const providers = await cloudflare<{ id: string; type: string }[]>(token, `${account}/identity_providers`);
  let pin = providers.find(provider => provider.type === "onetimepin");
  if (!pin) {
    pin = await cloudflare<{ id: string; type: string }>(token, `${account}/identity_providers`, {
      method: "POST", body: JSON.stringify({ type: "onetimepin", name: "One-time PIN", config: {} }),
    });
    console.log("  added the One-time PIN login method");
  }

  const body = JSON.stringify(accessApplication(options.domain, options.emails, pin.id));
  const applications = await cloudflare<{ id: string; domain: string; name: string }[]>(token, `${account}/apps`);
  const existing = applications.find(app => app.domain === options.domain);
  if (existing && existing.name !== applicationName)
    throw new Error(`An Access application named "${existing.name}" already covers ${options.domain}. Rename or remove it first.`);
  const application = await (existing
    ? cloudflare<{ aud: string }>(token, `${account}/apps/${existing.id}`, { method: "PUT", body })
    : cloudflare<{ aud: string }>(token, `${account}/apps`, { method: "POST", body })
  ).catch(error => {
    throw new Error(`${error instanceof Error ? error.message : error}. If the Zero Trust organization has no plan yet, choose Zero Trust Free under Zero Trust → Settings → Plan and run this again.`);
  });
  console.log(`  ${existing ? "updated" : "created"} the Access application with Managed OAuth`);
  console.log(`  redirect allowlist: ${claudeCallbacks.join(", ")}, plus localhost and loopback`);
  return { teamDomain: organization.auth_domain, audience: application.aud };
}

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  const accountId = options.accountId ?? accountFromWhoami(await wrangler(["whoami"]));
  if (!options.skipDeploy) await resourcesAndDeployment(options);
  else await readFile(deployConfigPath, "utf8").catch(() => {
    throw new Error(`${deployConfigPath} is missing; run once without --skip-deploy`);
  });

  if (options.skipAccess) {
    console.log("\nSkipped Cloudflare Access. Until it is set up, the deployment rejects every request.");
    return;
  }
  const accessValues = await access(options, accountId);
  const openAiKey = process.env.IMAGE_QUEUE_OPENAI_API_KEY ??
    await hiddenPrompt("  OpenAI API key for this deployment (input hidden, empty to keep the current one): ");

  step("Worker secrets");
  const secrets = workerSecrets({ ...accessValues, emails: options.emails, openAiKey: openAiKey || undefined });
  await wrangler(["secret", "bulk", "-c", deployConfigPath], JSON.stringify(secrets));
  console.log(`  set ${Object.keys(secrets).join(", ")}`);

  console.log(`
Done. Add this URL as a custom connector in Claude, or with Claude Code or Codex:
  https://${options.domain}/api/mcp
After connecting, ask the client to run refresh_models once to load the image models your key can use.`);
}

main().catch(error => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
