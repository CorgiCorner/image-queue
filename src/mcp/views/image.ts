import { annotationSelection } from "../../core/annotation";
import { CompactApp, applyDocumentTheme, applyHostStyleVariables } from "./compact-app";
const app = new CompactApp({ name: "image-queue-image", version: "1.0.0" });
const status = document.querySelector<HTMLElement>("[role=status]")!;
const preview = document.querySelector<HTMLImageElement>("#preview")!;
const notes = document.querySelector<HTMLElement>("#notes")!;
const pins = document.querySelector<HTMLElement>("#pins")!;
const versions = document.querySelector<HTMLElement>("#versions")!;
const noteForm = document.querySelector<HTMLFormElement>("#note-form")!;
const noteText = document.querySelector<HTMLTextAreaElement>("#note-text")!;
const saveNote = document.querySelector<HTMLButtonElement>("#save-note")!;
const clearPoint = document.querySelector<HTMLButtonElement>("#clear-point")!;
const draftPoint = document.querySelector<HTMLElement>("#draft-point")!;
const queueButton = document.querySelector<HTMLButtonElement>("#queue-notes")!;
let correctionKey: string | undefined;
let canQueue = false;
let imageId = "";
let notePoint: { x: number; y: number; w?: number; h?: number } | undefined;
let dragStart: { pointerId: number; x: number; y: number } | undefined;
let previousPoint: typeof notePoint;
function updateDraftPoint() {
  draftPoint.hidden = !notePoint;
  clearPoint.hidden = !notePoint;
  if (notePoint) {
    draftPoint.style.left = `${notePoint.x * 100}%`;
    draftPoint.style.top = `${notePoint.y * 100}%`;
    draftPoint.className = notePoint.w ? "note-region" : "note-pin";
    draftPoint.style.width = notePoint.w ? `${notePoint.w * 100}%` : "";
    draftPoint.style.height = notePoint.h ? `${notePoint.h * 100}%` : "";
  }
}
clearPoint.addEventListener("click", () => {
  notePoint = undefined;
  updateDraftPoint();
  noteText.focus();
});
function pointerPosition(event: PointerEvent) {
  const bounds = preview.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}
function cancelAnnotation(event: KeyboardEvent) {
  if (event.key !== "Escape" || disposed) return;
  dragStart = undefined;
  notePoint = undefined;
  updateDraftPoint();
}
document.addEventListener("keydown", cancelAnnotation);
preview.addEventListener("pointerdown", event => {
  if (preview.hidden || disposed || dragStart || event.button !== 0) return;
  const point = pointerPosition(event);
  if (!point) return;
  event.preventDefault();
  previousPoint = notePoint;
  dragStart = { pointerId: event.pointerId, ...point };
  preview.setPointerCapture(event.pointerId);
});
preview.addEventListener("pointermove", event => {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return;
  const point = pointerPosition(event);
  if (!point) return;
  notePoint = annotationSelection(dragStart, point);
  updateDraftPoint();
});
preview.addEventListener("pointerup", event => {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return;
  const start = dragStart;
  dragStart = undefined;
  const point = pointerPosition(event);
  if (!point || disposed) return;
  notePoint = annotationSelection(start, point);
  updateDraftPoint();
  status.textContent = "Area selected. Add a note below.";
  noteText.focus();
});
for (const eventName of ["pointercancel", "lostpointercapture"] as const) {
  preview.addEventListener(eventName, event => {
    if (dragStart?.pointerId === event.pointerId) {
      dragStart = undefined;
      notePoint = previousPoint;
      updateDraftPoint();
    }
  });
}
let generation = 0;
let disposed = false;
let renderedSignature = "";
let renderedNotes = "";
let renderedVersions = "";

