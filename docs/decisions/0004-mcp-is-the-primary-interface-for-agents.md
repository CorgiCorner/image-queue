---
status: accepted
date: 2026-11-14
---

# MCP is the primary interface for agents

## Context and Problem Statement

The main users of image-queue are coding agents, not people clicking in a browser. Until now agents ordered images by running shell scripts and polling for a file. Every new agent needed those scripts explained. How should agents talk to image-queue?

## Decision Drivers

- Agents from different vendors must be able to connect without custom glue.
- An agent should discover what it can do from the tool itself.
- The web panel and the agent interface must not drift apart.
- Image data must not flood an agent's context.
- An agent must not be able to read or write arbitrary files through the service.

## Considered Options

- An MCP server exposing the same use cases as the web panel
- Shell scripts as the supported interface
- A REST API with per-agent instructions

## Decision Outcome

Chosen option: "An MCP server exposing the same use cases as the web panel", because it is the one interface that current agent clients share, and its tool descriptions tell an agent what is possible.

Rules for the server:

- Tools and web actions are thin adapters over the same core functions and validate input with the same schemas.
- The local transport is stdio. An HTTP transport inside the application is optional and requires a token.
- Results are returned as a file path or a link, never as image data.
- Requests are idempotent by a request key. The same key returns the existing job. The same output path with a different prompt is a conflict.
- Reading references and writing results is limited to folders the user has configured. Paths that escape those folders, including through symbolic links, are rejected.

### Consequences

- Good, because any MCP client can order and collect images after one configuration entry.
- Good, because the panel and agents cannot diverge: they call the same code.
- Bad, because MCP and its SDKs are still changing, so the server needs upkeep.
- Bad, because a local server that touches files is an attack surface and needs the folder limits above.

### Confirmation

- Every tool has a test that calls it through an in-memory transport.
- Path traversal and symbolic link escapes have their own tests.
- A smoke test has an agent order and collect one image using MCP only.

## Pros and Cons of the Options

### An MCP server

- Good, because it is self-describing and vendor-neutral.
- Bad, because clients differ in how they are configured, so the documentation must cover each one.

### Shell scripts

- Good, because they already work and need nothing installed.
- Bad, because each agent must be taught them, and errors come back as text to parse.

### A REST API

- Good, because it is familiar and easy to test.
- Bad, because agents do not discover it on their own, so it still needs instructions for each agent.

## More Information

The original scripts keep working because the queue protocol is unchanged. See [ADR-0002](0002-keep-the-existing-file-queue-protocol.md). Worker-side tools (claim, publish, finish) are not part of this decision.
