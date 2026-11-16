# Passing references to an image worker

## Accepted reference files

Reference attachments must be real PNG, JPEG (`.jpg`/`.jpeg`) or WebP images, up to 20 MB each. SVG, GIF, PDF, Markdown/text files and URLs are not accepted as image references. Convert an unsupported source to PNG before importing or submitting it; changing the filename extension is not conversion. Verify that every file exists and is a valid image. Never omit an invalid reference silently or replace it with a text description. Through MCP, call `add_reference` for each image and pass its returned ID in `referenceIds`.


The dashboard uploads dropped images and writes their exported paths to the queue's `References` line. The worker must attach those files to its generation call; inspecting them alone is insufficient.

The single maintained instruction source is [WORKER.md](../WORKER.md). Do not copy its body into every scheduler. A scheduler supplies its slot, worker identity, application directory and Node executable, then reads that file on each wake.

The helper's `generation` envelope contains the literal prompt, ordered paths, dimensions, mode and tool arguments. Its `ready` flag must be true. With a path-capable tool, pass `referenced_image_paths`; otherwise explicitly include the current references using the supported image-count parameter. A missing file, unsupported attachment or tool refusal blocks the request. Text-only fallback is forbidden.

New reservations require `publish --generation-receipt FILE.json`. Record the actual submitted prompt, ordered `referencePaths`, attachment parameter/value and worker instruction version. The helper rejects a changed prompt or reference list and saves the receipt beside the result as `.generation.json`. Older version 1 reservations remain compatible with their original publication contract.

Verification compares the saved request, files and actual tool call. A self-reported receipt alone cannot prove an untrusted worker attached the inputs. Run the three-request marked-image self-check from WORKER.md after changing instructions and inspect every result. A changed or missing marker fails the check.
