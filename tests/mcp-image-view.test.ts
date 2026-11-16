// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ app: undefined as any }));
vi.mock("../src/mcp/views/compact-app", () => ({
  CompactApp: class {
    callServerTool = vi.fn();
    readServerResource = vi.fn(async () => ({ contents: [] }));
    connect = vi.fn(async () => {});
    getHostContext = vi.fn();
    constructor() { bridge.app = this; }
  }, applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));
it("renders notes safely and switches versions by record identifier", async () => {
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const app = bridge.app;
  app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [{ text: "<script>note</script>" }], versions: [{ id: "one", versionNumber: 1 }, { id: "two", versionNumber: 2 }] }) }] });
  expect(document.querySelector("#notes script")).toBeNull();
  expect(document.querySelector("#notes")?.textContent).toBe("<script>note</script>");
  app.callServerTool.mockResolvedValue({ content: [] });
  document.querySelectorAll<HTMLButtonElement>("#versions button")[1].click();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "get_image_details", arguments: { id: "two" } });
  await app.onteardown();
  document.body.innerHTML = "";
});

afterEach(() => { document.body.innerHTML = ""; });
it.each([
  { image: { id: "one", status: "unknown" }, notes: [], versions: [] },
  { image: { id: "one", status: "done" }, notes: [{ text: "Pin", x: 2, y: 0 }], versions: [] },
  { image: { id: "one", status: "done" }, notes: [{ text: "Area", x: 0.8, y: 0.2, w: 0.4, h: 0.1 }], versions: [] },
  { image: { id: "one", status: "done" }, notes: [{ text: "Area", x: 0.2, y: 0.2, w: 0, h: 0.1 }], versions: [] },
  { image: { id: "one", status: "done" }, notes: [{ text: "Area", w: 0.2, h: 0.1 }], versions: [] },
  { image: { id: "one", status: "done" }, notes: [], versions: [{ id: "../escape" }] },
  { image: { id: "one", status: "done" }, notes: [], versions: [{ id: "two" }, { id: "two" }] },
])("rejects invalid image details before reading previews", async data => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify(data) }] });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Invalid image response.");
  expect(bridge.app.readServerResource).not.toHaveBeenCalled();
  await bridge.app.onteardown();
});

it("positions saved note pins and focuses the matching note", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [{ text: "Change sky", x: 0.25, y: 0.75, w: 0.5, h: 0.2 }], versions: [] }) }] });
  const pin = document.querySelector<HTMLButtonElement>(".note-pin")!;
  expect(pin.style.left).toBe("25%");
  expect(pin.style.top).toBe("75%");
  const region = document.querySelector<HTMLElement>(".note-region")!;
  expect(region.style.width).toBe("50%");
  expect(region.style.height).toBe("20%");
  expect(region.style.left).toBe("25%");
  expect(region.getAttribute("aria-hidden")).toBe("true");
  pin.click();
  expect(document.activeElement).toBe(document.querySelector("#note-1"));
  await bridge.app.onteardown();
});

it("shows pins after preview load and hides them on decode failure", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.readServerResource.mockResolvedValue({ contents: [{ mimeType: "image/png", blob: "YWJj" }] });
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "done" }, notes: [{ text: "Change sky", x: 0.2, y: 0.3 }], versions: [] }) }] });
  await Promise.resolve();
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  const pins = document.querySelector<HTMLElement>("#pins")!;
  preview.dispatchEvent(new Event("load"));
  expect(pins.hidden).toBe(false);
  preview.dispatchEvent(new Event("error"));
  expect(pins.hidden).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Preview unavailable");
  await bridge.app.onteardown();
});

it("preserves note text when saving fails", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "done" }, notes: [], versions: [] }) }] });
  bridge.app.callServerTool.mockResolvedValue({ isError: true });
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "Keep this note";
  document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await Promise.resolve();
  expect(bridge.app.callServerTool).toHaveBeenCalledWith({ name: "add_note", arguments: { imageId: "one", text: "Keep this note" } });
  expect(text.value).toBe("Keep this note");
  expect(document.querySelector<HTMLButtonElement>("#save-note")!.disabled).toBe(false);
  await bridge.app.onteardown();
});

