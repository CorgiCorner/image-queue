import { thumbnailWidths } from "../core/thumbnail-widths";
import type { Storage } from "./types";

export function projectThumbnailKeys(records: unknown[]) {
  const keys = new Set<string>();
  for (const record of records) {
    const digest = (record as { hash?: string } | null)?.hash;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) continue;
    for (const size of thumbnailWidths) keys.add(`thumbs/${digest}/${size}.webp`);
  }
  return keys;
}

export async function existingProjectThumbnails(store: Storage, records: unknown[]) {
  const existing: string[] = [];
  for (const key of projectThumbnailKeys(records)) {
    if (await store.getBlob(key)) existing.push(key);
  }
  return existing;
}
