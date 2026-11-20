import type { CompactApp } from "./compact-app";

type PreviewApp = Pick<CompactApp, "callServerTool" | "readServerResource">;

/**
 * Load a finished image's preview, or reject when it is unavailable.
 * The app-only tool goes first: some hosts proxy a view's tool calls but read only
 * the ui:// resource a tool names. The private resource stays as the fallback and is
 * skipped once the caller no longer wants the preview. `animated` asks for the
 * frames of a GIF and reports whether the preview kept them.
 */
export async function loadPreview(app: PreviewApp, id: string, stale: () => boolean, options: { animated?: boolean } = {}) {
  try {
    const result = await app.callServerTool({ name: "read_thumbnail", arguments: options.animated ? { id, animated: true } : { id } });
    const image = result?.isError ? undefined : result?.content?.find(item => item.type === "image");
    if (image?.type === "image" && image.data && image.mimeType.startsWith("image/")) {
      const note = result?.content?.find(item => item.type === "text");
      let animated = false;
      try {
        animated = note?.type === "text" && JSON.parse(note.text)?.animated === true;
      } catch {
        // An older server sends the image alone.
      }
      return { url: `data:${image.mimeType};base64,${image.data}`, animated };
    }
  } catch {
    // The host or an older server may not offer the tool.
  }
  if (stale()) throw new Error("Preview no longer needed");
  const resource = await app.readServerResource({ uri: `image-queue://thumbnail/${encodeURIComponent(id)}` });
  const asset = resource?.contents?.find(item => "blob" in item);
  if (asset && "blob" in asset && asset.blob && asset.mimeType?.startsWith("image/"))
    return { url: `data:${asset.mimeType};base64,${asset.blob}`, animated: false };
  throw new Error("Preview unavailable");
}

/** The still preview as a data URL. */
export async function loadThumbnail(app: PreviewApp, id: string, stale: () => boolean) {
  return (await loadPreview(app, id, stale)).url;
}