it("preserves text typed while the previous note is saving", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const response = { content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [], versions: [] }) }] };
  bridge.app.ontoolresult(response);
  let finish!: (value: unknown) => void;
  bridge.app.callServerTool.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response);
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "First note";
  document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  text.value = "Next note";
  finish({ content: [] });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(text.value).toBe("Next note");
  await bridge.app.onteardown();
});

it("submits a clicked image point in normalized coordinates", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [], versions: [] }) }] });
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  preview.hidden = false;
  preview.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
  preview.setPointerCapture = vi.fn();
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 60, clientY: 95 }));
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 60, clientY: 95 }));
  expect(document.querySelector<HTMLElement>("#draft-point")!.style.left).toBe("25%");
  expect(document.querySelector<HTMLElement>("#draft-point")!.hidden).toBe(false);
  document.querySelector<HTMLTextAreaElement>("#note-text")!.value = "Change this";
  bridge.app.callServerTool.mockResolvedValue({ isError: true });
  document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(bridge.app.callServerTool).toHaveBeenCalledWith({ name: "add_note", arguments: { imageId: "one", text: "Change this", x: 0.25, y: 0.75 } });
  await bridge.app.onteardown();
});

it("clears a draft point without losing text and resets it on image change", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const response = (id: string) => ({ content: [{ text: JSON.stringify({ image: { id, status: "queued" }, notes: [], versions: [] }) }] });
  bridge.app.ontoolresult(response("one"));
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  preview.hidden = false;
  preview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
  preview.setPointerCapture = vi.fn();
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 }));
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 50 }));
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "Keep my draft";
  document.querySelector<HTMLButtonElement>("#clear-point")!.click();
  expect(document.querySelector<HTMLElement>("#draft-point")!.hidden).toBe(true);
  expect(text.value).toBe("Keep my draft");
  expect(document.activeElement).toBe(text);
  preview.setPointerCapture = vi.fn();
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 }));
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 50 }));
  bridge.app.ontoolresult(response("two"));
  expect(document.querySelector<HTMLElement>("#draft-point")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#clear-point")!.hidden).toBe(true);
  expect(text.value).toBe("");
  await bridge.app.onteardown();
});

it.each([false, true])("handles reversed region gestures and cancellation, cancelled=%s", async cancelled => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [], versions: [] }) }] });
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  preview.hidden = false;
  preview.setPointerCapture = vi.fn();
  preview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 80, clientY: 90 }));
  preview.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 20, clientY: 30 }));
  const marker = document.querySelector<HTMLElement>("#draft-point")!;
  expect(marker.hidden).toBe(false);
  expect(marker.style.left).toBe("20%");
  expect(parseFloat(marker.style.width)).toBeCloseTo(60);
  if (cancelled) {
    preview.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
    expect(marker.hidden).toBe(true);
  }
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 20, clientY: 30 }));
  document.querySelector<HTMLTextAreaElement>("#note-text")!.value = "Area note";
  bridge.app.callServerTool.mockResolvedValue({ isError: true });
  document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  const args = bridge.app.callServerTool.mock.calls[0][0].arguments;
  expect(args).toMatchObject({ imageId: "one", text: "Area note" });
  if (cancelled) expect(args).not.toHaveProperty("x");
  else {
    expect(args.x).toBeCloseTo(0.2);
    expect(args.y).toBeCloseTo(0.3);
    expect(args.w).toBeCloseTo(0.6);
    expect(args.h).toBeCloseTo(0.6);
  }
  await bridge.app.onteardown();
});

it("preserves a new point selected during an earlier note save", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const response = { content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [], versions: [] }) }] };
  bridge.app.ontoolresult(response);
  let finish!: (value: unknown) => void;
  bridge.app.callServerTool.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response);
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "Same text, new area";
  document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  preview.hidden = false;
  preview.setPointerCapture = vi.fn();
  preview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 20, clientY: 30 }));
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 20, clientY: 30 }));
  finish({ content: [] });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(text.value).toBe("Same text, new area");
  expect(document.querySelector<HTMLElement>("#draft-point")!.hidden).toBe(false);
  await bridge.app.onteardown();
});

it("cancels an annotation with Escape while preserving note text", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "queued" }, notes: [], versions: [] }) }] });
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  preview.hidden = false;
  preview.setPointerCapture = vi.fn();
  preview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  preview.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 20, clientY: 30 }));
  preview.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 80, clientY: 90 }));
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "Keep text";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  preview.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 80, clientY: 90 }));
  expect(document.querySelector<HTMLElement>("#draft-point")!.hidden).toBe(true);
  expect(text.value).toBe("Keep text");
  await bridge.app.onteardown();
});

