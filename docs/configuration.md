# image-queue

## Accepted reference files

Reference attachments must be real PNG, JPEG (`.jpg`/`.jpeg`) or WebP images, up to 20 MB each. SVG, GIF, PDF, Markdown/text files and URLs are not accepted as image references. Convert an unsupported source to PNG before importing or submitting it; changing the filename extension is not conversion. Verify that every file exists and is a valid image. Never omit an invalid reference silently or replace it with a text description. Through MCP, call `add_reference` for each image and pass its returned ID in `referenceIds`.


An image workspace for the existing file-backed Codex queue and bring-your-own-key image generation. Built with Next.js, next-safe-action, Zod, React Hook Form, shadcn Base UI, Vercel UI SDK and AI Elements. Image providers use AI SDK.

## Local development

Requires Node.js 24 and pnpm.

```sh
pnpm install
cp .env.example .env.local
# Set IMAGE_QUEUE_QUEUE_DIR to your existing queue directory.
pnpm dev
```

## Provider credentials

Version 0.1.0 exposes OpenAI only; existing data from other providers is retained. It uses OpenAI's Image API directly: generations for text prompts and edits for reference images. The model list excludes chat models. Each request carries its prompt, references and size; there is no chat history or automatic prompt enhancement. A new version uses the selected image as a reference with the new instruction. Responses API image tools and conversational generation are outside this release.

Open http://127.0.0.1:3215. Connections and worker settings are at `/settings`. Provider credentials use macOS Keychain, or owner-only files outside application storage on other platforms. `IMAGE_QUEUE_CREDENTIALS_DIR` selects a private file-based credential directory. Existing encrypted records migrate on first use. Keep `IMAGE_QUEUE_SETTINGS_SECRET` available until that migration completes.

Environment keys use `IMAGE_QUEUE_OPENAI_API_KEY`, `IMAGE_QUEUE_GOOGLE_GENERATIVE_AI_API_KEY`, `IMAGE_QUEUE_AI_GATEWAY_API_KEY` and `IMAGE_QUEUE_OPENROUTER_API_KEY`. Legacy unprefixed configuration remains readable. Keep local configuration and credentials out of version control and synchronization.

Provider discovery confirms access to a model, but does not establish its supported dimensions. The composer and MCP `list_models` expose only models with a structurally valid stored size profile. Execution rejects a missing or invalid profile before starting a paid attempt. The release still requires live provider verification and a maintained registry of those verified profiles; connecting a new key alone currently does not create that evidence. See [model verification](model-profiles.md).


The default queue directory is `./image-queue`. Configure `IMAGE_QUEUE_QUEUE_DIR` to attach an existing queue. The panel imports metadata, reads existing artwork and appends new requests using the shared `.queue.lock`. Project assignment stays in panel storage. Submitted queue entries remain worker-owned. No worker is created by this application.

References support PNG, JPEG and WebP up to 20 MB. Each queue job produces one PNG.

## Idle worker tagging

Add these steps to each scheduled worker's instructions after its existing queue check.

1. Run the slot gate and honor its disabled, draining and interval decisions.
2. Finish any owned reservation and check for a generation request through the existing worker protocol.
3. Only when there is no generation work, call `list_untagged` with `limit: 1`. An empty batch ends the wake-up. The server defers tagging while any visible generation request is queued or running.
4. Inspect the returned 640 px thumbnail through the local dashboard origin. Call `tag_image` with the image ID and a short list of descriptive tags. Tags are recorded as agent suggestions. Existing user tags are preserved.
5. Recheck generation before another image. Stop after at most five images per wake-up and finish the slot heartbeat.

Workers without an MCP connection can use the same selection and tag logic locally. Run from the repository with its configured environment and send JSON on standard input.

```sh
printf '%s' '{"command":"list","limit":1}' | node --env-file-if-exists=.env.local --import tsx scripts/tagging.ts
printf '%s' '{"command":"tag","id":"IMAGE_ID","tags":["glass","studio"]}' | node --env-file-if-exists=.env.local --import tsx scripts/tagging.ts
```

The list returns thumbnail paths relative to the local dashboard. The tag command rechecks generation priority and whether the image is still untagged before saving. A `saved: false` response ends the idle task. Inspect the thumbnail before supplying tags.

These instructions use the existing worker's queue operations. Tagging tools do not claim or publish generation requests. A newly queued request can arrive after a batch is returned, so workers must recheck the queue before inspecting each thumbnail.

## Agents

Build the local MCP entry point from the repository. No global installation is needed.

