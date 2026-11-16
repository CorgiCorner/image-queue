---
status: accepted
date: 2026-11-16
---

# Use kernel locks for local storage operations

## Context and Problem Statement

Local storage used empty directories as locks. A process killed during a purge left those directories behind, preventing recovery of the persisted operation journal. How can storage recover without ever expiring a live operation's lock?

## Considered Options

- Kernel advisory locks on persistent files
- Expiring directory locks using a heartbeat or process identifier
- Manual removal after every crash

## Decision Outcome

Chosen option: kernel advisory locks on persistent files, using `fs-native-extensions`. The operating system releases the lock when its owning descriptor or process closes. Files remain in place so all contenders lock the same inode. No timeout or PID heuristic can take a live lock away.

The disk driver atomically opens a persistent `.kernel` file for each lock. It first checks the old `.lock` directory path. A legacy empty directory is treated as busy: it cannot safely be distinguished from an older live application's lock. Migration of such directories requires stopping every process using that store first. These locks are local to one machine; a shared network filesystem is not a supported coordination boundary. New and old application versions must not write the same store concurrently.

This changes application storage locking only. Queue adapter locks, worker claims, fingerprints and the queue file protocol remain unchanged under ADR-0002. Cloudflare and memory drivers retain their own locking implementations.

### Consequences

- Good, because an abruptly terminated local operation can be recovered from its journal.
- Good, because a suspended live process cannot lose its lock to a timeout.
- Bad, because the disk driver gains a native dependency, which must have working prebuilt binaries on supported platforms.
- Bad, because lock files persist and older empty locks require explicit migration while the store is offline.

### Confirmation

- A separate process holds a lock; another process is refused while it lives.
- After SIGKILL, a successor acquires the same lock, and simultaneous successors never both enter.
- Legacy empty lock directories remain busy, and symbolic-link lock files are refused.
- A terminated purge is recovered from its persisted journal on reopening.

## More Information

[Native locking API](https://github.com/holepunchto/fs-native-extensions). Local macOS uses `flock`; Linux uses open-file-description locks. Deployment must keep store files on a filesystem providing those advisory lock semantics.
