# GPT Image 1.5 verification

Verified 2026-11-15 through the real application Image API adapter.

- Model: `gpt-image-1.5`.
- Tested profile: fixed `1024 × 1024`, opaque PNG. Additional checks are listed below.
- Generation: red mug on white, with `REF-7391` at top left; output dimensions 1024 × 1024.
- Reference edit: change the mug to blue, preserve the text and layout. One reference attached; output dimensions 1024 × 1024. Visually checked: blue mug, identifying text retained.
- No retries or alternate model were used.
- Documentation: https://developers.openai.com/api/docs/models/gpt-image-1.5

## Generation

The generated red mug and identifying text were visually checked.

## Reference edit

The blue mug and retained identifying text were visually checked.

Output SHA-256:

- `generation.png`: `186806b5629e87c68dcf80c70b554620f142b7ca17996fc427bfc3e7dbb56a75`
- `edit.png`: `fe5b5bb999ee4e896bb4c923871423badbd81ade49d8cfe8b2e266b89de3ab16`


## Portrait and transparent reference edits

Verified 2026-11-17 through the application Image API adapter.

- Two portrait reference edits with five ordered PNG references retained the literal prompt and returned PNGs at the requested 1024 × 1536. No upscaling or automatic retry was performed.
- Six transparent reference edits with six ordered PNG references were fitted down from native square output to 256 × 256. Every delivered PNG has transparent pixels. No automatic retry was performed.