```sh
pnpm build:mcp
```

Codex configuration uses TOML.

```toml
[mcp_servers.image_queue]
command = "node"
args = ["/path/to/image-queue/dist/mcp.mjs"]
```

Claude Code configuration uses JSON.

```json
{"mcpServers":{"image-queue":{"command":"node","args":["/path/to/image-queue/dist/mcp.mjs"]}}}
```

Replace the example path with your clone's absolute path, or copy the ready-to-use block from Settings. Settings also uses the current Node executable, which avoids PATH differences in desktop clients.

The copied block carries the running dashboard's storage, queue and reference folders, plus an explicit credential-directory override when one is configured. It also uses the dashboard's current address unless a dashboard URL is configured. Provider keys, encryption secrets and HTTP tokens are excluded. If you supply secrets only to the dashboard's shell process, also make them available to the MCP process through a server-side `.env.local`, or save the provider key in Settings.

Tools include `create_project`, `list_projects`, `request_image`, `get_job`, `list_jobs`, `wait_for_job`, `cancel_job`, `retry_image`, `mark_uncertain_failed`, `add_reference` and `list_models`. Supply a new `idempotencyKey` for a new image. Identical retries return the existing job. A different request with the same key fails. `IMAGE_QUEUE_REFERENCE_ROOTS` is a platform-delimited list of allowed local directories and defaults to the project directory. Canonical paths are checked, including symlinks.

`retry_image` creates a separate attempt for blocked queue requests or failed/blocked provider requests. It never retries automatically. An uncertain result requires the user's agreement to another possible charge and `acknowledgeUncertain: true`. `mark_uncertain_failed` records the user's decision without another provider call.

To order an image over stdio, use the ID returned by `create_project` or `list_projects`. For example, pass these arguments to `request_image`:

```json
{
  "projectId": "your-project-id",
  "source": "queue",
  "prompt": "A blue square on a white background",
  "aspectRatio": "1:1",
  "idempotencyKey": "blue-square-01"
}
```

For an exact output size, provide `width` and `height` in pixels. Pass the request's returned `id` to `get_job` to read its status and, when done, its local `outputPath`.

HTTP MCP uses `/api/mcp` and requires `Authorization: Bearer <IMAGE_QUEUE_MCP_TOKEN>`. It is disabled until that secret is configured. A local HTTP client must send the returned `Mcp-Session-Id` on subsequent requests to retain negotiated MCP Apps capabilities. Sessions expire after 30 minutes of inactivity. The Cloudflare HTTP endpoint is stateless and exposes the base MCP tools.

API generation records the attempt before contacting a provider and disables SDK retries. Interrupted or ambiguous failures become `uncertain`. Check the provider before submitting another job. A new job is an explicit new request and can incur a new charge.

## Experimental Cloudflare deployment — outside 0.1.0

Version 0.1.0 supports local deployment only. The implementation notes below are experimental groundwork, not a supported deployment guide. Provider-only Cloudflare deployment is planned for a later 0.1.x release after separate validation.

```sh
pnpm build:cloudflare
```

The application includes a D1/R2 storage adapter and migrations. Cloudflare thumbnail generation uses the IMAGES binding; generated thumbnails are cached in R2 by content hash. Before deploying, create the D1 database and R2 bucket, replace the local D1 ID in `wrangler.jsonc`, and apply `migrations/0001.sql`. Configure `IMAGE_QUEUE_STORAGE_DRIVER=cloudflare`, `IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN`, `IMAGE_QUEUE_CF_ACCESS_AUDIENCE` and optionally `IMAGE_QUEUE_MCP_TOKEN`. Provider API keys are Cloudflare platform secrets using the prefixed names above. Protect the site with Cloudflare Access. Browser routes verify the Access JWT. HTTP MCP has separate bearer authentication.

The Codex file queue is local-only. Cloudflare can generate using configured API providers. A cloud-to-local queue bridge is outside this implementation.

## Verification

```sh
pnpm test
pnpm coverage
pnpm typecheck
pnpm build
pnpm build:cloudflare
```

Protocol tests run the original Python worker against temporary files, including claim, publish, finish and cancellation races. No test calls a paid provider or changes the live queue. Provider tests use mocks. Generated registry components live under `src/components/ui` and `src/components/ai-elements`.

## Public website

The public product website is served at `/website`. The local dashboard stays at `/`, so launching the dashboard opens the workspace directly. Both live in this repository. Dashboard routes keep their access checks. The website uses a standalone static image asset and does not request private gallery data.

### Portable record identities

