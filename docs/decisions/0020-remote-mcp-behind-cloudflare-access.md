---
status: accepted
date: 2026-11-19
---

# Protect the hosted MCP endpoint with Cloudflare Access and run generation from a queue

## Context and Problem Statement

A Cloudflare deployment should be usable as a remote MCP connector from the Claude apps, including the mobile app, so that a user can submit and view image generations away from the computer. The hosted endpoint was protected by a static bearer token, while the panel was protected by Cloudflare Access. API generation ran inside the request that created the job.

The Claude apps connect to remote MCP servers from Anthropic's cloud. For user-level authorization they support OAuth 2.0 with Dynamic Client Registration or a Client ID Metadata Document, PKCE (S256) and discovery through protected resource metadata. A fixed request header is available only to some organizations as a beta. Remote tool calls can be cut off after about a minute and are limited to a few minutes. An image provider can take longer than that.

How should the hosted endpoint authenticate the Claude apps, and how should a remote request start a generation without being cut short?

## Decision Drivers

- The hosted endpoint must not be open, and must work with the OAuth flow the Claude apps support.
- The application should not implement and operate its own OAuth authorization server if the platform provides one.
- One identity check should protect the panel and MCP.
- A provider attempt must not be cut short by a client time limit, and must never be repeated automatically, because a repeat can be charged again.

## Considered Options

- Cloudflare Access with Managed OAuth in front of the whole deployment, with the application verifying the Access assertion, and generation from Cloudflare Queues
- An OAuth provider inside the Worker (`@cloudflare/workers-oauth-provider`) whose sign-in page is protected by Access
- Keep the static bearer token for the hosted endpoint
- Run generation inside the MCP request, or after the response with `waitUntil`

## Decision Outcome

Chosen option: "Cloudflare Access with Managed OAuth, and generation from Cloudflare Queues", because Access already protects the panel, Managed OAuth gives MCP clients a standard OAuth 2.1 flow with dynamic client registration and PKCE, and the origin receives the same signed assertion for a browser session and for an OAuth token.

Rules:

- One self-hosted Access application covers the deployment's custom domain, with Managed OAuth turned on, Claude's callback URLs on its redirect allowlist, and localhost and loopback clients allowed for Claude Code and Codex. The Worker is not reachable on `workers.dev` or preview URLs.
- The application verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience and expiry on every panel, API and MCP request, and accepts only identities whose e-mail address is in `IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS`. Without team domain, audience or allowlist, every request is rejected.
- The static MCP bearer token stays a local-only credential. The hosted endpoint does not accept it.
- On Cloudflare, a new API job is sent to the `image-queue-generation` queue and the request returns at once. The consumer runs one job per invocation, without automatic retries, and records an error that happens before the provider attempt as `failed`. A job whose lock is busy is offered again later rather than failed, because nothing was sent to the provider. D1 locks carry a lease longer than the consumer's 15-minute limit. Locally, generation runs as before.
- `view_image` returns a preview of a finished image as image content, so a client without MCP Apps views can show the result.

### Consequences

- Good, because no OAuth server code or token storage lives in the application.
- Good, because the panel and MCP share one sign-in and one allowlist.
- Good, because a client time limit no longer interrupts a paid attempt.
- Bad, because a deployment needs a Cloudflare Zero Trust organization, an Access application on a custom domain and, in practice, a Workers Paid plan: the free plan allows 10 ms of CPU time per request, less than the panel and the MCP server need.
- Bad, because Access token lifetimes and the redirect allowlist live in the Cloudflare dashboard, outside the repository.
- Neutral, because the queue consumer is a second entry point that must set up the same runtime context as a request.

### Confirmation

- Tests check that the hosted endpoint rejects requests without an assertion, with a forged or expired assertion, with another audience, with an unlisted e-mail address and with the static token.
- Tests check that a Cloudflare API job is queued, that a queue failure is recorded before any provider request, and that the consumer acknowledges each message once.
- `scripts/cloudflare-acceptance.mjs` runs the deployable bundle in the local Workers runtime with D1, R2 and Queues, a synthetic Access key set and a stub provider, and checks discovery, rejection, one generation end to end and a single provider call.

## Pros and Cons of the Options

### An OAuth provider inside the Worker

- Good, because it works without Managed OAuth.
- Bad, because the application would own client registration, token storage, rotation and revocation.
- Bad, because the sign-in page still needs Access or another identity check.

### Keep the static bearer token

- Good, because it is simple.
- Bad, because the Claude apps do not offer a fixed header to most users, and a shared static secret cannot be scoped or rotated per client.

### Generation inside the request or with `waitUntil`

- Good, because it needs no queue.
- Bad, because a client time limit or the 30-second limit after a response can end the attempt, leaving an uncertain, possibly charged result.

## More Information

This record extends [ADR-0004](0004-mcp-is-the-primary-interface-for-agents.md) for the hosted transport and keeps [ADR-0006](0006-one-server-side-key-store.md): the provider key is a Cloudflare platform secret.
