// @vitest-environment happy-dom
import { waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ app: undefined as any, connect: vi.fn(async () => {}) }));
vi.mock("../src/mcp/views/compact-app", () => ({
  CompactApp: class {
    ontoolinput: any; ontoolresult: any; onhostcontextchanged: any; onteardown: any;
    updateModelContext = vi.fn(async () => ({}));
    readServerResource = vi.fn(async () => ({ contents: [] }));
    callServerTool = vi.fn();
    requestDisplayMode = vi.fn(async ({ mode }: { mode: string }) => ({ mode }));
    connect = bridge.connect;
    getHostContext = vi.fn(() => ({}));
    constructor() { bridge.app = this; }
  },
  applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function open(withViewport = false) {
  vi.resetModules();
  document.body.innerHTML = '<button id="display-mode" hidden>Full screen</button><p role="status"></p><div id="gallery"></div><button id="more" hidden>Load more</button>';
  if (withViewport) document.querySelector("#gallery")!.outerHTML = '<div id="gallery-viewport"><div id="gallery"></div></div>';
  await import("../src/mcp/views/gallery");
  return bridge.app;
}
const result = (items: unknown[], nextOffset: number | null = null) => ({
  content: [{ type: "text", text: JSON.stringify({ items, total: nextOffset === null ? items.length : nextOffset + 1, nextOffset }) }],
});
it("reports when the gallery cannot connect to its host", async () => {
  bridge.connect.mockRejectedValueOnce(new Error("Host unavailable"));
  await open();
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent)
    .toBe("Unable to connect to the host."));
});

it("renders titles as text and shares selected identifiers", async () => {
  const app = await open();
  app.ontoolresult(result([{ id: "one", title: "<script>unsafe</script>", status: "queued" }]));
  expect(document.querySelector("#gallery script")).toBeNull();
  const checkbox = document.querySelector<HTMLInputElement>("input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  expect(app.updateModelContext).toHaveBeenCalledWith({ content: [{ type: "text", text: JSON.stringify({ selectedImageIds: ["one"] }) }] });
});
it("lets an agent gallery user retry sharing a selection after a host failure", async () => {
  const app = await open();
  app.updateModelContext.mockRejectedValueOnce(new Error("Host disconnected"));
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }]));
  const checkbox = document.querySelector<HTMLInputElement>("input")!;
  checkbox.click();
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent)
    .toBe("Could not share selection. Try selecting again."));
  checkbox.click();
  await waitFor(() => expect(app.updateModelContext).toHaveBeenLastCalledWith({
    content: [{ type: "text", text: JSON.stringify({ selectedImageIds: [] }) }],
  }));
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("1 images"));
});

it("requests subsequent pages with the original filter", async () => {
  const app = await open();
  app.ontoolinput({ arguments: { projectId: "project", limit: 1 } });
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }], 1));
  app.callServerTool.mockResolvedValue(result([{ id: "two", title: "Two", status: "queued" }]));
  document.querySelector<HTMLButtonElement>("#more")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "list_thumbnails", arguments: { projectId: "project", limit: 1, offset: 1 } });
  expect(document.querySelectorAll("#gallery label")).toHaveLength(2);
});
it("ignores tool results after teardown", async () => {
  const app = await open();
  await app.onteardown();
  app.ontoolresult(result([{ id: "one", title: "One" }]));
  expect(document.querySelectorAll("#gallery label")).toHaveLength(0);
});

it("discards a previous page response after a new gallery result", async () => {
  const app = await open();
  let finish!: (value: unknown) => void;
  app.callServerTool.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  app.ontoolresult(result([{ id: "old", title: "Old", status: "queued" }], 1));
  document.querySelector<HTMLButtonElement>("#more")!.click();
  app.ontoolresult(result([{ id: "new", title: "New", status: "queued" }]));
  finish(result([{ id: "late", title: "Late", status: "queued" }]));
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelectorAll("#gallery label")).toHaveLength(1);
  expect(document.querySelector("#gallery")?.textContent).toBe("New");
});

