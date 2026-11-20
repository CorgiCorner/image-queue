import { layout } from "../../core/layout";
import { CompactApp, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "./compact-app";
import { loadThumbnail } from "./thumbnail";

const app = new CompactApp({ name: "image-queue-gallery", version: "1.0.0" });
const grid = document.querySelector<HTMLElement>("#gallery")!;
const viewport = document.querySelector<HTMLElement>("#gallery-viewport");
const status = document.querySelector<HTMLElement>("[role=status]")!;
const more = document.querySelector<HTMLButtonElement>("#more")!;
const displayToggle = document.querySelector<HTMLButtonElement>("#display-mode")!;
let displayMode = "inline";
let availableDisplayModes: readonly string[] = [];

function updateDisplayMode(context: { displayMode?: string; availableDisplayModes?: readonly string[] }) {
  displayMode = context.displayMode ?? displayMode;
  availableDisplayModes = context.availableDisplayModes ?? availableDisplayModes;
  const target = displayMode === "fullscreen" ? "inline" : "fullscreen";
  displayToggle.hidden = !availableDisplayModes.includes(target);
  displayToggle.textContent = displayMode === "fullscreen" ? "Exit full screen" : "Full screen";
  positionImages();
}

displayToggle.addEventListener("click", async () => {
  if (displayToggle.disabled || disposed) return;
  const mode = displayMode === "fullscreen" ? "inline" : "fullscreen";
  if (!availableDisplayModes.includes(mode)) return;
  displayToggle.disabled = true;
  try {
    const result = await app.requestDisplayMode({ mode });
    if (!disposed) updateDisplayMode({ displayMode: result.mode });
  } catch {
    if (!disposed) status.textContent = "Could not change display mode. Try again.";
  } finally {
    displayToggle.disabled = false;
  }
});
const selected = new Set<string>();
const cardsById = new Map<string, HTMLElement>();
type GalleryItem = { id: string; title: string; status: string; width?: number; height?: number };
const items = new Map<string, GalleryItem>();
const previews = new Map<string, string>();
const previewBudget = 8 * 1024 * 1024;
let previewSize = 0;

function rememberPreview(id: string, url: string) {
  if (url.length > previewBudget) return;
  previewSize -= previews.get(id)?.length ?? 0;
  previews.delete(id);
  previews.set(id, url);
  previewSize += url.length;
  for (const [oldest, data] of previews) {
    if (previewSize <= previewBudget) break;
    previews.delete(oldest);
    previewSize -= data.length;
  }
}

function clearPreviews() {
  pendingPreviews.clear();
  previews.clear();
  previewSize = 0;
}
let geometry: ReturnType<typeof layout> | undefined;
let layoutWidth = 0;
let layoutCount = -1;
let orderedItems: GalleryItem[] = [];
let positions = new Map<string, number>();
let disposed = false;

function positionImages() {
  if (disposed) return;
  const width = grid.clientWidth || 320;
  if (!geometry || layoutWidth !== width || layoutCount !== items.size) {
    orderedItems = [...items.values()];
    positions = new Map(orderedItems.map(({ id }, index) => [id, index]));
    geometry = layout(orderedItems.map(({ id }) => ({ id, width: 1, height: 1 })), width, "grid", 12, 140);
    layoutWidth = width;
    layoutCount = items.size;
  }
  grid.style.height = `${geometry.height}px`;
  const inline = displayMode === "inline" && viewport;
  if (viewport) {
    const tile = geometry.rectangles[0]?.height ?? 0;
    viewport.style.maxHeight = inline ? `${tile ? 2 * tile + 12 : 0}px` : "";
  }
  const gridTop = grid.getBoundingClientRect().top;
  const bounds = inline ? viewport.getBoundingClientRect() : undefined;
  const top = Math.max(0, bounds?.top ?? 0) - gridTop;
  const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - gridTop;
  const rectangles = geometry.rectangles;
  let first = 0;
  let end = rectangles.length;
  while (first < end) {
    const middle = (first + end) >>> 1;
    const rectangle = rectangles[middle];
    if (rectangle.y + rectangle.height < top - 300) first = middle + 1;
    else end = middle;
  }
  end = first;
  while (end < rectangles.length && rectangles[end].y <= bottom + 300) end++;

  const visibleIndices = Array.from({ length: end - first }, (_, offset) => first + offset);
  for (const [id, card] of cardsById) {
    const index = positions.get(id);
    if (index !== undefined && index >= first && index < end) continue;
    if (index !== undefined && card.contains(document.activeElement)) visibleIndices.push(index);
    else {
      card.remove();
      cardsById.delete(id);
    }
  }
  visibleIndices.sort((a, b) => a - b);
  const visibleCards = visibleIndices.map(index => {
    const rectangle = rectangles[index];
    const item = orderedItems[index];
    const existing = cardsById.get(item.id);
    const card = existing ?? createCard(item);
    cardsById.set(item.id, card);
    Object.assign(card.style, {
      left: `${rectangle.x}px`, top: `${rectangle.y}px`,
      width: `${rectangle.width}px`, height: `${rectangle.height}px`,
    });
    return card;
  });
  visibleCards.forEach((card, index) => {
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] ?? null);
  });
}
window.addEventListener("scroll", positionImages, { passive: true });
viewport?.addEventListener("scroll", positionImages, { passive: true });
const resizeObserver = new ResizeObserver(positionImages);
resizeObserver.observe(grid);
let filter: Record<string, unknown> = {};
let nextOffset: number | null = null;
let generation = 0;
let loading = false;
let sharingSelection = false;
let pendingSelection: string[] | undefined;
const selectionError = "Could not share selection. Try selecting again.";
let statusBeforeSelectionError = "";