async function show(id: string) {
  const request = ++generation;
  status.textContent = "Loading image…";
  try {
    const result = await app.callServerTool({ name: "get_image_details", arguments: { id } });
    if (!disposed && request === generation) render(result);
  } catch {
    if (!disposed && request === generation) status.textContent = "Unable to load image. Try another version.";
  }
}
function render(result: { content?: unknown[] }) {
  if (disposed) return;
  try {
    const block = result.content?.find((value): value is { text: string } => !!value && typeof value === "object" && "text" in value && typeof value.text === "string");
    const data = JSON.parse(block?.text ?? "");
    const validId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
    if (!data || !data.image || !validId(data.image.id) ||
      !["queued", "running", "done", "blocked", "failed", "cancelled", "uncertain"].includes(data.image.status) ||
      (data.image.prompt !== undefined && typeof data.image.prompt !== "string") ||
      !Array.isArray(data.notes) || !Array.isArray(data.versions)) throw new Error();
    for (const note of data.notes) {
      if (!note || typeof note.text !== "string" || note.text.length > 4000 ||
        (note.x === undefined) !== (note.y === undefined) ||
        (note.x !== undefined && (!Number.isFinite(note.x) || !Number.isFinite(note.y) || note.x < 0 || note.x > 1 || note.y < 0 || note.y > 1)) ||
        (note.w === undefined) !== (note.h === undefined) ||
        (note.w !== undefined && (note.x === undefined || !Number.isFinite(note.w) || !Number.isFinite(note.h) || note.w <= 0 || note.h <= 0 || note.x + note.w > 1 || note.y + note.h > 1))) throw new Error();
    }
    const versionIds = new Set<string>();
    for (const version of data.versions) {
      if (!version || !validId(version.id) || versionIds.has(version.id) ||
        (version.versionNumber !== undefined && (!Number.isSafeInteger(version.versionNumber) || version.versionNumber < 1))) throw new Error();
      versionIds.add(version.id);
    }
    const signature = JSON.stringify(data);
    if (signature === renderedSignature && (data.image.status !== "done" || preview.hasAttribute("src"))) return;
    const keepPreview = imageId === data.image.id && data.image.status === "done" && preview.hasAttribute("src");
    renderedSignature = signature;
    if (imageId !== data.image.id) {
      noteText.value = "";
      notePoint = undefined;
      correctionKey = undefined;
      dragStart = undefined;
    }
    updateDraftPoint();
    imageId = data.image.id;
    canQueue = data.image.status === "done" && !data.image.archivedAt && data.notes.some((note: { sentInJobId?: string }) => !note.sentInJobId);
    queueButton.disabled = !canQueue;
    const current = ++generation;
    if (!keepPreview) {
      preview.hidden = true;
      pins.hidden = true;
      preview.removeAttribute("src");
    }
    preview.alt = data.image.prompt ?? "Image";
    const notesSignature = JSON.stringify([imageId, data.notes]);
    const versionsSignature = JSON.stringify([imageId, data.versions]);
    if (notesSignature !== renderedNotes) {
    renderedNotes = notesSignature;
    notes.replaceChildren();
    pins.replaceChildren();
    let pendingNumber = 0;
    for (const note of data.notes) {
      if (!note.sentInJobId) pendingNumber++;
      const item = document.createElement("li");
      item.textContent = note.sentInJobId ? `${note.text} (sent)` : note.text;
      item.value = note.sentInJobId ? 0 : pendingNumber;
      item.id = `note-${notes.childElementCount + 1}`;
      notes.append(item);
      if (!note.sentInJobId && note.x !== undefined && note.y !== undefined) {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "note-pin";
        pin.textContent = String(pendingNumber);
        pin.setAttribute("aria-label", `Note ${pendingNumber}: ${note.text}`);
        pin.style.left = `${note.x * 100}%`;
        pin.style.top = `${note.y * 100}%`;
        pin.addEventListener("click", () => { item.tabIndex = -1; item.focus(); });
        pins.append(pin);
        if (note.w !== undefined && note.h !== undefined) {
          const region = document.createElement("div");
          region.className = "note-region";
          region.setAttribute("aria-hidden", "true");
          Object.assign(region.style, {
            left: `${note.x * 100}%`, top: `${note.y * 100}%`,
            width: `${note.w * 100}%`, height: `${note.h * 100}%`,
          });
          pins.append(region);
        }
      }
    }
    }
    if (versionsSignature !== renderedVersions) {
    renderedVersions = versionsSignature;
    versions.replaceChildren();
    for (const version of data.versions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `v${version.versionNumber ?? versions.childElementCount + 1}`;
      button.setAttribute("aria-pressed", String(version.id === data.image.id));
      button.addEventListener("click", () => void show(version.id));
      versions.append(button);
    }
    }
    status.textContent = data.image.status;
    if (keepPreview) pins.hidden = false;
    if (data.image.status === "done" && !keepPreview) void app.readServerResource({ uri: `image-queue://thumbnail/${encodeURIComponent(data.image.id)}` }).then(resource => {
      if (disposed || generation !== current) return;
      const image = resource.contents.find(item => "blob" in item);
      if (image && "blob" in image && image.mimeType?.startsWith("image/")) {
        preview.onload = () => {
          if (!disposed && generation === current) pins.hidden = false;
        };
        preview.onerror = () => {
          if (!disposed && generation === current) {
            pins.hidden = true;
            status.textContent = "Preview unavailable";
          }
        };
        preview.src = `data:${image.mimeType};base64,${image.blob}`;
        preview.hidden = false;
      }
    }).catch(() => { if (!disposed && generation === current) status.textContent = "Preview unavailable"; });
  } catch { status.textContent = "Invalid image response."; }
}
queueButton.addEventListener("click", async () => {
  if (disposed || queueButton.disabled || !canQueue || !imageId) return;
  if (saveNote.disabled || noteText.value.trim()) {
    status.textContent = "Save your note before adding the correction to the queue.";
    noteText.focus();
    return;
  }
  const target = imageId;
  const request = generation;
  correctionKey ??= crypto.randomUUID();
  queueButton.disabled = true;
  try {
    const result = await app.callServerTool({ name: "add_notes_to_queue", arguments: { imageId: target, idempotencyKey: correctionKey } });
    if (result.isError) {
      const message = result.content?.find(item => item.type === "text")?.text;
      const guidance = message === "Choose an available image model"
        ? "Connect the original image model in Settings, then retry this correction."
        : message === "Connect this provider in Settings first"
          ? "Connect the image provider in Settings, then retry this correction."
          : undefined;
      if (!guidance) throw new Error("Correction was not queued");
      if (!disposed && generation === request) status.textContent = guidance;
      return;
    }
    if (!disposed && generation === request) {
      correctionKey = undefined;
      await show(target);
      if (!disposed && imageId === target) status.textContent = "Correction added to queue.";
    }
  } catch {
    if (!disposed && generation === request) status.textContent = "Could not queue correction. Retry to check the same request.";
  } finally {
    queueButton.disabled = !canQueue;
  }
});
noteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const text = noteText.value.trim();
  if (disposed || saveNote.disabled || !imageId || !text || text.length > 4000) return;
  const target = imageId;
  const request = generation;
  const submittedPoint = notePoint;
  saveNote.disabled = true;
  try {
    const result = await app.callServerTool({ name: "add_note", arguments: { imageId: target, text, ...submittedPoint } });
    if (result.isError) throw new Error("Note was not saved");
    if (!disposed && generation === request) {
      if (noteText.value.trim() === text && notePoint === submittedPoint) {
        noteText.value = "";
        notePoint = undefined;
        updateDraftPoint();
      }
      await show(target);
    }
  } catch {
    if (!disposed && generation === request) status.textContent = "Could not save note. Your text is preserved.";
  } finally {
    saveNote.disabled = false;
  }
});
app.ontoolresult = render;
app.onhostcontextchanged = context => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
};
app.onteardown = async () => {
  disposed = true;
  generation++;
  document.removeEventListener("keydown", cancelAnnotation);
  return {};
};
app.connect().then(() => {
  if (disposed) return;
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}).catch(() => { if (!disposed) status.textContent = "Unable to connect to the host."; });
