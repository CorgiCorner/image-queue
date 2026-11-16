# Verifying an image model

A successful model-list request confirms account access, not image generation or supported sizes. The release registry lives in `src/core/model-profiles.ts`. Never add a passing result based only on documentation or a mocked test.

For each model:

1. Check current official documentation and record the exact model ID, supported sizes, reference support and transparency support.
2. With a valid locally configured key, generate one image through the application's direct Image API adapter. Keep the request ID, requested parameters and actual dimensions read from the output file.
3. Submit a second request using the first image as a reference. Use a visible identifying mark and a small edit. Check that the reference was attached, the mark remains and the requested edit is present.
4. Save a public, redacted verification receipt with the date, model ID, parameters and observations. Do not include a key, account details, private prompt or local absolute path.
5. Add a registry entry with `verifiedAt`, the official documentation URL, size profile, and separate `generation` and `referenceEdit` evidence references. Validate it with `verifiedModelProfileSchema`.
6. Reconnect OpenAI in Settings, then confirm that the model appears in the composer and MCP `list_models`. Verify a requested size and an unsupported size through both entry points.

A test against a fake transport proves the request format only. It does not satisfy steps 2–3. Failed or ambiguous paid requests must not be automatically retried. A profile must not promise dimensions or capabilities that were not checked.

GPT Image 2.6 Flare and GPT Image 1.5 have verified 1024 × 1024 profiles: [Flare](verification/gpt-image-2.6-flare.md), [1.5](verification/gpt-image-1.5.md). Cached or discovered size profiles without an exact provider/model match in the verified registry are discarded at the application boundary. They cannot make a model selectable or authorize a generation attempt.
