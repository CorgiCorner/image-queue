---
status: accepted
date: 2026-11-14
---

# Store data as plain files behind a storage interface

## Context and Problem Statement

image-queue keeps projects, jobs, results, references and settings. It must run on a laptop with no setup ([ADR-0001](0001-everything-except-image-generation-works-locally.md)) and it should also be deployable to Cloudflare by users who want access from anywhere. Where does the data live, and how does one code base serve both?

## Decision Drivers

- Zero setup locally: no database server to install or run.
- Data should be readable and movable with ordinary tools.
- The same application code must run on Node.js and on Cloudflare Workers, which have no file system.
- Tests must be fast and must not need real infrastructure.

## Considered Options

- Plain files on disk behind a storage interface, with other drivers behind the same interface
- SQLite locally and D1 on Cloudflare
- A hosted database for every deployment

## Decision Outcome

Chosen option: "Plain files on disk behind a storage interface", because it gives zero setup, data the user can inspect, and one contract that a Cloudflare driver and an in-memory test driver can also satisfy.

The shape of the decision:

- One storage interface covers records and binary files.
- Three drivers implement it: disk (default), Cloudflare D1 with R2, and memory for tests.
- The disk driver writes one JSON file per record and stores images under a key derived from their content hash. Every write goes through a temporary file and a rename.
- Only the disk driver and the queue adapter may touch the file system. Everything else goes through the interface.
- Thumbnails are a cache. They can be deleted and rebuilt.

### Consequences

- Good, because a new user runs one command and has a working store.
- Good, because content-addressed images deduplicate themselves and are easy to copy between machines.
- Good, because the same contract tests run against every driver.
- Bad, because listing and filtering thousands of records from files is slower than a database query and may need an index later.
- Bad, because the interface must stay small enough for three drivers to implement faithfully.

### Confirmation

- One contract test suite runs against the disk driver in a temporary directory, the Cloudflare driver in a local Workers runtime, and the memory driver.
- A lint rule forbids importing file system modules outside the disk driver and the queue adapter.

## Pros and Cons of the Options

### Plain files behind a storage interface

- Good, because it fits the local-first rule with no moving parts.
- Bad, because query performance needs attention as collections grow.

### SQLite locally and D1 on Cloudflare

- Good, because queries are fast and the two engines are close relatives.
- Bad, because records stop being inspectable files, and syncing a database file between machines is unsafe.

### A hosted database for every deployment

- Good, because there is one implementation.
- Bad, because it breaks [ADR-0001](0001-everything-except-image-generation-works-locally.md).

## More Information

If file listing becomes the bottleneck, add a local index that can be rebuilt from the files. The files stay the source of truth.
