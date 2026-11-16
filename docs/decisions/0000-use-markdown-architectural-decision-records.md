---
status: accepted
date: 2026-11-14
---

# Use Markdown Architectural Decision Records

## Context and Problem Statement

image-queue is open source and built largely by coding agents working from written plans. Decisions get made in chats and are easy to lose or silently reverse. How do we record the decisions that shape the project so that people and agents can find and follow them?

## Considered Options

- MADR 4.0, one Markdown file per decision in `docs/decisions`
- Michael Nygard's original ADR template
- No formal records, decisions live in the README and in issues

## Decision Outcome

Chosen option: "MADR 4.0, one Markdown file per decision in `docs/decisions`", because it keeps decisions next to the code, in a format agents read well, and it records the options that were rejected, not only the one that won.

### Consequences

- Good, because a new contributor or agent can read why the project is shaped the way it is.
- Good, because rejected options are written down, so they are not proposed again without new information.
- Bad, because records need upkeep. A decision that changes needs a new record that supersedes the old one.

### Confirmation

- Every record is a file named `NNNN-title-with-dashes.md` in `docs/decisions`.
- A change that contradicts an accepted record must add a new record and mark the old one as superseded.
- Agent instructions in the repository point to this folder as required reading before design work.

## More Information

- Status values used here: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by ADR-NNNN`.
- Records are public. They must not contain secrets, private paths or personal data.
- MADR: [https://adr.github.io/madr/](https://adr.github.io/madr/)
