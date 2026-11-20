// Local acceptance for the Cloudflare deployment, in the real workerd runtime.
//
// Runs the bundle that `wrangler deploy` would upload with local D1, R2 and
// Queues, and routes every outbound request to a stub: a synthetic Cloudflare
// Access key set and a fake OpenAI image endpoint. No network request leaves
// the machine and no provider is charged.
//
//   pnpm build:cloudflare
//   pnpm exec wrangler deploy --dry-run --outdir .wrangler/acceptance
//   node scripts/cloudflare-acceptance.mjs
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import sharp from "sharp";

const require = createRequire(require_resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
function require_resolve(name) {
  return createRequire(import.meta.url).resolve(name);
}

const team = "acceptance.cloudflareaccess.com";
const audience = "acceptance-audience";
const owner = "owner@example.com";
const providerKey = "sk-acceptance-stub-key";

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...await exportJWK(publicKey), kid: "acceptance", alg: "RS256" }] };
const foreign = await generateKeyPair("RS256");
const sign = ({ email = owner, key = privateKey, aud = audience } = {}) =>
  new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "acceptance" })
    .setIssuer(`https://${team}`).setAudience(aud).setExpirationTime("5m").sign(key);
const png = (await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#2563eb" } })
  .png().toBuffer()).toString("base64");

const stub = `
const calls = [];
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "stub.invalid" && url.pathname === "/calls") return Response.json(calls);
    calls.push({ method: request.method, url: url.href, authorization: request.headers.get("authorization") });
    if (url.href === "https://${team}/cdn-cgi/access/certs") return Response.json(${JSON.stringify(jwks)});
    if (url.href === "https://api.openai.com/v1/images/generations" && request.method === "POST") {
      calls.at(-1).body = await request.json();
      return Response.json({ created: 1, data: [{ b64_json: "${png}" }],
        usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } });
    }
    return new Response("blocked outbound request", { status: 599 });
  },
};`;

const mf = new Miniflare(convertV4MiniflareOptions({
  workers: [
    {
      name: "image-queue",
      modules: true,
      scriptPath: ".wrangler/acceptance/cloudflare-worker.js",
      compatibilityDate: "2026-11-14",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        IMAGE_QUEUE_STORAGE_DRIVER: "cloudflare",
        IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN: team,
        IMAGE_QUEUE_CF_ACCESS_AUDIENCE: audience,
        IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS: owner,
        IMAGE_QUEUE_OPENAI_API_KEY: providerKey,
      },
      d1Databases: { DB: "acceptance" },
      r2Buckets: { BLOBS: "acceptance" },
      queueProducers: { GENERATION_QUEUE: "image-queue-generation" },
      queueConsumers: { "image-queue-generation": { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 0 } },
      assets: { directory: ".open-next/assets", binding: "ASSETS", routerConfig: { has_user_worker: true } },
      images: { binding: "IMAGES" },
      outboundService: "stub",
    },
    { name: "stub", modules: true, script: stub },
  ],
}));

const results = [];
const check = async (name, work) => {
  await work();
  results.push(name);
  console.log(`ok - ${name}`);
};