New projects, image requests, references, topics, notes and pins carry an additional `globalId`, `originMachine` and HLC `createdVersion`. Existing local IDs and worker queue entries are unchanged. Local MCP tools continue to accept the `id` field, not `globalId`. The clock is persisted locally so a restart or a backwards system clock does not repeat creation versions.

This is preparation for optional S3 sync, not an enabled sync feature. Migration of existing records and paths, per-field edit versions, remote reference mapping and transport are still pending in the internal release tracker.

## Local storage locks

The disk driver uses operating-system advisory locks. A crashed process releases its locks, allowing the next process to recover journaled writes and purges. Keep the local store on a filesystem that supports advisory locking. Lock files remain on disk and are not queued work.

Upgrading from the earlier empty-directory lock format requires stopping every application and MCP process that uses the store before migrating any leftover empty lock directories. The application does not automatically delete an unknown legacy lock. Never remove a lock while an older process may be writing. Worker queue claims are separate and are not changed by this storage mechanism.

## Application-owned Codex runner (preview)

Local execution is the default and starts paused. Choose Resume in Settings to start work. Parallel requests sets the limit from 1 to 5; Pause preserves that limit and lets running images finish. `IMAGE_QUEUE_EXECUTOR=scheduled` selects the advanced scheduled-chat compatibility path. Keep `IMAGE_QUEUE_STORAGE_DIR` and the configured queue in persistent folders; temporary screenshot fixtures are not an installation.

The Node application owns concurrency and starts one ephemeral, read-only Codex app-server thread per image. Shell, web search, user MCP tools and plugins are disabled for generation. The application validates the exact prompt and ordered reference hashes from the generator event, then copies the returned image itself. `IMAGE_QUEUE_CODEX_BIN` may select an installed CLI; otherwise it resolves `codex` through PATH. Use the existing Codex login on that machine. The application never reads or copies its authentication file.

Enabling this mode saves the local concurrency separately and sets scheduled-chat admission to zero. Existing chat reservations must drain before the local executor takes work. The local executor keeps an exclusive storage lock and records each attempt before starting generation. Interrupted started attempts become uncertain; they are not automatically regenerated. A reservation that never reached launch intent may safely resume.

With this mode enabled, Settings shows actual local process counts and removes scheduled-chat intervals. Saving the worker count changes local concurrency; saving model and reasoning applies to the next request. An empty queue starts no generation process. The application must remain running.

Cloudflare cannot run the local Codex executable. Remote runners and their authenticated transport are deferred; never upload local Codex authentication to a cloud deployment.

Before each local claim, the runner asks Codex's local app-server for the current usage snapshot. A confirmed exhausted limit prevents claiming and shows its reported reset time when supplied. Missing or unsupported usage data is recorded as unknown, not as available credit. No account identifiers or reset-credit details are stored. Any failed generation pauses further dispatch until the user explicitly resumes it.

For an offline upgrade from legacy directory locks, first stop every application and MCP process that uses the store and make a backup. Run `pnpm exec tsx scripts/migrate-legacy-locks.ts /absolute/path/to/store --offline-confirmed`. This archives only recognized empty lock directories, checks any kernel lock, and refuses unknown contents. It never modifies the file queue or reservations. The confirmation flag is an operator assertion; it cannot prove that an old process will not start again.

### Agent recovery

MCP job responses include `execution` (runner state, stop reason, affected job and next action) and, for failed jobs, `recovery`. Do not treat a successful MCP call as successful image generation. Inspect the job status and error. For a pre-generation reference validation block, repair or convert the references and submit one corrected request automatically within the original user request. Check whether a corrected replacement already exists first. Never blindly retry unchanged inputs. `uncertain` means an image may already have been generated: inspect the existing result and obtain acknowledgement before a potentially duplicate generation. A deliberately paused queue remains paused until the user resumes it.

### GitHub Pages

`pnpm build:website` builds only the public product page into `dist/website`.
It contains no dashboard routes, API endpoints or user data. The default base
path is `/image-queue`; use `WEBSITE_BASE_PATH='' pnpm build:website` for a
custom domain at its root. Both builds share the same website components.

Enable GitHub Actions as the repository's Pages source. The `Public website`
workflow deploys the static output and reads the base path from Pages settings.
Configure a custom domain in repository Settings → Pages before changing DNS.
For a subdomain, point its CNAME to `corgicorner.github.io`, without a path.
Keep HTTPS enforcement enabled once GitHub has issued its certificate.
This hosts the product website; running the queue still requires the local app.
