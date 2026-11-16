# Image generation queue (images-todo)

Coding agents that need new artwork do not generate it themselves. They append
a request to `images-todo.md` in this folder. **Codex watches that file,
generates each image and saves it at the exact path the request names.** The
requesting agent polls that path and installs the image once
it appears.

```
coding agent ──request.sh──▶ images-todo.md ──(Codex watches)──▶ out/<ID>/<file>.png
     ▲                                                                   │
     └──────────────────── requester polls result ◀─────────────────────┘
```

Use the queue directory configured in image-queue. Always use the same absolute
queue path across local worker chats, including chats in separate worktrees.
`images-todo.md` and `out/` are gitignored; only this README and the scripts
are tracked.

## Request format

Each request is one block appended to `images-todo.md`. One request = one
output file. Ask for several candidates as separate requests (`…-a`, `…-b`).

```markdown
## IMG-Y23-chest-gold
- Status: pending
- Requested: 2026-10-01T14:30:00Z by feedback item Y23 (collectible chest art)
- Save to: /path/to/image-queue-folder/out/IMG-Y23-chest-gold/chest-gold.png
- Installs to: game/art/collectibles-v3/chest-gold.png (the requester does this)
- Size: 1024x1024 PNG
- Background: transparent
- References: game/art/collectibles-v2/chest-gold.png
- Prompt: A closed treasure chest in the existing reference image’s painted style …
- Must not: no text, no logos, no change to the established silhouette
```

| Field | Meaning |
|-|-|
| `## <ID>` | Unique, `IMG-<feedback or work item>-<slug>`, `[A-Za-z0-9-]` only |
| `Status` | `pending` → `in-progress` → `done`, or `blocked: <reason>` / `cancelled` |
| `Save to` | Absolute path of the PNG. Always inside `images-todo/out/<ID>/` |
| `Installs to` | Informational: where the requester will copy the approved image |
| `Size` | Exact pixel size of the delivered file |
| `Background` | `transparent` (real alpha) or `opaque` |
| `References` | Ordered PNG, JPEG or WebP files attached to the generator; use `none` for no references |
| `Prompt` | What to draw. May span several lines until the next field or block |
| `Must not` | Hard constraints |

## For Codex workers

Follow [WORKER.md](../../WORKER.md) on every wake. It is the single source of
worker instructions, including admission, literal prompt forwarding, reference
attachments, receipts and idle tagging. Configure fixed worker slots with
[the setup guide](../codex-workers.md). Workers do not change their schedules.

### Reservations and delivery

Create numbered worker slots as described in [the setup guide](../codex-workers.md).
Each slot uses its own chat identity and reads the shared WORKER.md.

Use the same configured queue helper from every worker chat:

```sh
Q=/path/to/image-queue-folder
WORKER='<your worker chat ID>'
python3 "$Q/worker.py" list
python3 "$Q/worker.py" claim --worker "$WORKER"
# Read id and token from the JSON result; {"job": null} means no claimable work.
ID='<reserved ID>'
TOKEN='<returned token>'
python3 "$Q/worker.py" check --worker "$WORKER" --id "$ID" --token "$TOKEN"
# After generation and visual/dimension/alpha QA, prepare these staging files.
python3 "$Q/worker.py" publish --worker "$WORKER" --id "$ID" --token "$TOKEN" \
  --source "$Q/out/$ID/final-staging.png" \
  --prompt-source "$Q/out/$ID/final-staging.prompt.md" \
  --generation-receipt "$Q/out/$ID/generation-receipt.json"
python3 "$Q/worker.py" finish --worker "$WORKER" --id "$ID" --token "$TOKEN" --status done
# Or, if the job cannot be fulfilled:
python3 "$Q/worker.py" finish --worker "$WORKER" --id "$ID" --token "$TOKEN" \
  --status blocked --reason 'Concise reason'
```

Reservation records live in `out/.claims/<ID>.json`. Their worker ID, random
token and request digest are required for publishing and finishing. A repeat
claim by the same chat returns its existing reservation with
`already_owned: true`; inspect existing tool calls, originals and delivery
files before resuming. Never start a second generation while its earlier call
is still running. If a complete validated delivery already exists, finish it
without regenerating. After a blocked/done job, finish the pool wake; take a new request on a later permitted wake.

Reservations never expire automatically. A long generation must not be stolen
by the other worker. Other chats skip reserved jobs and legacy `in-progress`
jobs without reservation metadata. After an interruption, the owning chat
resumes its job. If ownership cannot be recovered, notify the owner for explicit
recovery; do not delete claims, reset Status, or reclaim by age. A stale
`.queue.lock` also needs explicit recovery after confirming no process holds
it. Neither worker removes a lock that it failed to acquire.

### Polling and heartbeats

The fixed schedule wakes each slot. `scripts/pool.ts` reads the desired worker
count and intervals, applies the gate and records heartbeats. Do not maintain a
second watcher-state file or call automation-management tools from a worker.
Complete a held reservation before disabling its slot. See [WORKER.md](../../WORKER.md).

Run `python3 docs/protocol/test-worker.py` from the application repository to
test isolated queues, concurrent claims, ownership and atomic publication.
These tests do not generate artwork or modify a live queue.

## For coding agents (requesters)

```sh
Q=/path/to/image-queue-folder
# 1. File the request; prints the absolute Save to path.
$Q/request.sh IMG-Y23-chest-gold chest-gold.png <<'EOF'
- Requested: by feedback item Y23 (collectible chest art)
- Installs to: game/art/collectibles-v3/chest-gold.png
- Size: 1024x1024 PNG
- Background: transparent
- References: game/art/collectibles-v2/chest-gold.png
- Prompt: …
- Must not: …
EOF
# 2. Inspect state with the helper. Repeat at a bounded interval if needed.
python3 "$Q/worker.py" list
```

Prefer MCP `request_image`, `get_job` and `wait_for_job` for agent integrations.
The original request script remains supported. Treat the result as complete
only after the job is done and the output is present. Inspect the PNG before
copying it into the consuming project. Keep the `.prompt.md` provenance beside
that copy. Never move or delete queue outputs or change another agent's request.

A rejected result needs a new request with a new ID that says what to change.
Do not reset a done request to pending.
