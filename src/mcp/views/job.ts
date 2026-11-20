import { workersOfflineMessage } from "../../core/workspace-state";
import { isReserved, jobStatusLabels } from "../../core/job-status";
import type { Job } from "../../core/schema";
import {
  CompactApp,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from "./compact-app";
import { loadPreview } from "./thumbnail";
import { sourceLabel } from "./source-label";
import { isMotionReduced } from "../../lib/motion";
const app = new CompactApp({ name: "image-queue", version: "1.0.0" });
const status = document.querySelector<HTMLElement>("[role=status]")!;
const workerNotice = document.querySelector<HTMLElement>("#workers-offline");
if (workerNotice) workerNotice.textContent = workersOfflineMessage;
const source = document.querySelector<HTMLElement>("#source");
const prompt = document.querySelector<HTMLElement>("#prompt")!;
const path = document.querySelector<HTMLElement>("#path")!;
const copyPath = document.querySelector<HTMLButtonElement>("#copy-path");
copyPath?.addEventListener("click", async () => {
  const value = path.textContent;
  if (!value || disposed) return;
  try {
    await navigator.clipboard.writeText(value);
    if (!disposed && path.textContent === value) copyPath.textContent = "Copied";
  } catch {
    if (disposed || path.textContent !== value) return;
    const selection = window.getSelection();
    if (!selection) {
      copyPath.textContent = "Could not copy. Select the path above.";
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(path);
    selection.removeAllRanges();
    selection.addRange(range);
    copyPath.textContent = "Path selected. Copy it manually.";
  }
});
const openApp = document.querySelector<HTMLButtonElement>("#open-app");
openApp?.addEventListener("click", async () => {
  if (disposed || !id || openApp.disabled) return;
  const requestedId = id;
  openApp.disabled = true;
  try {
    const base = decodeURIComponent(document.body.dataset.dashboard ?? "");
    const url = new URL(`${base}/jobs/${encodeURIComponent(requestedId)}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const result = await app.openLink({ url: url.href });
    if (result.isError) throw new Error();
  } catch {
    if (!disposed && id === requestedId) status.textContent = "Could not open image-queue. Check that the dashboard is running.";
  } finally {
    openApp.disabled = false;
  }
});
const download = document.querySelector<HTMLButtonElement>("#download");
download?.addEventListener("click", async () => {
  if (disposed || !id || download.disabled) return;
  const requestedId = id;
  download.disabled = true;
  download.textContent = "Preparing…";
  try {
    if (app.canDownloadFiles()) {
      const result = await app.callServerTool({ name: "read_image_file", arguments: { id: requestedId } });
      const file = result?.isError ? undefined : result?.content?.find(item => item.type === "resource");
      if (file?.type !== "resource" || !("blob" in file.resource) || !file.resource.mimeType) throw new Error();
      const saved = await app.downloadFile({ contents: [{ type: "resource", resource: {
        uri: file.resource.uri, mimeType: file.resource.mimeType, blob: file.resource.blob } }] });
      if (saved?.isError) throw new Error();
    } else {
      // Hosts without file downloads open the full image in the browser instead.
      const base = decodeURIComponent(document.body.dataset.dashboard ?? "");
      const url = new URL(`${base}/api/asset?job=${encodeURIComponent(requestedId)}`);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      const result = await app.openLink({ url: url.href });
      if (result.isError) throw new Error();
    }
  } catch {
    if (!disposed && id === requestedId) status.textContent = "Ready. Download unavailable.";
  } finally {
    download.disabled = false;
    download.textContent = "Download";
  }
});
const play = document.querySelector<HTMLButtonElement>("#play");
/** People who asked the system for less motion start a GIF themselves. The view's stylesheet decides the mode. */
const prefersStill = () => isMotionReduced();
play?.addEventListener("click", async () => {
  if (disposed || !id || play.disabled) return;
  const requestedId = id;
  const stale = () => disposed || id !== requestedId || previewId !== requestedId;
  play.disabled = true;
  play.textContent = "Loading…";
  try {
    let url: string | undefined;
    try {
      const preview = await loadPreview(app, requestedId, stale, { animated: true });
      if (preview.animated) url = preview.url;
    } catch {
      // Fall through to the file itself.
    }
    if (!url) {
      // The preview kept one frame only, so play the full file.
      const result = await app.callServerTool({ name: "read_image_file", arguments: { id: requestedId } });
      const file = result?.isError ? undefined : result?.content?.find(item => item.type === "resource");
      if (file?.type !== "resource" || !("blob" in file.resource) || !file.resource.mimeType?.startsWith("image/")) throw new Error();
      url = `data:${file.resource.mimeType};base64,${file.resource.blob}`;
    }
    if (stale()) return;
    const element = document.querySelector<HTMLImageElement>("#preview");
    if (!element) return;
    element.src = url;
    play.hidden = true;
  } catch {
    if (!stale()) status.textContent = "Ready. The animation cannot be played here. Use Download.";
  } finally {
    play.disabled = false;
    play.textContent = "Play animation";
  }
});
let id = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let visible = true;
let started = Date.now();
let finished = false;
let previewId = "";
let disposed = false;
let generation = 0;
const pollingGenerations = new Set<number>();
function stop() {
  clearTimeout(timer);
}
function render(result: { content?: unknown[] }) {
  if (disposed) return;
  const text = result.content?.find(
    (item): item is { type: "text"; text: string } =>
      Boolean(
        item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item,
      ),
  );
  if (!text) return;
  let job;
  try {
    job = JSON.parse(text.text);
  } catch {
    status.textContent = "Invalid response from image-queue.";
    stop();
    return;
  }
  if (!job || typeof job !== "object") {
    status.textContent = "Invalid response from image-queue.";
    stop();
    return;
  }
  if (typeof job.error === "string" && !job.id) {
    status.textContent = job.error;
    previewId = "";
    id = "";
    if (openApp) openApp.hidden = true;
    if (download) download.hidden = true;
    if (play) play.hidden = true;
    if (workerNotice) workerNotice.hidden = true;
    if (source) source.textContent = "";
    prompt.textContent = "";
    path.textContent = "";
    if (copyPath) copyPath.hidden = true;
    const placeholder = document.querySelector<HTMLElement>("#placeholder");
    if (placeholder) placeholder.hidden = true;
    const element = document.querySelector<HTMLImageElement>("#preview");
    if (element) {
      element.hidden = true;
      element.removeAttribute("src");
    }
    finished = true;
    stop();
    return;
  }
  if (typeof job.id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(job.id) || typeof job.status !== "string" ||
      !["queued", "running", "done", "blocked", "failed", "cancelled", "uncertain"].includes(job.status) ||
      typeof job.prompt !== "string" ||
      (job.error !== undefined && typeof job.error !== "string") ||
      (job.outputPath !== undefined && typeof job.outputPath !== "string")) {
    status.textContent = "Invalid response from image-queue.";
    stop();
    return;
  }
  if (id !== job.id) started = Date.now();
  if (id !== job.id || job.trashedAt || job.status !== "done") {
    previewId = "";
    if (play) play.hidden = true;
    const element = document.querySelector<HTMLImageElement>("#preview");
    if (element) {
      element.hidden = true;
      element.removeAttribute("src");
    }
  }
  const placeholder = document.querySelector<HTMLElement>("#placeholder");
  if (placeholder) {
    placeholder.hidden = Boolean(job.trashedAt) || !["queued", "running", "done"].includes(job.status) || (job.status === "done" && previewId === job.id && Boolean(document.querySelector<HTMLImageElement>("#preview")?.getAttribute("src")));
    placeholder.dataset.label = job.status === "queued" ? "Waiting to start…" : job.status === "running" ? "Generating…" : "Loading preview…";
    if (Number.isInteger(job.width) && Number.isInteger(job.height) && job.width > 0 && job.height > 0 && job.width <= 32768 && job.height <= 32768) {
      placeholder.style.aspectRatio = `${job.width} / ${job.height}`;
      placeholder.style.width = `min(100%, ${420 * job.width / job.height}px)`;
    }
  }
  const preview = document.querySelector<HTMLImageElement>("#preview");
  if (preview && Number.isInteger(job.width) && Number.isInteger(job.height) && job.width > 0 && job.height > 0 && job.width <= 32768 && job.height <= 32768) {
    preview.width = job.width;
    preview.height = job.height;
    preview.style.aspectRatio = `${job.width} / ${job.height}`;
    // Same box as the placeholder, so the image keeps its ratio, its rounded corners and its left edge.
    preview.style.width = `min(100%, ${420 * job.width / job.height}px)`;
    preview.style.height = "auto";
  }
  const jobChanged = id !== job.id;
  id = job.id;
  document.body.dataset.status = job.trashedAt ? "trashed" : job.status;
  if (openApp) openApp.hidden = !document.body.dataset.dashboard;
  if (download) download.hidden = job.status !== "done" || Boolean(job.trashedAt);
  const reserved = isReserved(job);
  const statusLabel = reserved ? "Reserved" : jobStatusLabels[job.status as Job["status"]];
  const label = job.source === "queue" && job.status === "running" && Number.isSafeInteger(job.workerSlot) && job.workerSlot > 0
    ? `${statusLabel} · Worker slot ${job.workerSlot}`
    : statusLabel;
  status.textContent = job.trashedAt ? "In Trash" : job.error ? `${label}: ${job.error}` : label;
  if (workerNotice) {
    const notice = typeof job.queueNotice === "string" && job.queueNotice.length <= 2000 ? job.queueNotice
      : job.workersOffline === true ? workersOfflineMessage : "";
    if (notice) workerNotice.textContent = notice;
    workerNotice.hidden = job.status !== "queued" || !notice || Boolean(job.trashedAt);
  }
  if (source) source.textContent = sourceLabel(job);
  prompt.textContent = job.prompt;
  const outputPath = job.outputPath ?? "";
  const pathChanged = path.textContent !== outputPath;
  if (pathChanged) path.textContent = outputPath;
  if (copyPath) {
    copyPath.hidden = !outputPath;
    if (jobChanged || pathChanged) copyPath.textContent = "Copy path";
  }
  finished = !["queued", "running"].includes(job.status);
  if (!job.trashedAt && job.status === "done" && previewId !== id) {
    previewId = id;
    const requestedId = id;
    const isGif = job.outputFormat === "gif";
    void loadPreview(app, requestedId, () => disposed || id !== requestedId || previewId !== requestedId, { animated: isGif && !prefersStill() })
      .then((preview) => {
        if (!disposed && id === requestedId && previewId === requestedId) {
          const element = document.querySelector<HTMLImageElement>("#preview")!;
          if (!element) return;
          element.src = preview.url;
          element.hidden = false;
          if (placeholder) placeholder.hidden = true;
          // A GIF shown as a still gets Play: by choice (reduced motion) or because the preview lost its frames.
          if (play) play.hidden = !isGif || preview.animated;
        }
      })
      .catch(() => {
        if (!disposed && id === requestedId && previewId === requestedId) {
          previewId = "";
          status.textContent = "Ready. Preview unavailable.";
        }
      });
  }
  schedule();
}
function schedule() {
  stop();
  if (disposed || !visible || finished || !id) return;
  timer = setTimeout(poll, Date.now() - started < 30000 ? 2000 : 10000);
}
async function poll() {
  const requestedGeneration = generation;
  if (pollingGenerations.has(requestedGeneration)) return;
  pollingGenerations.add(requestedGeneration);
  const requestedId = id;
  try {
    const result = await app.callServerTool({ name: "get_job_state", arguments: { id: requestedId } });
    if (!disposed && generation === requestedGeneration) render(result);
  } catch {
    if (disposed || generation !== requestedGeneration) return;
    status.textContent =
      "Connection unavailable. Showing the last known request.";
    schedule();
  } finally {
    pollingGenerations.delete(requestedGeneration);
    if (!disposed && generation === requestedGeneration) schedule();
  }
}
app.ontoolresult = result => {
  const initial = generation === 0;
  generation++;
  render(result);
  if (initial && !disposed && id && finished) void poll();
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables)
    applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
};
const observer = new IntersectionObserver((entries) => {
  visible = entries.some((entry) => entry.isIntersecting);
  if (visible) schedule();
  else stop();
});
observer.observe(document.body);
app.onteardown = async () => {
  disposed = true;
  stop();
  observer.disconnect();
  return {};
};
app.connect().then(() => {
  if (disposed) return;
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context?.styles.css.fonts);
}).catch(() => {
  if (!disposed) status.textContent = "Unable to connect to the host.";
});
