# Contributing

Use Node.js 24 or newer and the pnpm version recorded in package.json.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm coverage
pnpm check:boundaries
pnpm build
```

Coverage must stay at or above 90% of lines and 84% of branches. On a heavily loaded machine, use `pnpm exec vitest run --coverage --maxWorkers=1`; keep this separate from production builds.

Run `python3 docs/protocol/test-worker.py` when changing the queue helper. Tests use temporary stores and fake provider transports; do not add tests that spend provider credits by default.

Read accepted decisions in `docs/decisions` before design changes. Keep web actions and MCP adapters over the same validated core operations. Every feature needs a local path, and queue claims must preserve ownership, content fingerprints and existing workers' ability to finish.

For UI changes, use the existing components and spacing tokens. Include a focused test or a screenshot at the viewport/theme affected by the bug; verify actual rendered layout when changing geometry. Avoid including personal projects or filesystem paths in screenshots and fixtures.

Keep changes scoped to the current release plan. Synchronization, video sequences and broader animation work are separate follow-ups; do not mix them into a release fix. We do not accept credentials, private data, mandatory hosted services, silent paid retries or rewrites of claimed queue requests.
