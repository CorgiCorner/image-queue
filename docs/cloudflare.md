# Run image-queue on Cloudflare and connect it as a remote MCP server

A Cloudflare deployment gives you your own private image queue on the web. You can request, follow and view images from the Claude apps on the web, desktop and phone, from Claude Code and from Codex, with no computer running at home. Generation uses an image API key that you provide. The Codex file queue stays local-only.

Everything runs in your own Cloudflare account. Nobody else can reach the panel or the MCP endpoint: Cloudflare Access protects every request, and the application also checks the signed Access identity against your list of allowed e-mail addresses. See [ADR-0020](decisions/0020-remote-mcp-behind-cloudflare-access.md) for the design.

## What you need

- A Cloudflare account with a domain (zone) on it. The deployment uses a subdomain, for example `app.example.com`.
- A Workers Paid plan (5 USD per month). The free plan allows 10 ms of CPU time per request, which is not enough for the panel and the MCP server. D1, Queues and the R2 and Images usage of one person fit in the included allowances.
- A Cloudflare Zero Trust organization with an active plan. Zero Trust Free costs nothing and covers up to 50 users, but it has to be chosen once (**Zero Trust → Settings → Plan**); an organization without a plan shows "You need an active plan to continue" and cannot protect applications.
- An OpenAI API key, ideally from a dedicated project, because every image is billed. OpenAI does not offer a spend limit on every project. With prepaid credits and no payment method on the organization, spending stops at the credit balance; with a payment method, set the organization's usage limits.

| Part | What it does |
|-|-|
| Worker on your subdomain | Panel, API and MCP endpoint at `/api/mcp` |
| D1 database `image-queue` | Projects, jobs and settings |
| R2 bucket `image-queue` | Images, references and thumbnails |
| Queue `image-queue-generation` | Runs each API generation outside the request that created it |
| Cloudflare Access application | Sign-in for the panel, and OAuth for MCP clients through Managed OAuth |

## Deploy with one command

