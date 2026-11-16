---
status: accepted
date: 2026-11-16
---

# Run Codex generation through application-owned local workers

## Context and Problem Statement

Scheduled chats currently perform polling, admission and generation. Their bootstrap can target a different store, and settings cannot directly control the running chat. Real local `codex exec` probes have produced a PNG and an image edit with an attached reference. The owner selected application-owned workers as the intended default.

## Considered Options

- Application-owned local workers dispatching one isolated Codex process per image
- Scheduled Codex chats as the default execution mechanism
- Direct provider API only

## Decision Outcome

Choose application-owned local workers. The application owns scheduling, bounded concurrency, pause, process lifecycle and durable attempt records. Codex receives one literal generation request with ordered references and ends. The application validates and publishes the actual output through the existing worker protocol.

This supersedes ADR-0005 as the default worker control architecture. Scheduled chats remain an advanced compatibility option. ADR-0002's producer/observer adapter remains unchanged: a separate execution worker, not the web adapter, claims and publishes through the original helper. Queue entries are never rewritten or reordered.

Rules:

- No generation processes for an empty queue. Pause immediately prevents new claims and allows running jobs to finish.
- Persist an attempt before spawning. A crash or ambiguous termination becomes uncertain, without automatic generation retry.
- Use the existing authenticated Codex installation; never extract authentication files or fall back to a provider key.
- Record actual model, ordered attachments, submitted prompt and validated file dimensions. Failure to attach references blocks the request.
- Check available usage evidence; stop on exhausted quota and show a verified reset time when available. Unknown quota must not be displayed as known.
- Production data and execution configuration use persistent user directories. Temporary review stores cannot silently become the production installation.
- Resolve executables at startup through supported PATH/configuration rather than persisting a version-specific package-manager cellar path.
- Migration never steals reservations from existing scheduled workers. Disable new scheduled claims only after their current work is finished.

### Confirmation

Before enabling this execution path, verify repeated generation, ordered-reference edits, two concurrent isolated runs, cancellation, process crash recovery, output provenance and protocol compatibility. UI process states must match observed child processes. A generated image from one CLI probe is not acceptance of the full worker lifecycle.

### Consequences

Local Node deployment gains direct control and immediate dispatch without idle model calls. Cloudflare cannot spawn local Codex processes and retains provider generation or an explicitly connected local executor. Generation, ordered-reference editing, sequential and concurrent execution, cancellation, and crash recovery have been tested. Final release acceptance also requires the setup and interface checks.

## Local source and recovery boundary

JobSource exposes claim, heartbeat, complete and fail. The local implementation calls the core; a future HTTP implementation uses runner-specific authentication. Neither Codex authentication nor provider credentials travel with jobs.

Reservations and started attempts are distinct. A reservation without a persisted launch intent may return to pending after exclusive recovery. Persist startedAt immediately before process spawn. A crash in the small launch window is conservatively uncertain; never risk duplicate generation. Old file-queue reservations never expire automatically. A user may explicitly review a stranded legacy reservation as uncertain. That acknowledgement preserves the original claim and allows unrelated new work to proceed; it never resumes or steals the reviewed request. The exemption is bound to the recorded claim owner.

The UI must show the owner and reservation time and offer explicit resend or mark-failed recovery. Enabling local execution disables new scheduled-chat claims, allows existing claims to finish and states this change in the UI. Mixed execution requires a separate atomic-protocol concurrency test.

## Deployment scope

Version 0.1.0 is local only. Cloudflare provider execution is deferred to 0.1.x, and remote Codex runners to 0.2 or later. A future remote runner connects outward; no incoming Mac port or transfer of Codex login. Bucket replication and a central queue are distinct future modes.

## Verified quota reset

Only an exhausted-plan response observed before claiming a job may persist a resume time. A local one-shot timer re-enables admission at that time, including after application restart; admission checks the actual quota again before claiming. Unknown reset times require a manual recheck. Generation failures never schedule resumption, and uncertain jobs are never retried automatically. Stopping the runner cancels its timer. Desired concurrency remains separate from blocked execution.