async function shareSelection() {
  pendingSelection = [...selected];
  if (sharingSelection) return;
  sharingSelection = true;
  try {
    while (pendingSelection && !disposed) {
      const imageIds = pendingSelection;
      pendingSelection = undefined;
      try {
        await app.updateModelContext({ content: [{ type: "text", text: JSON.stringify({ selectedImageIds: imageIds }) }] });
        if (!disposed && status.textContent === selectionError) {
          status.textContent = statusBeforeSelectionError;
        }
      } catch {
        if (!disposed && !pendingSelection && status.textContent !== selectionError) {
          statusBeforeSelectionError = status.textContent ?? "";
          status.textContent = selectionError;
        }
      }
    }
  } finally {
    sharingSelection = false;
  }
}

const pendingPreviews = new Map<string, Promise<string | undefined>>();

function fetchPreview(id: string) {
  const pending = pendingPreviews.get(id);
  if (pending) return pending;
  const requestGeneration = generation;
  const request = loadThumbnail(app, id, () => disposed)
    .then(url => {
      if (disposed || generation !== requestGeneration) return;
      rememberPreview(id, url);
      return url;
    })
    .finally(() => {
      if (pendingPreviews.get(id) === request) pendingPreviews.delete(id);
    });
  pendingPreviews.set(id, request);
  return request;
}

function createCard(item: GalleryItem) {
  const label = document.createElement("label");
  label.dataset.imageId = item.id;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", `Select ${item.title}`);
  checkbox.checked = selected.has(item.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.add(item.id); else selected.delete(item.id);
    void shareSelection();
  });
  const image = document.createElement("img");
  image.alt = item.title;
  if (item.width && item.height) { image.width = item.width; image.height = item.height; }
  image.loading = "lazy";
  image.decoding = "async";
  const title = document.createElement("span");
  title.textContent = item.title;
  label.append(checkbox, image, title);
  const cached = previews.get(item.id);
  if (cached) {
    previews.delete(item.id);
    previews.set(item.id, cached);
    image.src = cached;
  } else if (item.status === "done") {
    void fetchPreview(item.id).then(url => {
      if (url && !disposed && cardsById.get(item.id) === label) image.src = url;
    }).catch(() => {
      if (!disposed && cardsById.get(item.id) === label) image.alt = `${item.title} — preview unavailable`;
    });
  }
  return label;
}

