---
status: accepted
date: 2026-11-15
---

# Add portable identities without renaming worker requests

## Context and Problem Statement

ADR-0014 requires identities that survive replication between independent installations. Existing queue IDs and idempotency keys are caller-provided and can repeat on different machines. Renaming a request already claimed by a worker would invalidate its content hash and output binding under ADR-0002.

## Considered Options

- Keep local IDs and add a deterministic global identity namespaced by record kind and origin machine
- Rewrite every existing ID as a UUID and update queue entries and references
- Reuse local request IDs as replica keys

## Decision Outcome

Chosen option: keep local IDs and add a deterministic global identity. `globalId` is `G-` followed by SHA-256 of a versioned tuple containing kind, origin machine and local ID. `originMachine` and `createdVersion` are saved with the record. Two different registered origins therefore have different global identities even when their local request IDs match.

- Local tool arguments, queue IDs and existing output bindings remain unchanged.
- Global IDs identify replica records; they are not yet aliases accepted by local tools.
- Existing machine identity is reused. Cloned installations with the same machine identity must be detected during replica registration/change-log publication, not silently assigned a new origin.
- Creation versions use a persistent local hybrid logical clock. Clock state lives in local settings and is never a replica object.
- Version order compares physical time, then logical counter, then machine ID by code-unit order. It does not depend on locale.
- A node advances past every timestamp it has observed, even when its own clock moves backwards. This is a causal-order guarantee, not an assertion about the real-world ordering of disconnected concurrent edits.
- Portable kinds are explicit. Credentials, local settings, paths, indexes and operation journals are not implicitly eligible for replication.

### Consequences

- Good, because existing workers and local agents retain their identifiers.
- Good, because replaying an identical request retains its original creation version and global identity.
- Bad, because replicated references need a global-to-local mapping when records are imported.
- Bad, because older records need a separate, resumable migration; optional schema fields preserve readability until that migration is implemented.

### Confirmation

- Identical local request keys on two independently identified machines yield different global IDs.
- Repeated requests on one machine return the same complete record.
- A newly imported queue entry receives identity metadata without changing the queue file.
- A clock reopened from disk advances after a wall-clock rollback.
- Concurrent local events receive distinct versions, and contention retries are bounded.

## More Information

Initial integration covers creation of projects, jobs, imported images, references, topics, notes and pins. Per-field edit clocks, migration of already stored records, global-to-local reference mapping and migration of absolute paths remain part of L1. No bucket transport is enabled by this decision.
