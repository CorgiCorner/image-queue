---
status: accepted
date: 2026-11-17
---

# Coordinate local queue processing per generation source

## Context and Problem Statement

An API submitter could exit after accepting a request. Independent processes could also exceed a parallel limit. A single invalid image could stop the entire Codex backlog.

## Considered Options

- Execute inside each request
- Give the local dashboard exclusive ownership of dispatch for each source

## Decision Outcome

Choose dashboard-owned dispatch. Accept API requests durably under their idempotent job key. Persist launch intent before sending and reconcile stored results after interruption. Preserve ambiguous jobs for inspection. A source can be paused independently, and a global pause gates new local claims. Authentication and quota stops apply to the affected source. A configurable rolling failure count can stop new admissions while active images drain.

The worker protocol keeps its existing IDs, hashes, claim tokens and legacy exclusion path. Upgraded writers acquire an advisory lock on a permanent inode and link that inode at the existing marker path. An upgraded writer holding the kernel lock can identify and reclaim its predecessor’s marker after process death. Old writers using mkdir still exclude upgraded writers. An anonymous legacy directory requires explicit offline inspection. Existing custom helper files remain in place.

### Consequences

MCP callers can disconnect after acceptance. Local processing requires an awake host and running dashboard. Cloudflare keeps its hosted request lifecycle. An older standalone shell writer still uses the legacy directory lock.

### Confirmation

Exercise concurrent admissions, rolling failures, source isolation, uncertain attempts, recovery after process exit, legacy lock exclusion and a protocol queue containing 20,000 pending requests.
