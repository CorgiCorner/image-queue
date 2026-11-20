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

Capabilities stated by the official documentation but not covered by a receipt may be added under `documentedOnly` ([ADR-0012](decisions/0012-model-profiles-with-documented-capabilities.md)). Remove an item from that list only after a receipt covers it.

Cached or discovered size profiles without an exact provider/model match in the registry are discarded at the application boundary. They cannot make a model selectable or authorize a generation attempt.

## Current profiles

Checked against the official documentation on 2026-11-19. Capabilities are stored per model ID, including dated snapshots; nothing is inherited across a family. "Custom" means `WIDTHxHEIGHT` with both sides multiples of 16, longest side at most 3840, ratio 1:3 to 3:1 and 655,360 to 8,294,400 pixels. "Standard" means 1024x1024, 1536x1024 and 1024x1536. Every listed model accepts reference images through the edits endpoint.

| Model | Sizes | Transparent | Quality | Complexity | Output formats | Receipts |
|-|-|-|-|-|-|-|
| `gpt-image-2.6-sunburst` (default) | Custom | Yes | low, medium, high, xhigh, max, auto | low, medium, high (API default high) | png, webp, jpeg, gif, svg | None: documentation only |
| `gpt-image-2.6-flare` | Custom | Yes | low, medium, high, xhigh, max, auto | low, medium, high (API default high) | png, webp, jpeg, gif, svg | Opaque 1024 × 1024 and a reference edit ([receipt](verification/gpt-image-2.6-flare.md)) |
| `gpt-image-2.5-sunburst`, `-2026-09-08` | Custom; above 2560x1440 experimental | Yes | low, medium, high, xhigh, max, auto | None | png, webp, jpeg | None |
| `gpt-image-2.5-flare`, `-2026-09-08` | Custom; above 2560x1440 experimental | Yes | low, medium, high, xhigh, max, auto | None | png, webp, jpeg | None |
| `gpt-image-2`, `-2026-04-21` (deprecated) | Custom | Preview | low, medium, high, auto | None | png, webp, jpeg | None |
| `gpt-image-1.5` (deprecated) | Standard | Yes | low, medium, high, auto | None | png, webp, jpeg | Square, portrait, transparent and reference edits ([receipt](verification/gpt-image-1.5.md)) |
| `gpt-image-1-mini` (deprecated) | Standard | Yes (not stated per model) | low, medium, high, auto | None | png, webp, jpeg | None |

`gpt-image-1` was shut down on 2026-10-23 and has no profile. Transparent output requires PNG or WebP.

Sources:

- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation): "GPT-Image-2.6" (complexity levels and default, SVG and GIF output), "Size and quality options" (custom size limits, xhigh and max for 2.5 and 2.6 Sunburst and Flare), transparency, and "Earlier GPT Image models" (GPT Image 2 sizes and qualities).
- [Create image reference](https://developers.openai.com/api/reference/resources/images/methods/generate): `background` (2.5 transparent, GPT Image 2 transparent in preview), `complexity` (low, medium, high), `quality`, `output_format` and `size`; `gpt-image-1` shutdown.
- Model pages: [2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst), [2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare), [2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2), [1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5), [1 mini](https://developers.openai.com/api/docs/models/gpt-image-1-mini) (edits endpoint, snapshots, deprecation).
- `@ai-sdk/openai` 4.0.118, which sends `complexity` and lists custom sizes for 2.5 and 2.6.

The OpenAI Platform playground also offers "Extra high" and "Max" complexity for 2.6 Sunburst. The API reference and the guide list only low, medium and high, so the profiles follow the API documentation.

An API request may set `outputFormat` to a value in that model's `outputFormats`. Omitting it stores PNG. The same request may set `frameCount` (2–16) and `frameDurationMs` (20–2000) only for GIF. SVG cannot be combined with reference images or frame settings, and each SVG job is its own generation with `n=1`. GIF output with reference images is not supported by this application yet. Queue requests cannot set a format or frame timing. Quality, complexity and output format are refused for queue requests and for models that do not list them. A transparent background is refused unless the format is PNG or WebP.

PNG, WebP and JPEG results are fitted to the requested exact size in that format. GIF keeps its animation when it can be fitted without upscaling; otherwise the generated animation is stored and the job records why fitting failed. SVG is stored as generated, and its width and height are the provider size. Exact sizes that are off the 16-pixel grid or below the minimum pixel count, such as 256 × 256 sprites, are generated at the smallest covering size and fitted down; sizes above the limits are refused, never upscaled.

`count` from 1 to 10 on an MCP or panel submission creates that many independent jobs with the same parameters. The first keeps the idempotency key; the rest use that key plus `-2` through `-N`. The whole submission is validated before any job is created. Replaying the same key and count returns those jobs. `request_images` counts every expanded job toward its 20-image cap. One job is still one image.