it("clears model selection when a new result replaces selected images", async () => {
  const app = await open();
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }]));
  const checkbox = document.querySelector<HTMLInputElement>("input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  app.ontoolresult(result([{ id: "two", title: "Two", status: "queued" }]));
  await Promise.resolve();
  await Promise.resolve();
  expect(app.updateModelContext).toHaveBeenLastCalledWith({ content: [{ type: "text", text: JSON.stringify({ selectedImageIds: [] }) }] });
  expect(document.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
});

it("serializes rapid selection updates and shares the latest state", async () => {
  const app = await open();
  let finish!: () => void;
  app.updateModelContext.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }]));
  const checkbox = document.querySelector<HTMLInputElement>("input")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event("change"));
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  expect(app.updateModelContext).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(app.updateModelContext).toHaveBeenCalledTimes(2);
  expect(app.updateModelContext).toHaveBeenLastCalledWith({ content: [{ type: "text", text: JSON.stringify({ selectedImageIds: ["one"] }) }] });
});

it.each([
  { items: [{ id: "../escape", title: "Unsafe", status: "done" }], total: 1, nextOffset: null },
  { items: [{ id: "one", title: "Invalid", status: "unknown" }], total: 1, nextOffset: null },
  { items: [], total: -1, nextOffset: null },
  { items: [], total: 2, nextOffset: 2 },
  { items: [{ id: "one", title: "One", status: "done" }, { id: "one", title: "Duplicate", status: "done" }], total: 2, nextOffset: null },
])("rejects malformed pages without replacing the current gallery", async page => {
  const app = await open();
  app.ontoolresult(result([{ id: "valid", title: "Current", status: "queued" }]));
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify(page) }] });
  expect(document.querySelector("#gallery")?.textContent).toBe("Current");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Invalid gallery response.");
  expect(app.readServerResource).not.toHaveBeenCalled();
});

it("does not duplicate an image when pagination overlaps after a collection changes", async () => {
  const app = await open();
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }], 1));
  app.callServerTool.mockResolvedValue(result([
    { id: "one", title: "One", status: "queued" },
    { id: "two", title: "Two", status: "queued" },
  ]));
  document.querySelector<HTMLButtonElement>("#more")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelectorAll("#gallery label")).toHaveLength(2);
  expect(document.querySelectorAll('input[aria-label="Select One"]')).toHaveLength(1);
});

it("offers only host-supported display modes and follows the confirmed mode", async () => {
  const app = await open();
  const button = document.querySelector<HTMLButtonElement>("#display-mode")!;
  expect(button.hidden).toBe(true);
  app.onhostcontextchanged({ displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] });
  expect(button.hidden).toBe(false);
  button.click();
  await Promise.resolve();
  expect(app.requestDisplayMode).toHaveBeenCalledWith({ mode: "fullscreen" });
  expect(button.textContent).toBe("Exit full screen");
  button.click();
  await Promise.resolve();
  expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: "inline" });
  expect(button.textContent).toBe("Full screen");
});

it("ignores a thumbnail delivered after the gallery was replaced", async () => {
  const app = await open();
  let finish!: (value: unknown) => void;
  app.readServerResource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  app.ontoolresult(result([{ id: "old", title: "Old", status: "done" }]));
  const oldImage = document.querySelector<HTMLImageElement>("#gallery img")!;
  app.ontoolresult(result([{ id: "new", title: "New", status: "queued" }]));
  finish({ contents: [{ mimeType: "image/png", blob: "YWJj" }] });
  await Promise.resolve();
  expect(oldImage.hasAttribute("src")).toBe(false);
  expect(document.querySelector<HTMLImageElement>("#gallery img")?.alt).toBe("New");
});

