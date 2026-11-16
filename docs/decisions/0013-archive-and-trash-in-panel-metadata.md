---
status: proposed
date: 2026-11-14
---

# Keep archive and trash in panel metadata, and never delete files outside the store by default

## Context and Problem Statement

Users need to put images and finished requests out of the way, one at a time and in bulk, and to get rid of them for good.
Blocked requests stay in the queue file, which the panel must not rewrite. See [ADR-0002](0002-keep-the-existing-file-queue-protocol.md).
Many results are files at paths an agent asked for, inside other projects, where image-queue only indexes them.
What do "archive", "trash" and "delete for good" mean, and what may they touch?

## Decision Drivers

* Putting things away must be fast and reversible, with no confirmation step.
* Deleting for good must never break a project that uses a generated file.
* The queue protocol and the queue file stay untouched.
* The same behavior must work on disk and on Cloudflare. See [ADR-0003](0003-plain-files-behind-a-storage-interface.md).
* A deleted item must not come back through sync. See [ADR-0007](0007-sync-between-machines-over-ssh.md).

## Considered Options

* Archive and trash as two timestamps in panel metadata, with a timed purge
* Trash only
* Immediate deletion with a confirmation dialog
* Removing entries from the queue file

## Decision Outcome

Chosen option: "Archive and trash as two timestamps in panel metadata, with a timed purge", because it is reversible, needs no change to the queue, and maps onto every storage driver.

Rules:

* Archive and trash are fields on the record: when it was archived, when it was trashed. Both are set and cleared only by the user.
* Archived items are hidden from default views and counts, are kept without limit, and remain searchable.
* Trashed items are hidden everywhere except the Trash view and are purged after the retention period, 30 days by default.
* Only records in a final state can be archived or trashed. A request that is waiting, claimed or running cannot.
* Trashing a blocked request hides it in the panel. Its entry in the queue file is left as it is.
* A purge removes the record, its thumbnails and any file the store owns. A file at a path outside the store is left on disk unless the user asks for it to be deleted in that purge.
* A stored file is deleted only when no other record refers to the same content hash.
* A purge leaves a small tombstone with the identifier and the time, so that sync does not bring the item back.
* Agents get no tool to trash or purge. Tools that list items skip archived and trashed ones by default.

### Consequences

* Good, because archive and trash are one write each and can be undone at once.
* Good, because a generated file used by another project survives unless the user says otherwise.
* Good, because the queue file never changes.
* Bad, because the queue file keeps entries the panel no longer shows.
* Bad, because "delete for good" can leave files on disk, which has to be explained at the moment of deleting.
* Bad, because a timed purge needs something that runs on a schedule in every deployment.

### Confirmation

* A test trashes and restores a record and checks that every view and count returns to its earlier state.
* A test purges a record whose file lies outside the store and checks that the file is still there.
* A test purges one of two records that share a content hash and checks that the stored file remains.
* A test checks that the queue file is byte-identical before and after trashing a blocked request.
* A test syncs a tombstone to a second store and checks that the item is removed there and does not return.

## Pros and Cons of the Options

### Two timestamps with a timed purge

* Good, because it matches what people know from mail and photo apps.
* Bad, because there are two places where hidden items live.

### Trash only

* Good, because there is one concept.
* Bad, because there is no way to hide something and keep it, which is what a prompt library needs.

### Immediate deletion with a confirmation dialog

* Good, because nothing lingers.
* Bad, because every clean-up asks a question, and a mistake cannot be undone.

### Removing entries from the queue file

* Good, because the file would match what the panel shows.
* Bad, because it breaks ADR-0002 and can invalidate a worker's claim.

## More Information

Open questions before this record is accepted:

* Does the protocol give a blocked entry any later life, so that hiding it in the panel could hide a change?
* Resolved by ADR-0014: an optional S3 replica is separate from the storage interface. Local records and replicated blobs are supported; the D1/R2 storage driver remains a separate deployment mode.
