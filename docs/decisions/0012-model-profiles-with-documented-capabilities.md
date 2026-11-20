---
status: accepted
date: 2026-11-19
---

# Keep one model profile registry and mark documented-only capabilities

## Context and Problem Statement

API generation uses a static registry of model profiles (`src/core/model-profiles.ts`). Until now an entry could list only what a paid test generation had confirmed. GPT Image 2.6 Flare was therefore limited to opaque 1024 × 1024 images, although OpenAI documents custom sizes from 655,360 to 8,294,400 pixels and transparent backgrounds for it. Game assets need non-square and transparent output. A paid test of every option is not always possible, for example when the API account has no credit. How can agents use a model's real options without the application promising results it never checked?

## Decision Drivers

- Agents and the panel must see what the provider accepts, not an outdated subset.
- Unsupported options must be refused before a paid attempt, never silently dropped.
- Users must be able to tell which capabilities a real generation has confirmed.

## Considered Options

- Profiles list only generation-verified capabilities
- Profiles list documented capabilities and mark those not yet verified
- Read capabilities from the provider at runtime

## Decision Outcome

Chosen option: "Profiles list documented capabilities and mark those not yet verified". Each model ID, including dated snapshots, has its own entry; capabilities are never inherited across a model family. An entry may add capabilities stated by the provider's official documentation; each such capability is named in `documentedOnly` until a receipt covers it. An entry without any generation and reference-edit receipt is allowed only when `documentedOnly` names both "generation" and "reference edit", and it reports `generationVerified: false`. `list_models` and `get_generation_source` return these fields. The first registry entry is the preferred default model. Every request is validated against the profile before submission: sizes, transparency, quality and references. After generation, the application measures the output dimensions and transparency as before, so a provider that ignores an option produces a visible mismatch rather than a silent success.

Runtime discovery is not used: the OpenAI model list does not return image sizes or options.

### Consequences

- Good, because the owner's chosen model can be used for non-square and transparent assets.
- Good, because the evidence level of each capability remains visible.
- Bad, because a model with documentation-only support can be selected and billed before any receipt exists; `generationVerified: false` makes that visible.
- Bad, because a documented option can still fail at the provider. Such a failure is reported on the attempt and is not retried automatically.
