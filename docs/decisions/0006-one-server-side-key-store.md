---
status: accepted
date: 2026-11-14
---

# Keep provider API keys in one server-side store

## Context and Problem Statement

Generation with a provider API needs the user's key. Three entry points can start a generation: the web panel, the MCP server and background execution. An early design kept the key in an encrypted browser cookie, which only the web panel can present. Where does the key live so that all three entry points can use it safely?

## Decision Drivers

- All entry points must use the same key without the user entering it three times.
- The key must not appear in logs, API responses, job records or synced data.
- Storage must work locally and in a Cloudflare deployment.
- Encryption must mean something: the secret that protects the key must not sit beside it.

## Considered Options

- One server-side key store used by every entry point
- An encrypted cookie in the browser
- Environment variables only

## Decision Outcome

Chosen option: "One server-side key store used by every entry point", because it is the only option that serves the panel, MCP and background work alike.

Rules:

- One accessor reads the key. The panel, the MCP server and background execution all call it.
- Locally the key is stored on the user's machine, protected by the operating system keychain where available, otherwise in a file readable only by the user.
- In a Cloudflare deployment the key is a platform secret.
- The panel shows whether a key is connected and lets the user remove it. It never shows the key again.
- Keys are never written to job records, logs or anything that is synced between machines.

### Consequences

- Good, because agents and background jobs can generate without a browser session.
- Good, because there is one place to audit.
- Bad, because a key at rest on disk is only as safe as the machine and the place its protecting secret is kept.
- Bad, because every machine needs its own key entry, since keys are not synced.

### Confirmation

- A test checks that log output and API responses never contain a stored key.
- A test checks that the MCP server and the panel resolve the key through the same accessor.
- A review item confirms where the protecting secret is stored on each platform.

## Pros and Cons of the Options

### One server-side key store

- Good, because it works for every entry point.
- Bad, because it needs platform-specific storage code.

### An encrypted cookie in the browser

- Good, because the server stores nothing.
- Bad, because MCP and background execution cannot use it.

### Environment variables only

- Good, because it is simple and familiar.
- Bad, because the key cannot be changed from the panel and tends to end up in shell history and configuration files.

## More Information

This record replaces the cookie design from the first project plan.
