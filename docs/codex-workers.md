# Codex image execution

## Local executor

The application-owned executor starts one ephemeral, read-only Codex app-server thread per image. It controls concurrency, pause and recovery locally. It uses the Codex login already present on this Mac; no API key is required for this source. Shell, web search, external MCP tools and configured plugins are disabled. The application retrieves the generator file and checks the exact submitted prompt and ordered reference hashes before publication.

Local execution is the default. Install the Codex CLI and sign in yourself, then choose Resume in Settings. Parallel requests sets concurrency (1–5); Pause stops new claims without changing that number. New workspaces start paused. If the executable is not on PATH, set `IMAGE_QUEUE_CODEX_BIN` to its stable installed path. Keep the application running.

Settings → Worker pool shows the number of active generation processes and the maximum concurrency. A saved model or reasoning change applies to the next image. An empty queue starts no Codex process. Missing queue files are initialized without overwriting existing requests or helper scripts.

Enabling local execution sets scheduled-chat admission to zero. Existing reservations must finish before the local executor starts new work, unless you explicitly review a stranded reservation as an uncertain result. That review preserves the original claim and allows new requests to proceed; it does not retry the old image. An interrupted generation is never retried automatically. Inspect its result before explicitly resending it.

Use persistent storage and queue directories. Do not point a real installation at temporary screenshot or test folders. Existing file queues must keep their request fingerprints and reservation history during migration.

## Advanced: scheduled chats

The following is the compatibility path for existing scheduled workers. Select it explicitly with `IMAGE_QUEUE_EXECUTOR=scheduled`. It is not required by the local executor.


Run the dashboard locally and keep the Codex desktop application open. Each scheduled chat owns a numbered slot and checks the application's configured gate before claiming work. The existing file queue and its non-expiring claims remain authoritative.

In Settings → Worker pool, **Set up in Codex** opens a prepared local chat with this installation’s configuration. Press Send in Codex to start setup. The link itself does not send a message or create schedules. The setup chat checks existing workers before creating anything. If the host does not expose automation tools, follow the manual steps below.

1. Create or choose a queue folder, then set it in Settings → Local directories. Copy `docs/protocol/worker.py` and `docs/protocol/request.sh` into that folder. For a **new, empty queue only**, create `images-todo.md` containing `# Image requests`. Workers require this file even before the first request. Keep an existing queue file and active reservations intact; never replace them with the empty template. Upgrade the helper and instructions together; version 1 reservations remain finishable.
2. Install dependencies in the application directory. Choose a Node 24+ executable and identify the absolute path to the cloned repository.
3. Create up to five scheduled chats, with a fixed one-minute base interval. For each slot, use the following prompt, replacing the four bootstrap values with your installation and that chat's identity:

```text
Read and execute APP_ROOT/WORKER.md on every wake.
Bootstrap values: SLOT=1; WORKER_ID=THIS_CHAT_ID; APP_ROOT=ABSOLUTE_REPOSITORY_PATH; NODE=ABSOLUTE_NODE_24_EXECUTABLE.
Follow the current shared instructions, including admission, literal generation courier, publication receipt and separate idle tagging. Never change this automation or create another worker.
```

4. Configure the active worker count and polling intervals in Settings. Slots above the count finish an existing claim and then stop taking work. Never delete a claim to disable a worker.
5. Verify that the dashboard receives heartbeats. Each heartbeat also stores `workerInstructionsVersion`; a healthy heartbeat alone is not proof of a delivered image. Submit a small request and inspect its output and `.generation.json` receipt.

### Choose the worker chat model

In Settings → Codex worker pool, choose **Worker chat model** and **Reasoning effort**, then save. The default preference is Sol 6.1 with low reasoning. This selects the chat that carries the request, not the image-generation model.

Use **Copy saved worker configuration** and paste it into a local Codex chat to apply these preferences to existing worker chats. The dashboard cannot change another Codex chat's model itself. The copied instruction preserves schedules and reservations and asks the agent to verify the actual model and effort. Choose a model available on your Codex account; an unavailable model must be reported rather than silently substituted. Worker count and polling intervals still take effect through the local gate without this extra step.

Before using your own artwork, run the three-request marked-reference self-check in [WORKER.md](../WORKER.md). It checks literal prompts, real attachments and preservation of an identifying mark. If attachment is unavailable, the worker must block the request instead of generating without it. No provider API or alternate model is used as a fallback.

Generation is a courier mode. Idle tagging starts only after an empty generation queue and has its own section and limit. Tagging thumbnails are never references for a later generation.
