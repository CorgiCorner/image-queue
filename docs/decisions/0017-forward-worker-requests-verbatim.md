---
status: accepted
date: 2026-11-15
---

# Forward image-worker requests verbatim with explicit reference attachments

## Context and Problem Statement

A worker received the original prompt and reference file but rewrote the edit as a new illustration. Merely viewing a reference did not establish that it was attached to generation. How do we constrain the intermediary while preserving existing reservations?

## Considered Options

- More natural-language guidance alone
- An additive courier envelope and a publication receipt checked against the reserved request
- Replace the queue protocol

## Decision Outcome

Chosen option: an additive courier envelope and publication receipt. Claim and check return the exact prompt, ordered reference paths, dimensions, generation mode and ready-to-forward tool arguments. A missing reference or unavailable attachment blocks the request; text-only fallback is forbidden. Generation and idle tagging are separate modes. Only file inspection required by the image tool is permitted during generation; the worker must not describe or rewrite the input.

New reservations are version 2. Publication requires a JSON receipt with the actual submitted prompt, ordered reference paths and attachment parameter/value. The helper rejects differences and saves the receipt beside provenance. Version 1 reservations can complete under their original contract. Queue entry text, claim fingerprints, ownership, non-expiring reservations and status-only updates remain unchanged (ADR-0002).

### Consequences

- Good, because accidental prompt rewriting and omitted/reordered attachments can be rejected before publication.
- Good, because previously claimed requests remain recoverable.
- Bad, because the receipt is worker-reported evidence. It cannot prove an untrusted worker's actual tool call or visual fidelity.
- Bad, because helper and worker instructions must be upgraded together for new claims.

### Confirmation

- Tests preserve literal multiline prompts and reference order.
- Publication rejects changed prompts, absent attachments, incorrect counts and reordered references.
- Legacy claims remain finishable; new claims preserve the queue fingerprint.
- A live self-check edits a marked reference three times; each result is visually inspected for the marker and requested change.

## More Information

ADR-0016 defines the application-owned local executor. Deferred video sequences will use a later available ADR number. The receipt is local evidence, not a new replicated record format.
