---
name: image-queue
description: Submit and inspect image requests through the image-queue MCP server, select the generation source, and diagnose paused, blocked or uncertain jobs. Use for this application and its local queue, not generic image generation outside image-queue.
---

# Image Queue

Use the connected image-queue MCP tools. Tool namespaces may vary; discover the available tools by their names. Do not replace the user's chosen integration with another image generator, start polling chats, or launch another app instance. If tools are missing, distinguish a saved MCP configuration from a connection actually loaded by the current client. Reconnect at a safe point; do not interrupt active work or claim installation proves the tools are available.

## Choose the source deliberately

Read `get_generation_source` and `list_models` before the first request when the source or model is not already known in this conversation. If `list_models` is empty or lacks a model the user names, call `refresh_models` once; it generates nothing and is not billed. A hosted (Cloudflare) server always uses source `api`. After a job is `done`, call `view_image` to show it when the client has no inline views.

- `queue` means the local Codex runner using the ChatGPT plan. It requires the machine and runner to be available. A queued request is not proof that generation has started.
- `api` means a separately billed OpenAI API call using the locally configured key. A working ChatGPT plan does not provide API credit.
- Use `get_queue_processing` to check each executor’s heartbeat, waiting/running counts, pause, last delivery and stop reason. Model discovery confirms catalog access. For queued jobs use `get_job` or `wait_for_job` and read `execution.nextAction`. Local API work requires the running dashboard.
- Use `set_queue_processing` when the user asks to change processing. A global resume preserves individual pauses. A source resume clears its stop and failure window. Resuming API may start paid waiting requests. A failed or uncertain image needs its own recovery decision.
- `set_generation_source` saves the default for **new** requests. It does not migrate existing jobs, generate an image, resume the runner, or retry failures. Pass `source` and optionally a configured OpenAI `model`.
- `request_image` / `request_images` use the saved default when `source` is omitted. Pass an explicit source for a one-off override. Preserve the user's choice; do not switch to paid API as an autonomous fallback.

Changing a setting alone is not approval for extra generations. Submit the images the user requested; ask before additional paid attempts outside that scope.

## Prepare an accurate request

Choose the intended project from `list_projects`. Read available models and their supported options rather than guessing dimensions or capabilities. For queue requests use the requested `aspectRatio`, or exact `width` and `height` when the user needs them. For API requests use the returned size profile, `transparency`, `qualities`, `complexities` and `outputFormats`; pass `quality`, `complexity` or `outputFormat` only for API requests and only with a listed value. Omit `outputFormat` for PNG. Transparent output is PNG or WebP only. GIF may set `frameCount` (2–16) and `frameDurationMs` (20–2000). SVG cannot include reference images or frame settings. GIF output with reference images is not supported by this application yet. `count` (1–10) creates that many independent jobs; replay the same idempotency key and count to get the same jobs. `request_images` counts the expanded jobs toward 20. Capabilities under `documentedOnly`, and every capability of a model with `generationVerified: false`, come from provider documentation without a generation receipt: check the delivered file. The final raster may be fitted down from a supported provider size; GIF keeps its animation when fitting is possible, and SVG is stored as generated. Do not promise a native size or invent support for transparency.

Keep the user's prompt literal. Add style instructions only when requested or approved. Do not silently shorten or rewrite a failed prompt to get a different result. Keep provider-native controls separate from prompt text.

References must be actual PNG, JPEG or WebP files, at most 20 MB each, at most 10 per request. Import with `add_reference`, then pass the returned `referenceIds` in the intended order. Paths must be under configured allowed reference roots. A URL, SVG, PDF, GIF, Markdown file or renamed non-image file is not an image reference. Convert an unsupported image format only within the user's authorized scope; do not broaden filesystem access to bypass a rejection.

A document such as `VISUAL_STYLE.md` is text guidance. If the user wants it applied, read the relevant content and incorporate it as approved text, keeping the prompt within the tool's length limit. Do not pass the document to `add_reference`. Avoid raw queue headings (`## `) or queue metadata lines inside a prompt; use plain prose or lower-level headings for document excerpts.

Use a stable `idempotencyKey` for a single intended request. Reuse it only with identical inputs, for example after an uncertain transport response. A new key creates a new request; never use repeated keys or new retries to conceal uncertainty.

## Interpret the result before acting

Read `status`, `error`, `recovery`, `execution.nextAction`, requested dimensions and any actual provider-result dimensions from `get_job` or `wait_for_job`.

| State | Correct next step |
| --- | --- |
| `queued` | Identify the source. For Codex, report paused/offline/blocked execution and its next action; do not claim a worker has picked it up. API and Codex runner states are independent. |
| `running` | Keep the existing request; do not create a duplicate. A transport timeout does not prove generation failed. |
| `done` | Open the actual image, confirm dimensions and requested transparency, then provide the usable result or destination. Status alone is not visual acceptance. |
| `blocked` | Read the exact preflight error. Repair an invalid or missing reference within scope before retrying. Do not blindly submit again. |
| `failed` | Check whether a provider call occurred and whether an original exists. Correct a demonstrably local/preflight problem only when safe; an additional paid generation needs appropriate authorization. |
| `uncertain` | The provider may already have generated an image. Inspect retained output and receipts; do not automatically repeat the paid call. |

A size mismatch can report `generationCompleted: true` and `inspect_size_mismatch`: generation happened, but delivery fitting failed. Inspect the retained original at `recovery.originalPath` if supplied, and compare actual/requested sizes. Do not upscale or crop without authorization. Resuming the queue only permits other pending work; it does not repair an already failed image.

Keep the MCP process alive for API submissions: these tools may wait for generation inside the call. Use bounded status checks in the current task. If `wait_for_job` returns an unclaimed Codex request early with `execution.requiresUserAction: true`, communicate the next action instead of polling again. Do not create a scheduled chat just to watch one generation finish.

## Migration and delivery

When the user authorizes moving particular requests to API, preserve their prompts, reference order and old history. Do not claim old failed jobs succeeded because a new API job did. Cancel a duplicate unreserved queue entry only as part of an authorized migration; never steal or clear another runner's reservation.

Confirm the generated file exists before telling another agent it is ready. If a consuming workflow watches a specific output path, deliver the verified file there without overwriting a different existing image, and retain provenance linking it to the new request. Tell the agent which file to use and why an old job may still show failure.

Keep keys, complete MCP configurations and credential-store contents out of logs and handoffs. Use the server's safe status fields instead. Never read `auth.json` or change login to resolve a generation error.