function render(result: { content?: unknown[] }, append = false, requestedOffset = 0) {
  if (disposed) return;
  try {
    const block = result.content?.find((item): item is { type: string; text: string } =>
      !!item && typeof item === "object" && "text" in item && typeof item.text === "string");
    const page = JSON.parse(block?.text ?? "");
    if (!page || !Array.isArray(page.items) || page.items.length > 100 ||
      !Number.isSafeInteger(page.total) || page.total < page.items.length ||
      !(page.nextOffset === null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > requestedOffset && page.nextOffset < page.total))) throw new Error();
    const ids = new Set<string>();
    for (const item of page.items) {
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(item.id) ||
        typeof item.title !== "string" || item.title.length > 160 ||
        !["queued", "running", "done", "blocked", "failed", "cancelled", "uncertain"].includes(item.status) ||
        (item.width !== undefined && (!Number.isInteger(item.width) || item.width < 1 || item.width > 32768)) ||
        (item.height !== undefined && (!Number.isInteger(item.height) || item.height < 1 || item.height > 32768)) ||
        ids.has(item.id)) throw new Error();
      ids.add(item.id);
    }
    if (!append) {
      generation++;
      loading = false;
      more.disabled = false;
      // Retain loaded, unchanged cards so refresh does not flash their thumbnails.
      const incoming = new Map<string, GalleryItem>(page.items.map((item: GalleryItem) => [item.id, item]));
      for (const [id, card] of cardsById) {
        const before = items.get(id), after = incoming.get(id);
        const unchanged = before && after && before.title === after.title && before.status === after.status && before.width === after.width && before.height === after.height;
        const awaitingPreview = after?.status === "done" && !card.querySelector("img")?.hasAttribute("src");
        if (!unchanged || awaitingPreview) {
          card.remove();
          cardsById.delete(id);
        } else {
          const checkbox = card.querySelector<HTMLInputElement>("input");
          if (checkbox) checkbox.checked = false;
        }
        if (!unchanged) {
          previewSize -= previews.get(id)?.length ?? 0;
          previews.delete(id);
        }
      }
      for (const [id, preview] of previews) {
        const before = items.get(id), after = incoming.get(id);
        if (!before || !after || before.status !== after.status || before.width !== after.width || before.height !== after.height) {
          previews.delete(id);
          previewSize -= preview.length;
        }
      }
      pendingPreviews.clear();
      geometry = undefined;
      items.clear();
      const hadSelection = selected.size > 0;
      selected.clear();
      if (hadSelection) void shareSelection();
    }
    for (const item of page.items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    positionImages();
    nextOffset = Number.isInteger(page.nextOffset) && page.nextOffset >= 0 ? page.nextOffset : null;
    more.hidden = nextOffset === null;
    status.textContent = page.total ? `${page.total} images` : "No matching images";
  } catch { status.textContent = "Invalid gallery response."; }
}
app.ontoolinput = input => { filter = input.arguments ?? {}; };
app.ontoolresult = result => render(result);
more.addEventListener("click", async () => {
  if (disposed || loading || nextOffset === null) return;
  loading = true;
  const requestedGeneration = generation;
  const requestedOffset = nextOffset;
  more.disabled = true;
  try {
    const result = await app.callServerTool({ name: "list_thumbnails", arguments: { ...filter, offset: requestedOffset } });
    if (!disposed && requestedGeneration === generation) render(result, true, requestedOffset);
  }
  catch { if (!disposed && requestedGeneration === generation) status.textContent = "Could not load more images. Try again."; }
  finally {
    if (!disposed && requestedGeneration === generation) {
      loading = false;
      more.disabled = false;
    }
  }
});
app.onhostcontextchanged = context => {
  if (disposed) return;
  updateDisplayMode(context);
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
};
app.onteardown = async () => { disposed = true; generation++; resizeObserver.disconnect(); window.removeEventListener("scroll", positionImages); viewport?.removeEventListener("scroll", positionImages); cardsById.clear(); items.clear(); orderedItems = []; positions.clear(); clearPreviews(); selected.clear(); geometry = undefined; grid.replaceChildren(); return {}; };
app.connect().then(() => {
  if (disposed) return;
  const context = app.getHostContext();
  if (context) updateDisplayMode(context);
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context?.styles.css.fonts);
}).catch(() => { if (!disposed) status.textContent = "Unable to connect to the host."; });
