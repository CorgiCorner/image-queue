# Architectural decisions

| ADR | Status | Decision |
| --- | --- | --- |
| [0000](0000-use-markdown-architectural-decision-records.md) | accepted | Use Markdown Architectural Decision Records |
| [0001](0001-everything-except-image-generation-works-locally.md) | superseded by ADR-0014 | Everything except image generation works locally |
| [0002](0002-keep-the-existing-file-queue-protocol.md) | accepted | Keep the existing file queue protocol as the source of truth |
| [0003](0003-plain-files-behind-a-storage-interface.md) | accepted | Store data as plain files behind a storage interface |
| [0004](0004-mcp-is-the-primary-interface-for-agents.md) | accepted | MCP is the primary interface for agents |
| [0005](0005-fixed-worker-pool-gated-by-configuration.md) | superseded by ADR-0016 | Control Codex workers through a fixed pool gated by configuration |
| [0006](0006-one-server-side-key-store.md) | accepted | Keep provider API keys in one server-side store |
| [0007](0007-sync-between-machines-over-ssh.md) | superseded by ADR-0014 | Sync between a user's machines over SSH, without a shared queue |
| [0008](0008-provider-neutral-names.md) | accepted | Use provider-neutral names for the product and its parts |
| [0009](0009-optional-mcp-apps-views.md) | proposed | Offer MCP Apps views as an optional layer over the MCP tools |
| [0013](0013-archive-and-trash-in-panel-metadata.md) | proposed | Keep archive and trash in panel metadata, and never delete files outside the store by default |
| [0014](0014-optional-sync-through-an-s3-compatible-bucket.md) | accepted | Optional sync between machines through an S3-compatible bucket |
| [0015](0015-portable-identities-without-renaming-worker-requests.md) | accepted | Add portable identities without renaming worker requests |
| [0016](0016-local-process-workers-for-codex.md) | accepted | Run Codex generation through application-owned local workers |
| [0017](0017-forward-worker-requests-verbatim.md) | accepted | Forward image-worker requests verbatim with explicit reference attachments |
| [0018](0018-kernel-locks-for-local-storage.md) | accepted | Use kernel locks for local storage operations |

0010–0012 remain reserved for idempotency, durable execution and model profiles. Proposed records remain proposals.

## ADR-0016

Application-owned local Codex process workers are the accepted default; see [ADR-0016](0016-local-process-workers-for-codex.md). It supersedes ADR-0005. Implementation and generation lifecycle tests are complete; final release acceptance is tracked separately. Deferred video sequences will use the next free ADR number.
