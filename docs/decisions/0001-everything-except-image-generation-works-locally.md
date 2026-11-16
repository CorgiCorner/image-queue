---
status: superseded by ADR-0014
date: 2026-11-14
---

# Everything except image generation works locally

> ADR-0014 supersedes the mandatory LAN sync transport. Its other local-first guarantees are preserved in ADR-0014. This text remains the historical decision.

## Context and Problem Statement

image-queue takes image requests from coding agents, routes them to something that can generate them, and keeps the results. People run it next to their agents, on their own machines, often with a subscription they already pay for. Which parts of the product are allowed to depend on a service outside the user's own machines?

## Decision Drivers

- Users should own their prompts, references and images.
- The tool must be usable without an account, a sign-up or a server run by the project.
- A user with two machines on one network should not need the internet to keep them in step.
- Image generation cannot run locally today for the models people want to use.
- The project has one maintainer and cannot operate infrastructure for other people.

## Considered Options

- Local-first: every feature except generation has a local path
- Cloud-first: a hosted service with a thin local client
- Hybrid: local core, with a cloud service required for sync and sharing

## Decision Outcome

Chosen option: "Local-first: every feature except generation has a local path", because it is the only option that meets the ownership and no-account drivers and needs no infrastructure from the project.

The rule that follows from it:

- The queue, projects, the gallery, references, search, settings, the MCP server and sync between a user's machines all work with no service outside the user's own machines.
- Sync between machines works over the local network. See [ADR-0007](0007-sync-between-machines-over-ssh.md).
- Image generation is the one exception. It needs a Codex subscription or a provider API.
- The exception is not a principle. If a local model becomes a realistic source, it is added as another source and the exception shrinks.
- A cloud deployment is allowed as an option. See [ADR-0003](0003-plain-files-behind-a-storage-interface.md). No feature may exist only there.

### Consequences

- Good, because prompts, references and images never leave the user's machines unless the user sends them to a provider.
- Good, because the project runs no servers, so there is no hosting cost and no outage that takes users down.
- Good, because the tool keeps working if the project stops being maintained.
- Bad, because sync and access from several devices are harder to build than with a central server.
- Bad, because the queue only moves while the user's machine is on.
- Bad, because there is no hosted trial. Trying the product means installing it.
- Bad, because every feature needs a local design first, even when a cloud version would be quicker to ship.

### Confirmation

- The test suite runs with network access disabled. Only tests that replace a generation source with a fake are exempt.
- A pull request that adds a feature states its local path. A feature that works only in a cloud deployment is not merged.
- Public claims such as "runs on your machine" are checked against this record before each release.

## Pros and Cons of the Options

### Local-first: every feature except generation has a local path

- Good, because it matches how the tool is used: next to local agents and local files.
- Good, because it needs no accounts and no operations work.
- Bad, because multi-machine features need their own design. See [ADR-0007](0007-sync-between-machines-over-ssh.md).

### Cloud-first: a hosted service with a thin local client

- Good, because sync, sharing and access from anywhere come almost for free.
- Bad, because the Codex queue runs where the Codex app runs, so a hosted service could not work it anyway.
- Bad, because it requires accounts, hosting and support that one maintainer cannot provide.
- Bad, because users' prompts and images would sit on someone else's servers.

### Hybrid: local core, with a cloud service required for sync and sharing

- Good, because single-machine use stays local.
- Bad, because the first user with two machines hits a sign-up wall.
- Bad, because it still needs a service operated by the project.

## More Information

Revisit this record when a local image model is good enough to offer as a source. At that point the exception for generation can be narrowed or removed.
