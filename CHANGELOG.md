# Changelog

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