1. Sign in to Cloudflare once with `pnpm exec wrangler login`. If your account has no Zero Trust organization yet, or the organization has no plan, open the [Zero Trust dashboard](https://one.dash.cloudflare.com/), choose a team name and the Free plan.
2. Create an API token under **My Profile → API Tokens → Create Custom Token** with two account permissions: **Access: Apps and Policies → Edit** and **Access: Organizations, Identity Providers, and Groups → Edit**. `wrangler login` cannot manage Access.
3. Run:

   ```sh
   pnpm cloudflare:setup --domain app.example.com --email you@example.com
   ```

   The script asks for the API token and the OpenAI key without echoing them, unless `CLOUDFLARE_ACCESS_API_TOKEN` and `IMAGE_QUEUE_OPENAI_API_KEY` are set. Neither value is printed or written to disk. It creates or reuses D1, R2 and the queue, applies new migrations, builds and deploys to the custom domain, creates or updates the Access application with Managed OAuth and a One-time PIN login, and sets the Worker secrets. Run it again after an update; every step is repeatable. A rerun writes the Access application and its policy again, so changes made to them in the dashboard are replaced; use `--skip-access` to keep them. Use `--skip-access` to deploy only, `--skip-deploy` to change only Access and secrets, and `--account-id` when your login has several accounts.

The steps below do the same by hand.

## Deploy by hand

1. Create the resources and apply the migrations:

   ```sh
   pnpm install
   pnpm exec wrangler login
   pnpm exec wrangler d1 create image-queue
   pnpm exec wrangler r2 bucket create image-queue
   pnpm exec wrangler queues create image-queue-generation
   ```

   Put the returned D1 `database_id` into `wrangler.jsonc`, then apply every file in `migrations/` in order:

   ```sh
   pnpm exec wrangler d1 execute image-queue --remote --file migrations/0001.sql
   pnpm exec wrangler d1 execute image-queue --remote --file migrations/0002.sql
   ```

2. Add your subdomain to `wrangler.jsonc` as a custom domain:

   ```jsonc
   "routes": [{ "pattern": "app.example.com", "custom_domain": true }]
   ```

   The Worker is not served on `workers.dev` or preview URLs.

3. Create the Access application in the Zero Trust dashboard, under **Access controls → Applications → Add an application → Self-hosted**:
   - **Domain:** your subdomain, for example `app.example.com`, with no path.
   - **Policy:** Allow, with a rule for the e-mail addresses that may use it.
   - **Login method:** One-time PIN, or an identity provider you already use.
   - **Advanced settings → Managed OAuth:** on. The redirect allowlist starts empty: under **Allowed redirect URIs** add `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`. Keep **Allow localhost clients** and **Allow loopback clients** on for Claude Code and Codex, which receive the sign-in on a local port. **Grant session duration** decides how long a connected client stays signed in; the default equals the application session (24 hours), so set it longer, for example `336h`, if you do not want to enter a new code every day.
   - Copy the application's **Application Audience (AUD) Tag** and your team domain (`<team>.cloudflareaccess.com`).

4. Build, deploy and set the configuration. Deploy first: until the secrets are set, the Worker rejects every request.

   ```sh
   pnpm build:cloudflare
   pnpm exec wrangler deploy
   pnpm exec wrangler secret put IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN
   pnpm exec wrangler secret put IMAGE_QUEUE_CF_ACCESS_AUDIENCE
   pnpm exec wrangler secret put IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS
   pnpm exec wrangler secret put IMAGE_QUEUE_OPENAI_API_KEY
   ```

   `IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS` takes comma-separated addresses. Keep it the same as the Access policy: Access decides who may sign in, and the application refuses any other address with 403.

5. Connect a client (below) and ask it to run `refresh_models`. It lists the image models your key can use, saves them and returns those with a verified size profile; it generates nothing and is not billed. Run it again after OpenAI releases a model.

## Connect an MCP client

The server URL is `https://app.example.com/api/mcp`. The first connection opens the Cloudflare Access sign-in page; after that, the client refreshes its token by itself.

### Claude on the web, desktop and phone

Custom connectors are shared across claude.ai, Claude Desktop and the Claude mobile apps.

1. Open **Settings → Connectors → Add custom connector**. On a Team or Enterprise plan, an owner adds it under organization settings.
2. Enter a name such as `image-queue` and the server URL. Leave the advanced OAuth fields empty; Claude registers itself.
3. Click **Connect** and sign in on the Access page.
4. In a chat, enable the connector and ask for an image, for example: "Use image-queue to make a 1024×1024 image of a lighthouse at dawn with gpt-image-2.6, then show it."

The model calls `request_image`, which returns at once, follows the job with `wait_for_job` or `get_job`, and shows the result with `view_image`. On Cloudflare a request without `source` uses the API and the preferred model from `list_models`; the local Codex queue is not available there. If `list_models` is empty or a model is missing, ask for `refresh_models`.

Claude keeps the tool list it read when the connector was connected. After a deployment that adds or changes tools, disconnect and connect the connector again in **Settings → Connectors**, then start a new chat; otherwise new tools such as `refresh_models` are missing and old descriptions stay in use. The hosted endpoint is stateless and cannot notify Claude of the change.

Reading tools are marked read-only (`readOnlyHint`), so Claude can run them without asking each time. Tools that may bill the API key (`request_image`, `request_images`, `retry_image`, `iterate_image`) and tools that cancel work keep asking until you choose **Always allow** for them.

The inline request view shows a loading placeholder until the preview arrives, and **Download** hands the full-size file to Claude, which saves it on the device.

### Claude Code

```sh
claude mcp add --transport http image-queue https://app.example.com/api/mcp
```

Then run `/mcp` in Claude Code, select `image-queue` and authenticate. This needs **Allow localhost clients** and **Allow loopback clients** in the Access application.

### Codex CLI and the Codex app

The CLI and the desktop app share `~/.codex/config.toml`.

```sh
codex mcp add image-queue --url https://app.example.com/api/mcp
codex mcp login image-queue
```

`codex mcp login` opens the Access sign-in in a browser. Like Claude Code, it needs localhost and loopback clients allowed in the Access application. A local stdio configuration of image-queue can stay next to the remote one under a different name.

## Verify a deployment

- `curl -i https://app.example.com/api/mcp -X POST` without credentials returns `401` from Access with a `WWW-Authenticate` header that points to OAuth metadata.
- The panel without a session redirects to the Access sign-in page.
- After connecting a client, `tools/list` includes `request_image`, `get_job`, `wait_for_job` and `view_image`.

To test the deployable bundle without a Cloudflare account or a paid provider, run the local acceptance, which uses the real Workers runtime with local D1, R2 and Queues, a synthetic Access key set and a stub image API:

```sh
pnpm build:cloudflare
pnpm exec wrangler deploy --dry-run --outdir .wrangler/acceptance
node scripts/cloudflare-acceptance.mjs
```

## Limits

- The Codex file queue and its local workers cannot run on Cloudflare. Cloud jobs use the API.
- `add_reference` reads local files, so it does not work against the hosted endpoint. Upload references in the panel instead.
- The hosted MCP endpoint is stateless. It always lists the MCP Apps views (request, image and gallery), because it never sees the client's initialize request.
- All allowed users share one workspace.
