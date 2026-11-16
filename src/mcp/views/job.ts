import { workersOfflineMessage } from "../../core/workspace-state";
import { isReserved, jobStatusLabels } from "../../core/job-status";
import type { Job } from "../../core/schema";
import {
  CompactApp,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "./compact-app";
const app = new CompactApp({ name: "image-queue", version: "1.0.0" });
const status = document.querySelector<HTMLElement>("[role=status]")!;
const workerNotice = document.querySelector<HTMLElement>("#workers-offline");
if (workerNotice) workerNotice.textContent = workersOfflineMessage;
const source = document.querySelector<HTMLElement>("#source");
const providerLabels = new Map([
  ["openai", "OpenAI"], ["google", "Google"], ["openrouter", "OpenRouter"], ["gateway", "AI Gateway"],
]);
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
    const element = document.querySelector<HTMLImageElement>("#preview");
    if (element) {
      element.hidden = true;
      element.removeAttribute("src");
    }
  }
  const placeholder = document.querySelector<HTMLElement>("#placeholder");
  if (placeholder) {
    placeholder.hidden = Boolean(job.trashedAt) || !["queued", "running", "done"].includes(job.status) || (job.status === "done" && previewId === job.id && Boolean(document.querySelector<HTMLImageElement>("#preview")?.getAttribute("src")));
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
  }
  const jobChanged = id !== job.id;
  id = job.id;
  if (openApp) openApp.hidden = !document.body.dataset.dashboard;
  const reserved = isReserved(job);
  const statusLabel = reserved ? "Reserved" : jobStatusLabels[job.status as Job["status"]];
  const label = job.source === "queue" && job.status === "running" && Number.isSafeInteger(job.workerSlot) && job.workerSlot > 0
    ? `${statusLabel} · Worker slot ${job.workerSlot}`
    : statusLabel;
  status.textContent = job.trashedAt ? "In Trash" : job.error ? `${label}: ${job.error}` : label;
  if (workerNotice) workerNotice.hidden = job.status !== "queued" || job.workersOffline !== true || Boolean(job.trashedAt);
  if (source) {
    const provider = providerLabels.get(job.provider) ?? "Provider API";
    const model = typeof job.model === "string" && job.model.length <= 200 ? job.model : "";
    source.textContent = job.source === "queue" ? "Codex queue" : job.source === "api" ? [provider, model].filter(Boolean).join(" · ") : job.source === "import" ? "Imported image" : "";
  }
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
    void app
      .readServerResource({
        uri: `image-queue://thumbnail/${encodeURIComponent(requestedId)}`,
      })
      .then((result) => {
        const image = result.contents.find((item) => "blob" in item);
        if (!image || !("blob" in image) || !image.blob || !image.mimeType?.startsWith("image/"))
          throw new Error("Preview unavailable");
        if (!disposed && id === requestedId && previewId === requestedId) {
          const element = document.querySelector<HTMLImageElement>("#preview")!;
          if (!element) return;
          element.src = `data:${image.mimeType};base64,${image.blob}`;
          element.hidden = false;
          if (placeholder) placeholder.hidden = true;
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
}).catch(() => {
  if (!disposed) status.textContent = "Unable to connect to the host.";
});
