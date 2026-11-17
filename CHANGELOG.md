# Changelog

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