it("queues corrections only on click and reuses the key after failure", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "done" }, notes: [{ text: "Fix" }], versions: [] }) }] });
  expect(bridge.app.callServerTool).not.toHaveBeenCalled();
  bridge.app.callServerTool
    .mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "Choose an available image model" }] })
    .mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "Internal file path" }] });
  const button = document.querySelector<HTMLButtonElement>("#queue-notes")!;
  button.click();
  await Promise.resolve();
  const status = document.querySelector('[role="status"]')!;
  expect(status.textContent).toBe("Connect the original image model in Settings, then retry this correction.");
  button.click();
  await Promise.resolve();
  expect(status.textContent).toBe("Could not queue correction. Retry to check the same request.");
  const calls = bridge.app.callServerTool.mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0][0].name).toBe("add_notes_to_queue");
  expect(calls[0][0].arguments).toEqual(calls[1][0].arguments);
  await bridge.app.onteardown();
});

it("keeps an unsaved note when the user requests a correction", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status: "done" }, notes: [{ text: "Saved" }], versions: [] }) }] });
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  text.value = "Unsaved instruction";
  document.querySelector<HTMLButtonElement>("#queue-notes")!.click();
  expect(bridge.app.callServerTool).not.toHaveBeenCalled();
  expect(text.value).toBe("Unsaved instruction");
  expect(document.activeElement).toBe(text);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Save your note");
  await bridge.app.onteardown();
});

it.each([
  { status: "queued", notes: [{ text: "Pending" }] },
  { status: "done", notes: [] },
  { status: "done", notes: [{ text: "Sent", sentInJobId: "correction" }] },
])("disables correction submission when there is no ready pending work", async ({ status, notes }) => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({ image: { id: "one", status }, notes, versions: [] }) }] });
  const button = document.querySelector<HTMLButtonElement>("#queue-notes")!;
  expect(button.disabled).toBe(true);
  button.click();
  expect(bridge.app.callServerTool).not.toHaveBeenCalled();
  await bridge.app.onteardown();
});

it("refreshes sent notes and disables resubmission after a successful correction", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const details = (sent: boolean) => ({ content: [{ text: JSON.stringify({ image: { id: "one", status: "done" }, notes: [{ text: "Fix", sentInJobId: sent ? "correction" : undefined }], versions: [] }) }] });
  bridge.app.ontoolresult(details(false));
  bridge.app.callServerTool.mockResolvedValueOnce({ content: [{ text: '{"id":"correction"}' }] }).mockResolvedValueOnce(details(true));
  const button = document.querySelector<HTMLButtonElement>("#queue-notes")!;
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(bridge.app.callServerTool).toHaveBeenLastCalledWith({ name: "get_image_details", arguments: { id: "one" } });
  expect(button.disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Correction added to queue.");
  await bridge.app.onteardown();
});

it("ignores a delayed version response after a newer image is displayed", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const response = (id: string, text: string) => ({ content: [{ text: JSON.stringify({ image: { id, status: "queued" }, notes: [{ text }], versions: [{ id: "older", versionNumber: 1 }] }) }] });
  bridge.app.ontoolresult(response("one", "Initial"));
  let finish!: (value: unknown) => void;
  bridge.app.callServerTool.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  document.querySelector<HTMLButtonElement>("#versions button")!.click();
  bridge.app.ontoolresult(response("new", "Current note"));
  finish(response("older", "Stale note"));
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector("#notes")?.textContent).toBe("Current note");
  await bridge.app.onteardown();
});

it("numbers only pending pins when sent notes remain in history", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  bridge.app.ontoolresult({ content: [{ text: JSON.stringify({
    image: { id: "one", status: "done" },
    notes: [
      { text: "Already sent", x: 0.2, y: 0.2, sentInJobId: "old-correction" },
      { text: "New change", x: 0.7, y: 0.7 },
    ], versions: [],
  }) }] });
  const pins = document.querySelectorAll<HTMLButtonElement>("#pins .note-pin");
  expect(pins).toHaveLength(1);
  expect(pins[0].textContent).toBe("1");
  expect(pins[0].getAttribute("aria-label")).toBe("Note 1: New change");
  expect(document.querySelector("#notes")?.textContent).toContain("Already sent (sent)");
  expect(document.querySelector<HTMLButtonElement>("#queue-notes")!.disabled).toBe(false);
  await bridge.app.onteardown();
});

