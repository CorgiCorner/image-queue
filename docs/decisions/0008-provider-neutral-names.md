---
status: accepted
date: 2026-11-14
---

# Use provider-neutral names for the product and its parts

## Context and Problem Statement

The project started under a working name that contained "codex", because the first source of images was a queue worked by Codex chats. More sources are planned: provider APIs, and possibly workers from other agents. What should the product, its packages and its internal parts be called?

## Decision Drivers

- The name must stay accurate when sources are added.
- Names that agents store in their configuration are expensive to change later.
- The name should say what the tool is.
- The domain and package names must be available.

## Considered Options

- `image-queue`, with neutral names inside the code
- Keep the working name with "codex" in it
- A joke name built on an acronym

## Decision Outcome

Chosen option: "`image-queue`, with neutral names inside the code", because it describes the tool, survives any change of provider, and the domain and package names were free.

What this means in practice:

- The product, repository, package, MCP server name and command are all `image-queue`, spelled the same way everywhere.
- The queue adapter is named for what it is, an agent queue. Codex is a value of a `worker` field, not the name of a module.
- Environment variables use the `IMAGE_QUEUE_` prefix.
- Results record the provider and model that produced them.
- "Codex queue" remains acceptable as a label in the interface for that specific source.

### Consequences

- Good, because adding a provider or a worker type changes data, not names.
- Good, because agent configurations written today stay valid.
- Bad, because the name has "image" in it, and video may become an output later.
- Bad, because a descriptive name is harder to search for than an invented one.

### Confirmation

- A search of the repository finds no provider name in package names, module names, environment variables or MCP identifiers.

## Pros and Cons of the Options

### `image-queue`

- Good, because it is plain and accurate.
- Bad, because it is generic.

### Keep the working name

- Good, because nothing needs renaming.
- Bad, because it becomes wrong with the first non-Codex source.

### A joke name

- Good, because it is memorable.
- Bad, because the maintainer does not expect to like it in the long term.

## More Information

Names considered and rejected because they were already taken in the same category are not listed here on purpose. Availability changes, and the check should be repeated before any future rename.
