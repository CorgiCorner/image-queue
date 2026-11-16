---
status: superseded by ADR-0014
date: 2026-11-14
---

# Sync between a user's machines over SSH, without a shared queue

## Context and Problem Statement

A user may run image-queue on two machines, each with its own workers, and wants one complete collection visible from the machine that runs the panel. [ADR-0001](0001-everything-except-image-generation-works-locally.md) requires that this works on the local network with no outside service. The queue relies on a file lock, which only works within one machine. How do two machines stay in step?

## Decision Drivers

- No service outside the user's own machines.
- A request must never be generated twice because two machines claimed it.
- The existing queue protocol must stay unchanged on each machine. See [ADR-0002](0002-keep-the-existing-file-queue-protocol.md).
- Setup should use something developers already have.
- Keys must not travel between machines. See [ADR-0006](0006-one-server-side-key-store.md).

## Considered Options

- Separate queues per machine, results replicated over SSH, work shared by assignment
- A file sync tool pointed at the queue directory
- One machine as the claim authority for a shared queue
- A cloud hub as the claim authority

## Decision Outcome

Chosen option: "Separate queues per machine, results replicated over SSH, work shared by assignment", because it gives one collection and shared work without any lock that spans machines.

How it works:

- Every machine has a machine identifier. Every job and result records the machine it came from.
- Identifiers for jobs and results are globally unique, not counters local to one machine.
- Each machine keeps its own queue and its own workers. A worker only ever claims from its local queue.
- A job carries the machine assigned to run it. A machine adds to its local queue only the jobs assigned to it.
- Reassignment is allowed only for jobs that no worker has claimed, and only one machine performs it.
- Results and references are immutable files named by content hash. They are copied in both directions and never conflict.
- Records are one file each. Fields a user can edit carry a change time, and the latest change wins per field.
- The transport is SSH: file copy for images and records, using keys the user already has. Peers are listed in configuration.
- The queue file, lock files, thumbnails and API keys are never synced.

### Consequences

- Good, because no distributed lock exists, so double generation cannot happen by design.
- Good, because it needs no new service and no internet connection.
- Good, because each machine keeps working when the other is off, and catches up later.
- Bad, because a job assigned to a machine that is off waits until it is reassigned.
- Bad, because "latest change wins" can drop one of two edits made to the same field at the same time.
- Bad, because the user must set up SSH access between the machines.

### Confirmation

- A test syncs two temporary stores in both directions and checks that the result is the same on both sides whatever the order.
- A test checks that a job assigned to machine A never enters machine B's queue.
- A test checks that the queue file, locks, thumbnails and keys are excluded from every transfer.

## Pros and Cons of the Options

### Separate queues, replication over SSH, assignment

- Good, because it reuses the single-machine design unchanged.
- Bad, because an idle machine does not take over another machine's backlog on its own.

### A file sync tool pointed at the queue directory

- Good, because it needs no code.
- Bad, because file locks do not cross machines, so two workers can claim the same request.
- Bad, because one file written by several machines produces conflict copies or lost entries.

### One machine as the claim authority

- Good, because both machines work one shared backlog.
- Bad, because the queue stops when that machine is unreachable, and workers need a network claim operation the protocol does not have.

### A cloud hub as the claim authority

- Good, because it also gives access from anywhere.
- Bad, because it cannot be the only way to sync, under [ADR-0001](0001-everything-except-image-generation-works-locally.md). It may exist as an option.

## More Information

Open questions before this record is accepted:

- Are identifiers in the existing queue unique across machines, or only within one queue file?
- Is file copy over SSH enough, or does sync need a small command on the remote side to list what changed?
- Should peers be found automatically on the local network later, or stay as explicit configuration?