it("ignores a thumbnail failure after teardown", async () => {
  const app = await open();
  let fail!: (reason: unknown) => void;
  app.readServerResource.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  app.ontoolresult(result([{ id: "one", title: "One", status: "done" }]));
  const image = document.querySelector<HTMLImageElement>("#gallery img")!;
  await app.onteardown();
  fail(new Error("Disconnected"));
  await Promise.resolve();
  await Promise.resolve();
  expect(image.alt).toBe("One");
  expect(document.querySelector("#gallery img")).toBeNull();
});

it("allows retrying a rejected full-screen request", async () => {
  const app = await open();
  app.onhostcontextchanged({ displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] });
  app.requestDisplayMode.mockRejectedValueOnce(new Error("Host refused"));
  const button = document.querySelector<HTMLButtonElement>("#display-mode")!;
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe("Full screen");
  expect(document.querySelector("[role=status]")?.textContent).toContain("Could not change display mode");
  button.click();
  await Promise.resolve();
  expect(button.textContent).toBe("Exit full screen");
});

it("uses shared grid geometry to reserve image positions", async () => {
  const app = await open();
  app.ontoolresult(result([
    { id: "one", title: "One", status: "queued" },
    { id: "two", title: "Two", status: "queued" },
  ]));
  const cards = document.querySelectorAll<HTMLElement>("#gallery label");
  expect(cards[0].style.width).toBe("154px");
  expect(cards[1].style.left).toBe("166px");
  expect(document.querySelector<HTMLElement>("#gallery")!.style.height).toBe("154px");
});

it("repositions tiles on resize and disconnects its observer on teardown", async () => {
  let resize!: () => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const app = await open();
  const grid = document.querySelector<HTMLElement>("#gallery")!;
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 320 });
  app.ontoolresult(result([
    { id: "one", title: "One", status: "queued" },
    { id: "two", title: "Two", status: "queued" },
  ]));
  expect(observe).toHaveBeenCalledWith(grid);
  expect(grid.style.height).toBe("154px");
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 140 });
  resize();
  const cards = grid.querySelectorAll<HTMLElement>("label");
  expect(cards[1].style.left).toBe("0px");
  expect(cards[1].style.top).toBe("152px");
  expect(grid.style.height).toBe("292px");
  await app.onteardown();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("rejects a pagination response that does not advance its offset", async () => {
  const app = await open();
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }], 1));
  app.callServerTool.mockResolvedValue(result([{ id: "two", title: "Two", status: "queued" }], 1));
  document.querySelector<HTMLButtonElement>("#more")!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector("#gallery")?.textContent).toBe("One");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Invalid gallery response.");
  expect(document.querySelector<HTMLButtonElement>("#more")!.disabled).toBe(false);
});

it.each([false, true])("windows cards and reloads evicted previews (over budget: %s)", async (overBudget) => {
  const app = await open();
  const grid = document.querySelector<HTMLElement>("#gallery")!;
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  let top = 0;
  grid.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 320, width: 320, height: 0, x: 0, y: top, toJSON() {} });
  const blob = overBudget ? "A".repeat(1024 * 1024) : "AAAA";
  app.readServerResource.mockResolvedValue({ contents: [{ blob, mimeType: "image/png" }] });
  app.ontoolresult(result(Array.from({ length: 100 }, (_, i) => ({ id: `image-${i}`, title: `Image ${i}`, status: "done" }))));
  expect(grid.querySelectorAll("label").length).toBeLessThan(15);
  expect(app.readServerResource.mock.calls.length).toBeLessThan(15);
  await Promise.resolve();
  const first = grid.querySelector<HTMLInputElement>("input")!;
  first.checked = true;
  first.dispatchEvent(new Event("change"));
  top = -3000;
  window.dispatchEvent(new Event("scroll"));
  expect(grid.querySelector('[data-image-id="image-0"]')).toBeNull();
  expect(grid.querySelectorAll("label").length).toBeLessThan(20);
  await Promise.resolve();
  top = 0;
  window.dispatchEvent(new Event("scroll"));
  await Promise.resolve();
  expect(grid.querySelector<HTMLInputElement>('[data-image-id="image-0"] input')?.checked).toBe(true);
  expect(grid.querySelector('[data-image-id="image-0"] input')).not.toBe(first);
  await waitFor(() => {
    expect(grid.querySelector('[data-image-id="image-0"] img')?.getAttribute("src")?.length).toBe("data:image/png;base64,".length + blob.length);
  });
  expect(app.readServerResource.mock.calls.filter(([request]: [{ uri: string }]) => request.uri.endsWith("/image-0"))).toHaveLength(overBudget ? 2 : 1);
  await app.onteardown();
});

