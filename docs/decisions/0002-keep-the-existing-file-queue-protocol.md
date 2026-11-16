---
status: accepted
date: 2026-11-14
---

# Keep the existing file queue protocol as the source of truth

## Context and Problem Statement

Before image-queue existed, a working queue already did the job: agents appended requests to a Markdown file through a script, scheduled Codex chats claimed one request at a time under a file lock, generated the image and published the result. It has produced several hundred images. Should image-queue replace that protocol with its own, or sit on top of it?

## Decision Drivers

- The existing workers must keep working without changes.
- Agents that still call the original scripts must keep working.
- A claim carries a hash of the request content and publishing checks it, so the queue file must not be rewritten casually.
- The first version should prove one full loop before anything is redesigned.

## Considered Options

- Adapter: image-queue is a second producer and an observer of the existing queue
- Replace: a new queue format owned by image-queue, with workers rewritten to use it
- Fork: copy the scripts into the image-queue repository and evolve them there

## Decision Outcome

Chosen option: "Adapter: image-queue is a second producer and an observer of the existing queue", because it keeps a proven mechanism intact and makes the first milestone small: one real image ordered from image-queue and delivered by an existing worker.

What the adapter may and may not do:

- It appends requests exactly as the original request script does, under the same lock.
- It reads the queue file and result folders to show status.
- It never claims, publishes or finishes a request. Those operations belong to the workers.
- It never reorders or rewrites entries in the queue file.
- Projects, ordering in the gallery, tags and links to source videos live in image-queue's own metadata, keyed to the request.

### Consequences

- Good, because existing workers and agents are unaffected.
- Good, because the riskiest part of the system is not touched in the first version.
- Bad, because image-queue inherits the protocol's limits: claims do not expire, and execution order cannot be changed from the panel.
- Bad, because two code bases must agree on one file format.

### Confirmation

- A compatibility test runs the real request and worker scripts against a temporary queue directory and checks that image-queue reads the same state.
- A concurrency test has two writers append at the same time and checks that no entry is lost.
- Parser tests use fixtures taken from real queue files.

## Pros and Cons of the Options

### Adapter

- Good, because it is the smallest change that delivers value.
- Bad, because new needs, such as priorities, require a protocol change that is negotiated, not just coded.

### Replace

- Good, because image-queue could design expiry, priorities and richer status from the start.
- Bad, because it discards a working system and delays the first real image.

### Fork

- Good, because the scripts and the panel would live and change together.
- Bad, because the copies drift apart unless an update policy is defined and followed.

## More Information

Changing execution order, adding claim expiry or adding a second worker type are protocol changes. Each needs its own record and a check against the real worker.
