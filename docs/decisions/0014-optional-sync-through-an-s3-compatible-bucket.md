---
status: accepted
date: 2026-11-15
---

# Optional sync between machines through an S3-compatible bucket

## Context and Problem Statement

A user may run image-queue on two or more machines, each with its own workers and its own project folders, and wants one collection visible on all of them.
[ADR-0007](0007-sync-between-machines-over-ssh.md) proposed copying files between machines over SSH.
That needs both machines online at the same time, SSH access set up between them, and a separate answer for files that live in the user's own folders on one machine only.
How do machines stay in step with less setup and without both being online?

## Decision Drivers

* Every single-machine feature except generation must still work with no outside service. This decision replaces ADR-0001's mandatory local-network sync transport with optional S3 replication; its other local-first guarantees remain in force.
* A request must never be generated twice because two machines claimed it.
* The existing queue protocol stays unchanged on each machine. See [ADR-0002](0002-keep-the-existing-file-queue-protocol.md).
* Machines are often not online at the same time.
* Keys must not travel between machines. See [ADR-0006](0006-one-server-side-key-store.md).
* No lock-in to one storage provider.

## Considered Options

* An S3-compatible bucket as an optional replica, queues stay local
* Copying files between machines over SSH
* A file sync tool pointed at the store or the queue
* A hosted database plus object storage as the only store

## Decision Outcome

Chosen option: "An S3-compatible bucket as an optional replica, queues stay local", because it removes the need for both machines to be online, needs one credential instead of access between machines, and treats every image the same way wherever it lives on disk.

How it works:

* Sync is off by default. Without a bucket every machine works alone and loses nothing.
* The local store stays the source of truth for a machine. The bucket is a replica that machines push to and pull from.
* Images and references are immutable objects keyed by content hash.
* Every record is one object. Fields a user can edit carry a change time and the machine that changed them, and the latest change wins per field.
* Every machine appends the keys it changed to its own change log in the bucket. Other machines read the logs instead of listing the whole bucket.
* Writes use conditional requests, so two machines cannot silently overwrite each other.
* Each machine keeps its own queue and its own workers. A worker only ever claims from its local queue.
* A job carries the machine assigned to run it. Only that machine adds it to a queue and only that machine writes its execution state.
* The queue file, lock files, API keys, bucket credentials, absolute paths and the search index never leave a machine.
* The code talks to the S3 API. Cloudflare R2 is the first provider tested.

### Consequences

* Good, because no lock spans machines, so double generation cannot happen by design.
* Good, because a machine that was off catches up from the bucket when it returns.
* Good, because the same replica gives access to the collection from outside the local network.
* Good, because files in the user's own folders need no special rule: whatever is in the collection is uploaded by hash.
* Bad, because prompts and images are stored with an outside provider once sync is on.
* Bad, because an idle machine does not take over another machine's backlog on its own.
* Bad, because "latest change wins" can drop one of two edits made to the same field at nearly the same time.
* Bad, because the provider must support conditional writes, which has to be checked when connecting.

### Confirmation

* A test syncs two temporary stores through a local S3 stand-in in every order and checks both end in the same state.
* A test checks that a job assigned to machine A never enters machine B's queue.
* A test lists every key written to the bucket and checks none comes from the queue file, lock files, key store or search index, and no object contains an absolute path.
* A test checks that connecting to a provider without conditional writes is refused.
* A test runs two machines with clocks five minutes apart and checks the later edit still wins.

## Pros and Cons of the Options

### S3-compatible bucket as an optional replica

* Good, because it reuses the single-machine design unchanged.
* Good, because R2, AWS S3 and self-hosted MinIO all fit behind one interface.
* Bad, because there is no push from the bucket, so machines poll.

### Copying files over SSH

* Good, because nothing leaves the user's machines.
* Bad, because both machines must be online together and the user must set up access between them.

### A file sync tool pointed at the store or the queue

* Good, because it needs no code.
* Bad, because file locks do not cross machines and records written by two machines produce conflict copies.

### A hosted database plus object storage as the only store

* Good, because there is one copy of everything.
* Bad, because it breaks [ADR-0001](0001-everything-except-image-generation-works-locally.md). It remains available as the separate Cloudflare storage driver.

## More Information

Open questions:

* Should records and images be encrypted on the machine before upload?
* Which machine removes unreferenced images from the bucket, and how do two machines avoid doing it at once?
* How do two machines on different app versions agree on a record format?
* Are identifiers in the existing queue unique across machines, or only within one queue file?

This record supersedes ADR-0007 and the mandatory LAN-only sync clause in ADR-0001. Queueing, projects, the gallery, references, search, settings and MCP continue to work locally without accounts or an outside service. Sync is an explicit opt-in that sends collection data to the user-selected bucket.