it("preserves image dimensions and rejects invalid size metadata", async () => {
  const app = await open();
  app.ontoolresult(result([{ id: "portrait", title: "Portrait", status: "queued", width: 1080, height: 1920 }]));
  const image = document.querySelector<HTMLImageElement>("#gallery img")!;
  expect(image.width).toBe(1080);
  expect(image.height).toBe(1920);
  app.ontoolresult(result([{ id: "invalid", title: "Invalid", status: "queued", width: -1, height: 100 }]));
  expect(document.querySelector("[role=status]")?.textContent).toBe("Invalid gallery response.");
});

it("keeps DOM order chronological after returning from a lower scroll position", async () => {
  const app = await open();
  const grid = document.querySelector<HTMLElement>("#gallery")!;
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 320 });
  let top = 0;
  grid.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 320, width: 320, height: 0, x: 0, y: top, toJSON() {} });
  app.ontoolresult(result(Array.from({ length: 100 }, (_, i) => ({ id: `image-${i}`, title: `Image ${i}`, status: "queued" }))));
  top = -1200;
  window.dispatchEvent(new Event("scroll"));
  top = -900;
  window.dispatchEvent(new Event("scroll"));
  const ids = Array.from(grid.children).map(card => Number((card as HTMLElement).dataset.imageId!.split("-")[1]));
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  await app.onteardown();
});

it("retains a focused card when scrolling it out of the window", async () => {
  const app = await open();
  const grid = document.querySelector<HTMLElement>("#gallery")!;
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 320 });
  let top = 0;
  grid.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 320, width: 320, height: 0, x: 0, y: top, toJSON() {} });
  app.ontoolresult(result(Array.from({ length: 100 }, (_, i) => ({ id: `image-${i}`, title: `Image ${i}`, status: "queued" }))));
  const checkbox = grid.querySelector<HTMLInputElement>('input')!;
  checkbox.focus();
  top = -3000;
  window.dispatchEvent(new Event("scroll"));
  expect(checkbox.isConnected).toBe(true);
  expect(document.activeElement).toBe(checkbox);
  checkbox.blur();
  window.dispatchEvent(new Event("scroll"));
  expect(checkbox.isConnected).toBe(false);
  await app.onteardown();
});

it("caps the inline gallery to two rows and removes the cap in fullscreen", async () => {
  const app = await open(true);
  const viewport = document.querySelector<HTMLElement>("#gallery-viewport")!;
  app.ontoolresult(result(Array.from({ length: 12 }, (_, i) => ({ id: `image-${i}`, title: "Image", status: "queued" }))));
  expect(viewport.style.maxHeight).toBe("320px");
  app.onhostcontextchanged({ displayMode: "fullscreen" });
  expect(viewport.style.maxHeight).toBe("");
  app.onhostcontextchanged({ displayMode: "inline" });
  expect(viewport.style.maxHeight).toBe("320px");
  await app.onteardown();
});

