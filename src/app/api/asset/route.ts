import { thumbnailWidths } from "@/core/thumbnail-widths";
import { configuration } from "@/core/config";
import { accessDeniedResponse } from "@/core/access-response";
import { hash, type Job } from "@/core/schema";
import { thumbnail } from "@/sources/thumbnail";
import { storage } from "@/storage";
const pendingThumbnails = new Map<string, ReturnType<typeof thumbnail>>();

function renderThumbnail(bytes: Uint8Array, size: number, key: string) {
  if (configuration("STORAGE_DRIVER") === "cloudflare") return thumbnail(bytes, size);
  const pending = pendingThumbnails.get(key);
  if (pending) return pending;
  const result = thumbnail(bytes, size).finally(() => pendingThumbnails.delete(key));
  pendingThumbnails.set(key, result);
  return result;
}

export async function GET(request: Request) {
  const denied = await accessDeniedResponse(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const store = await storage();
    const id = params.get("job");
    const job = id ? await store.get<Job>("jobs", id) : undefined;
    if (id && (!job || (job.status !== "done" && !(job.status === "blocked" && job.blobKey)))) {
      return new Response("Not found", { status: 404 });
    }
    const requestedSize = Number(params.get("thumb"));
    const size = thumbnailWidths.includes(requestedSize)
      ? requestedSize
      : 320;
    const metadata = id
      ? await store.get<{ hash: string; dominantColor: string }>(
          "asset-meta",
          id,
        )
      : undefined;
    let thumbnailKey = metadata
      ? `thumbs/${metadata.hash}/${size}.webp`
      : undefined;
    let blob =
      params.has("thumb") && thumbnailKey
        ? await store.getBlob(thumbnailKey)
        : undefined;
    if (blob)
      return new Response(blob.bytes as BodyInit, {
        headers: {
          "Content-Type": blob.mime,
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    if (job) {
      if (job.blobKey) blob = await store.getBlob(job.blobKey);
      else if (
        job.source === "queue" &&
        configuration("STORAGE_DRIVER") !== "cloudflare"
      ) {
        const { queueOutput, configuredQueueRoot } = await import("@/sources/queue");
        blob = {
          bytes: await queueOutput((await configuredQueueRoot()), job),
          mime: "image/png",
        };
      }
    } else if (params.has("key")) {
      const key = params.get("key")!;
      const references =
        await store.list<import("@/core/schema").Reference>("references");
      if (!references.some((reference) => reference.blobKey === key))
        return new Response("Not found", { status: 404 });
      blob = await store.getBlob(key);
    }
    if (!blob) return new Response("Not found", { status: 404 });
    if (params.has("thumb") && blob.mime.startsWith("image/")) {
      const digest = await hash(blob.bytes);
      thumbnailKey = `thumbs/${digest}/${size}.webp`;
      let preview: Awaited<ReturnType<typeof renderThumbnail>>;
      try {
        preview = await renderThumbnail(blob.bytes, size, thumbnailKey);
      } catch {
        return new Response("Thumbnail unavailable", {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
      try {
        if (id) {
          await store.put("asset-meta", id, {
            id,
            hash: digest,
            dominantColor: preview.dominantColor ?? metadata?.dominantColor,
          });
        }
        await store.putBlob(thumbnailKey, preview.bytes, preview.mime);
      } catch {
        // The thumbnail is usable even when a concurrent request holds the cache write lock.
      }
      blob = preview;
    }
    if (blob.mime.startsWith("video/")) {
      const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/i);
      const length = blob.bytes.byteLength;
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(length - 1, Number(range[2])) : length - 1;
        if (start > end) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${length}` } });
        }
        return new Response(blob.bytes.subarray(start, end + 1) as BodyInit, {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${length}`,
            "Content-Length": String(end - start + 1),
            "Content-Type": blob.mime,
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }
    return new Response(blob.bytes as BodyInit, {
      headers: {
        "Content-Type": blob.mime,
        ...(blob.mime.startsWith("video/") ? {
          "Accept-Ranges": "bytes",
          "Content-Length": String(blob.bytes.byteLength),
        } : {}),
        "Cache-Control": params.has("thumb")
          ? "private, max-age=31536000, immutable"
          : "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
