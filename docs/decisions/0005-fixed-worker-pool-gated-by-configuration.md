---
status: superseded by ADR-0016
date: 2026-11-14
---

# Control Codex workers through a fixed pool gated by configuration

## Context and Problem Statement

The Codex queue is worked by scheduled chats in the Codex app. The user wants to set, from image-queue, how many workers are active and how often they check the queue. Scheduled tasks cannot be created from the command line, only in the app or by asking in a chat. How does image-queue control the workers?

## Decision Drivers

- A change in settings should take effect predictably, without an agent managing other agents.
- The panel must show what is actually running, not only what was requested.
- A typing mistake in settings must not create dozens of scheduled tasks.
- Stopping a worker must not strand a claimed request, because claims do not expire.

## Considered Options

- A fixed pool of worker slots that read a configuration file on every wake-up
- A supervisor chat that creates, updates and deletes scheduled tasks to match the configuration
- Manual management in the Codex app only

## Decision Outcome

Chosen option: "A fixed pool of worker slots that read a configuration file on every wake-up", because it is deterministic and needs no agent with the power to create or delete other scheduled tasks.

How it works:

- The user creates a fixed number of numbered worker slots once.
- image-queue writes the desired state to a configuration file: number of active workers, idle interval, active interval and the length of the activity window.
- Each slot reads the file when it wakes. A slot above the active count, or one that woke before its interval passed, exits at once.
- Each slot writes a heartbeat. image-queue shows desired state and observed state side by side.
- A slot that is switched off finishes the image it is working on before it stops.

### Consequences

- Good, because settings take effect on the next wake-up with no further coordination.
- Good, because the number of slots is a hard upper limit.
- Good, because heartbeats reveal a closed app or a stuck worker.
- Bad, because idle slots still wake up and spend a little before exiting.
- Bad, because the effective interval can only be a multiple of the slot's own schedule. Going faster than that needs a change in the Codex app.

### Confirmation

- Worker health is derived from heartbeats and is visible outside the settings page.
- A test covers the gate: slot number above the active count, interval not yet elapsed, and the switch-off case with a claimed request.

## Pros and Cons of the Options

### A fixed pool gated by configuration

- Good, because behavior is simple to reason about and to test.
- Bad, because the pool size is fixed until the user adds slots by hand.

### A supervisor chat

- Good, because it could grow and shrink the pool and change schedules without manual work.
- Bad, because it depends on an unattended chat reliably managing scheduled tasks, which has not been verified.
- Bad, because a mistake could create many tasks or delete the wrong ones.

### Manual management only

- Good, because it needs no code.
- Bad, because the panel could neither control nor report on workers.

## More Information

A supervisor can be added later for the two things the pool cannot do: exceed the fixed size and shorten the base schedule. That would be a new record.