it("reuses a pending thumbnail read when a card returns to the viewport", async () => {
  const app = await open();
  const grid = document.querySelector<HTMLElement>("#gallery")!;
  Object.defineProperty(grid, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  let top = 0;
  grid.getBoundingClientRect = () => ({
    top, bottom: top, left: 0, right: 320, width: 320, height: 0, x: 0, y: top, toJSON() {},
  });
  let complete!: (value: { contents: { blob: string; mimeType: string }[] }) => void;
  const firstPreview = new Promise<{ contents: { blob: string; mimeType: string }[] }>(resolve => { complete = resolve; });
  app.readServerResource.mockImplementation(({ uri }: { uri: string }) =>
    uri.endsWith("/image-0") ? firstPreview : Promise.resolve({ contents: [] }),
  );
  app.ontoolresult(result(Array.from({ length: 100 }, (_, i) => ({
    id: `image-${i}`, title: `Image ${i}`, status: "done",
  }))));
  top = -3000;
  window.dispatchEvent(new Event("scroll"));
  expect(grid.querySelector('[data-image-id="image-0"]')).toBeNull();
  top = 0;
  window.dispatchEvent(new Event("scroll"));
  expect(app.readServerResource.mock.calls.filter(([request]: [{ uri: string }]) => request.uri.endsWith("/image-0"))).toHaveLength(1);
  complete({ contents: [{ blob: "AAAA", mimeType: "image/png" }] });
  await waitFor(() => {
    expect(grid.querySelector('[data-image-id="image-0"] img')?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
  await app.onteardown();
});

it("keeps loaded images and retries the same page after a connection error", async () => {
  const app = await open();
  app.ontoolinput({ arguments: { projectId: "project", limit: 1 } });
  app.ontoolresult(result([{ id: "one", title: "One", status: "queued" }], 1));
  app.callServerTool.mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(result([{ id: "two", title: "Two", status: "queued" }]));
  const more = document.querySelector<HTMLButtonElement>("#more")!;
  more.click();
  await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("Could not load more images. Try again."));
  expect(document.querySelector("#gallery")?.textContent).toBe("One");
  expect(more.disabled).toBe(false);
  more.click();
  await waitFor(() => expect(document.querySelectorAll("#gallery label")).toHaveLength(2));
  expect(app.callServerTool.mock.calls).toEqual(Array.from({ length: 2 }, () => [{
    name: "list_thumbnails", arguments: { projectId: "project", limit: 1, offset: 1 },
  }]));
  expect(more.hidden).toBe(true);
  await app.onteardown();
});

it("allows paging a new gallery while an older page request is still in flight", async () => {
  const app = await open();
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  app.callServerTool
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  const more = document.querySelector<HTMLButtonElement>("#more")!;
  const item = (id: string) => ({ id, title: id, status: "queued" });
  app.ontoolresult(result([item("Old")], 1));
  more.click();
  app.ontoolresult(result([item("New")], 1));
  expect(more.disabled).toBe(false);
  more.click();
  expect(app.callServerTool).toHaveBeenCalledTimes(2);
  finishOld(result([item("Stale")]));
  await Promise.resolve();
  expect(more.disabled).toBe(true);
  finishNew(result([item("Next")]));
  await waitFor(() => expect(document.querySelector("#gallery")?.textContent).toBe("NewNext"));
  await app.onteardown();
});

it("preserves unchanged loaded cards and rebuilds only changed records on refresh", async () => {
 const app=await open();
 app.readServerResource.mockResolvedValue({contents:[{mimeType:"image/png",blob:"YWJj"}]});
 const first={id:"one",title:"One",status:"done"};
 const second={id:"two",title:"Two",status:"queued"};
 app.ontoolresult(result([first,second]));
 await waitFor(()=>expect(document.querySelector<HTMLImageElement>('[data-image-id="one"] img')?.src).toContain('data:image/png'));
 const card=document.querySelector('[data-image-id="one"]');
 const oldSecond=document.querySelector('[data-image-id="two"]');
 app.ontoolresult(result([first,{...second,title:"Updated"}]));
 expect(document.querySelector('[data-image-id="one"]')).toBe(card);
 expect(document.querySelector('[data-image-id="two"]')).not.toBe(oldSecond);
 expect(app.readServerResource).toHaveBeenCalledTimes(1);
});