it("does not overwrite a newer image with an old correction confirmation", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const details = (id: string) => ({ content: [{ text: JSON.stringify({ image: { id, status: "done" }, notes: [{ text: id }], versions: [] }) }] });
  bridge.app.ontoolresult(details("one"));
  let finish!: (value: unknown) => void;
  bridge.app.callServerTool.mockResolvedValueOnce({ content: [] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  document.querySelector<HTMLButtonElement>("#queue-notes")!.click();
  await Promise.resolve();
  bridge.app.ontoolresult(details("two"));
  finish(details("one"));
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector("#notes")?.textContent).toBe("two");
  expect(document.querySelector('[role="status"]')?.textContent).not.toBe("Correction added to queue.");
  await bridge.app.onteardown();
});

it("retains a note draft after a save error and clears it after a successful retry", async () => {
  vi.resetModules();
  document.body.innerHTML = '<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point" hidden></span><button id="clear-point" hidden>Clear point</button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note">Save note</button></form><button id="queue-notes">Add to queue</button>';
  await import("../src/mcp/views/image");
  const app = bridge.app;
  const details = (notes: object[]) => ({ content: [{ text: JSON.stringify({
    image: { id: "one", status: "queued" }, notes, versions: [],
  }) }] });
  app.ontoolresult(details([]));
  app.callServerTool.mockResolvedValueOnce({ isError: true })
    .mockResolvedValueOnce({ isError: false })
    .mockResolvedValueOnce(details([{ text: "Keep the shadow" }]));
  const text = document.querySelector<HTMLTextAreaElement>("#note-text")!;
  const submit = () => document.querySelector("#note-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  text.value = "Keep the shadow";
  submit();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain("Your text is preserved"));
  expect(text.value).toBe("Keep the shadow");
  submit();
  await vi.waitFor(() => expect(document.querySelector("#notes")?.textContent).toBe("Keep the shadow"));
  expect(text.value).toBe("");
  expect(app.callServerTool.mock.calls[1][0]).toEqual(app.callServerTool.mock.calls[0][0]);
  await app.onteardown();
});

it("keeps an unchanged image and notes mounted and reuses pixels after a note edit", async () => {
 vi.resetModules();
 document.body.innerHTML='<p role="status"></p><img id="preview"><div id="pins"></div><span id="draft-point"></span><button id="clear-point"></button><ol id="notes"></ol><nav id="versions"></nav><form id="note-form"><textarea id="note-text"></textarea><button id="save-note"></button></form><button id="queue-notes"></button>';
 await import('../src/mcp/views/image');
 const app=bridge.app;
 app.readServerResource.mockResolvedValue({contents:[{blob:"YWJj",mimeType:"image/png"}]});
 const data={image:{id:"stable",status:"done",prompt:"Image"},notes:[{text:"First"}],versions:[{id:"stable"}]};
 const send=(value:unknown)=>app.ontoolresult({content:[{text:JSON.stringify(value)}]});
 send(data);await Promise.resolve();await Promise.resolve();
 const preview=document.querySelector<HTMLImageElement>('#preview')!,note=document.querySelector('#notes li');
 const src=preview.src;
 const version=document.querySelector('#versions button');
 send(data);
 expect(document.querySelector('#notes li')).toBe(note);
 send({...data,notes:[{text:"Updated"}]});
 expect(preview.src).toBe(src);expect(preview.hidden).toBe(false);
 expect(app.readServerResource).toHaveBeenCalledTimes(1);
 expect(document.querySelector('#notes')?.textContent).toBe('Updated');
 expect(document.querySelector('#versions button')).toBe(version);
 const updatedNote=document.querySelector('#notes li');
 send({...data,notes:[{text:"Updated"}],versions:[{id:"stable"},{id:"next"}]});
 expect(document.querySelector('#notes li')).toBe(updatedNote);
 expect(document.querySelectorAll('#versions button')).toHaveLength(2);
 await app.onteardown();
});