try {
  const db = await mf.getD1Database("DB");
  for (const migration of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort())
    for (const statement of (await readFile(`migrations/${migration}`, "utf8")).split(";").map(s => s.trim()).filter(Boolean))
      await db.prepare(statement).run();
  await db.prepare("INSERT INTO records(collection,id,value) VALUES(?,?,?)").bind("models", "openai", JSON.stringify([
    { id: "gpt-image-1.5", name: "GPT Image 1.5", provider: "openai", references: true, transparency: true },
  ])).run();

  const base = "https://images.example.com";
  let id = 0;
  const mcp = async (method, params, headers) => {
    const response = await mf.dispatchFetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }),
    });
    return response;
  };
  const access = { "cf-access-jwt-assertion": await sign() };
  const call = async (name, args) => {
    const response = await mcp("tools/call", { name, arguments: args }, access);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(!body.error && !body.result.isError, JSON.stringify(body));
    return JSON.parse(body.result.content[0].text);
  };

  await check("MCP rejects a request without credentials (401)", async () => {
    const response = await mcp("tools/list", undefined, {});
    if (response.status !== 401) console.log("DEBUG", response.status, [...response.headers], (await response.text()).slice(0, 400));
    assert.equal(response.status, 401);
  });
  await check("MCP rejects a static bearer token, a forged assertion and another audience (401)", async () => {
    for (const headers of [
      { authorization: "Bearer anything" },
      { "cf-access-jwt-assertion": await sign({ key: foreign.privateKey }) },
      { "cf-access-jwt-assertion": await sign({ aud: "another-app" }) },
    ]) assert.equal((await mcp("tools/list", undefined, headers)).status, 401);
  });
  await check("MCP refuses a signed-in e-mail outside the allowlist (403)", async () => {
    const headers = { "cf-access-jwt-assertion": await sign({ email: "intruder@example.com" }) };
    assert.equal((await mcp("tools/list", undefined, headers)).status, 403);
  });
  await check("panel rejects a browser without an Access session (403)", async () => {
    const response = await mf.dispatchFetch(`${base}/api/state`);
    assert.equal(response.status, 403);
  });
  await check("MCP initialize and tools/list work with an allowlisted Access identity", async () => {
    const initialize = await mcp("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "acceptance", version: "1.0" },
    }, access);
    assert.equal(initialize.status, 200);
    const tools = await (await mcp("tools/list", undefined, access)).json();
    const names = tools.result.tools.map(tool => tool.name);
    for (const name of ["request_image", "get_job", "wait_for_job", "view_image", "list_models", "refresh_models", "create_project"])
      assert.ok(names.includes(name), `missing ${name}`);
  });
  await check("panel state answers an allowlisted Access identity", async () => {
    const response = await mf.dispatchFetch(`${base}/api/state`, { headers: access });
    assert.equal(response.status, 200);
  });

  let job;
  await check("request_image returns at once and the generation queue completes the image", async () => {
    const project = await call("create_project", { name: "Remote acceptance" });
    const started = Date.now();
    job = await call("request_image", {
      projectId: project.id, source: "api", provider: "openai", model: "gpt-image-1.5",
      prompt: "A blue square", width: 1024, height: 1024, idempotencyKey: "remote-acceptance-1",
    });
    assert.equal(job.status, "queued");
    console.log(`  request_image answered in ${Date.now() - started} ms with status ${job.status}`);
    for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(job.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await call("get_job", { id: job.id });
    }
    assert.equal(job.status, "done", JSON.stringify(job));
    assert.ok(job.blobKey, "no stored result");
    const bucket = await mf.getR2Bucket("BLOBS");
    const stored = await bucket.get(job.blobKey);
    assert.ok(stored && (await stored.arrayBuffer()).byteLength > 1000, "result missing in R2");
  });
  await check("view_image returns the finished image as inline image content", async () => {
    const response = await mcp("tools/call", { name: "view_image", arguments: { id: job.id } }, access);
    const body = await response.json();
    assert.ok(!body.error && !body.result.isError, JSON.stringify(body).slice(0, 400));
    const [image] = body.result.content;
    assert.equal(image.type, "image");
    assert.match(image.mimeType, /^image\//);
    assert.ok(Buffer.from(image.data, "base64").byteLength > 100);
  });
  await check("a request without source defaults to the API on Cloudflare", async () => {
    const queued = await call("request_image", {
      projectId: job.projectId, prompt: "A green circle", width: 1024, height: 1024, idempotencyKey: "remote-acceptance-default",
    });
    assert.equal(queued.source, "api");
    assert.equal(queued.model, "gpt-image-1.5");
    let current = queued;
    for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(current.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      current = await call("get_job", { id: queued.id });
    }
    assert.equal(current.status, "done", JSON.stringify(current));
  });
  await check("one provider call per image, authorized with the platform-secret key", async () => {
    const calls = await (await (await mf.getWorker("stub")).fetch("https://stub.invalid/calls")).json();
    const generations = calls.filter(entry => entry.url === "https://api.openai.com/v1/images/generations");
    assert.equal(generations.length, 2);
    assert.equal(generations[0].authorization, `Bearer ${providerKey}`);
    assert.equal(generations[0].body.prompt, "A blue square");
    const blocked = calls.filter(entry => !entry.url.startsWith(`https://${team}/`) && !entry.url.startsWith("https://api.openai.com/"));
    assert.deepEqual(blocked, [], "unexpected outbound requests");
  });
  await check("a replayed idempotency key returns the same job without a second provider call", async () => {
    const replay = await call("request_image", {
      projectId: job.projectId, source: "api", provider: "openai", model: "gpt-image-1.5",
      prompt: "A blue square", width: 1024, height: 1024, idempotencyKey: "remote-acceptance-1",
    });
    assert.equal(replay.id, job.id);
    const calls = await (await (await mf.getWorker("stub")).fetch("https://stub.invalid/calls")).json();
    assert.equal(calls.filter(entry => entry.url.endsWith("/v1/images/generations")).length, 2);
  });
  console.log(`\n${results.length} checks passed`);
} finally {
  await mf.dispose();
}
