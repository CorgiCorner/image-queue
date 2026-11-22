# Changelog

## 0.2.1 - 2026-11-22

- Use an image attached to the chat as a reference: `upload_reference` shows a card in Claude where you choose, drop or paste the image on a computer or phone, and the card sends the reference ID back. Claude cannot pass a chat attachment to a tool, and the hosted server cannot read local paths.
- GIF requests accept reference images. They are sent to the OpenAI edits endpoint with the frame settings, and the next version of such a GIF keeps the original's references.
- A hosted server cannot scale an animated GIF, so a GIF request whose size the model does not render natively is refused before submission, with the size to request instead (for example 608x1088 for a tall GIF of up to 12 frames). Locally such GIFs are still scaled.
- A blocked job whose generated file was saved can be previewed with `view_image` and downloaded from the job view, as the web panel already allowed.
- The Cloudflare generation queue runs up to 20 jobs at once instead of 4.

## 0.2.0 — 2026-11-20

- Deploy image-queue to your own Cloudflare account with `pnpm cloudflare:setup`: D1, R2, a generation queue, a custom domain, Cloudflare Access with Managed OAuth and the Worker secrets in one repeatable command. See [docs/cloudflare.md](docs/cloudflare.md) and [ADR-0020](docs/decisions/0020-remote-mcp-behind-cloudflare-access.md).
- Connect the hosted MCP endpoint from Claude on the web, desktop and phone, Claude Code or Codex. Every request needs a Cloudflare Access sign-in from an allowed address; other signed-in accounts get 403, and the local static MCP token is not accepted there. API generation runs from the queue, one attempt per job without automatic retries.
- Hosted deployments generate through the OpenAI API by default. `refresh_models` loads the model list with the server's key, `view_image` returns a finished image, and the inline request, image and gallery views work on the stateless endpoint. Reading tools are marked read-only so hosts can run them without asking.
- Inline views follow the host's font and colours, show a loading state, download the full file and play GIFs as a light animated preview. On a phone a swipe scrolls the conversation and a tap selects a place for a change. The Next version form explains what it does.
- The next version of a generated GIF is generated again from its prompt with the requested changes, keeping its model, size, frame count and frame duration.
- Every OpenAI image model has its own profile: GPT Image 2.6 Sunburst (the new default) and Flare, 2.5 Sunburst and Flare, GPT Image 2, 1.5 and 1 mini, with documented custom sizes, `quality` and, for 2.6, `complexity`. `list_models` and `get_generation_source` report each model's capabilities.
- API requests can ask for PNG, WebP, JPEG, GIF or SVG when the model lists that format. GIF requests set frame count and duration and are checked against the frame sheet the model can render before submission. One submission can create up to 10 jobs.
- A definite provider rejection, including an account with no credits, is stored as failed with the provider's reason. A corrected request may reuse the idempotency key of a failed or cancelled one.
- The sidebar shows the generation source in use and lets you switch it. Connect an agent shows the remote MCP steps on a hosted workspace. Dark theme selects, fields and checkboxes read as one system.

## 0.1.5 — 2026-11-17

- Send the first prompt directly to Inbox. Opening a project or topic sets the destination for the next image. A paused queue shows its status on mobile before submission.
- Request a new version using the area selected on the image. Save additional notes explicitly, keep a draft for each image, and open the requested version to follow its progress.
- Edit directly below the preview on a phone. Image details expand on demand. Gallery cards can still open the original when a thumbnail fails.
- Poll active requests with smaller status responses, pause polling in background tabs, and reuse the original image for text-only corrections.

## 0.1.4 — 2026-11-17

- Manage Codex and OpenAI API processing in Settings or through MCP. Pause either source or both, set parallel requests, and see executor activity, waiting requests and the last delivery.
- Keep processing independent requests after individual failures. Set an optional limit on distinct failed requests within a rolling time window. Authentication and quota failures stop the affected source.
- Accept local API requests durably even when the submitting agent disconnects. After a restart, recover saved images and flag uncertain submissions for inspection.
- Handle large Codex queues and report pending requests to MCP before the gallery imports them. Recover queue locks left by interrupted current-version workers.

## 0.1.3

- Choose the default generation source and OpenAI model in the dashboard or through MCP. Repeating the same MCP request keeps its original source and size.
- Report when the Codex queue needs attention. MCP can return pending jobs immediately when the queue needs user action, and returns the original image path after a size mismatch when available.
- Clarify recovery for uncertain jobs. Mark as failed updates the existing job, and Retry stays a separate action.
- Add an OpenAI connection check in Settings, improve reference and size handling, and refine the image detail, tag suggestions and gallery notices.

## 0.1.2 — 2026-11-16

- Keep the local queue running when several images generate at once. Workers, page loads and agents now wait briefly for a busy storage lock instead of stopping the queue and marking the image as uncertain.
- Say that the queue is stopped and waiting to be resumed when local execution is blocked, instead of reporting that workers are offline. The MCP job view shows the same state.
- Replace the README banner.

## 0.1.1 — 2026-11-16

- Publish the product website separately on GitHub Pages, with support for a custom domain.
- Report known prompt, reference and transparency validation failures directly in queue status.

- Preserve generated files and safe failure summaries when local validation or delivery fails, so interrupted results can be inspected without generating duplicates.

## 0.1.0 — 2026-11-16

First local release.

- Organize images in project folders, with references, tags, search and version stacks.
- Browse the gallery in justified rows, masonry or a square grid.
- Submit image requests through the dashboard or MCP.
- Run Codex generation locally through isolated read-only threads, with pause, concurrency, exact prompt/reference checks and recovery without automatic retries. Existing scheduled workers remain an advanced compatibility option.
- Use provider API connections with validated model size profiles and durable attempt records.
- Keep credentials in the server-side store; restrict local HTTP requests and reference paths.

Video references and multi-machine sync are outside this release. Cloudflare deployment is deferred beyond 0.1.0. Tested on macOS 27.0.1 with Apple silicon (Apple M2 Max) and Codex CLI 0.167.1. Other systems and Intel Macs are untested.
