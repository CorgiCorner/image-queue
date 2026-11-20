// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ app: undefined as any, visibility: undefined as any }));
vi.mock("../src/mcp/views/compact-app", () => ({
  CompactApp: class {
    ontoolresult: any;
    onhostcontextchanged: any;
    onteardown: any;
    callServerTool = vi.fn();
    openLink = vi.fn(async () => ({}));
    downloadFile = vi.fn(async () => ({}));
    canDownloadFiles = vi.fn(() => true);
    readServerResource = vi.fn(async () => ({contents:[]}));
    connect = vi.fn(async () => {});
    getHostContext = vi.fn(() => ({theme:"dark",styles:{variables:{"--color-text-primary":"white"}}}));
    constructor() {
      bridge.app = this;
    }
  },
  applyDocumentTheme: vi.fn(),
  applyHostStyleVariables: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
// The preview asks the app-only tool first, so the resource fallback starts a few microtasks later.
async function settle() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}
async function openView() {
  vi.resetModules();
  document.body.innerHTML =
    '<p role="status"></p><p id="workers-offline" role="note" hidden></p><p id="source"></p><p id="prompt"></p><pre id="path"></pre><button id="copy-path" hidden>Copy path</button><button id="open-app" hidden>Open in image-queue</button><button id="download" hidden>Download</button>';
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: unknown) { bridge.visibility = callback; }
      observe() {}
      disconnect() {}
    },
  );
  await import("../src/mcp/views/job");
  return bridge.app;
}
it("renders state and polls until completion", async () => {
  vi.useFakeTimers();
  const app = await openView();
  app.callServerTool.mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id: "one",
          status: "done",
          prompt: "A forest",
          outputPath: "result.png",
        }),
      },
    ],
  });
  app.ontoolresult({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id: "one",
          status: "queued",
          prompt: "A forest",
        }),
      },
    ],
  });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Queued");
  await vi.advanceTimersByTimeAsync(2000);
  expect(app.callServerTool).toHaveBeenCalledWith({
    name: "get_job_state",
    arguments: { id: "one" },
  });
  expect(document.querySelector("#path")?.textContent).toBe("result.png");
  bridge.visibility([{ isIntersecting: false }]);
  bridge.visibility([{ isIntersecting: true }]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(app.callServerTool.mock.calls.filter(([request]: [{ name: string }]) => request.name === "get_job_state")).toHaveLength(1);
  await app.onteardown();
});
it("handles malformed responses and deleted jobs", async () => {
  const app = await openView();
  app.ontoolresult({ content: [{ type: "text", text: "invalid" }] });
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Invalid response",
  );
  app.ontoolresult({
    content: [{ type: "text", text: '{"error":"Not found"}' }],
  });
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Not found",
  );
  await app.onteardown();
});

it("keeps failed-job details visible and clears the previous preview on navigation", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" src="data:image/png;base64,old">');
  app.ontoolresult({content:[{type:"text",text:JSON.stringify({id:"first",status:"failed",error:"Provider unavailable",prompt:"Original prompt",outputPath:"first.png"})}]});
  expect(document.querySelector("#prompt")?.textContent).toBe("Original prompt");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Failed: Provider unavailable");
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  expect(preview.hidden).toBe(true);
  expect(preview.hasAttribute("src")).toBe(false);
  await app.onteardown();
});

it("retries a failed preview when the same completed job is rendered again", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden>');
  app.readServerResource.mockRejectedValueOnce(new Error("temporary"));
  const result={content:[{type:"text",text:JSON.stringify({id:"one",status:"done",prompt:"Image"})}]};
  app.ontoolresult(result);
  await settle();
  app.ontoolresult(result);
  await settle();
  expect(app.readServerResource).toHaveBeenCalledTimes(2);
  await app.onteardown();
});

it("reports empty thumbnail responses and permits retry", async () => {
  const app = await openView();
  const result={content:[{type:"text",text:JSON.stringify({id:"one",status:"done",prompt:"Image"})}]};
  app.ontoolresult(result);
  await settle();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Ready. Preview unavailable.");
  app.ontoolresult(result);
  await settle();
  expect(app.readServerResource).toHaveBeenCalledTimes(2);
  await app.onteardown();
});

it("shows the preview from the app-only tool without reading the resource", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<div id="placeholder"></div><img id="preview" hidden>');
  app.callServerTool.mockImplementation(async ({ name }: { name: string }) => name === "read_thumbnail"
    ? { content: [{ type: "image", mimeType: "image/webp", data: "dG9vbA==" }] }
    : { content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "Image" }) }] });
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "Image" }) }] });
  await settle();
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "one" } });
  expect(preview.src).toBe("data:image/webp;base64,dG9vbA==");
  expect(preview.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("#placeholder")!.hidden).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Ready");
  expect(app.readServerResource).not.toHaveBeenCalled();
  await app.onteardown();
});

it("falls back to the thumbnail resource when the tool is refused", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden>');
  app.callServerTool.mockRejectedValue(new Error("Unknown tool"));
  app.readServerResource.mockResolvedValue({ contents: [{ blob: "cmVzb3VyY2U=", mimeType: "image/webp" }] });
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "Image" }) }] });
  await settle();
  expect(app.readServerResource).toHaveBeenCalledWith({ uri: "image-queue://thumbnail/one" });
  expect(document.querySelector<HTMLImageElement>("#preview")!.src).toBe("data:image/webp;base64,cmVzb3VyY2U=");
  await app.onteardown();
});

it("reports an unavailable preview only after the tool and the resource both fail", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden>');
  const job = { content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "Image" }) }] };
  app.callServerTool.mockImplementation(async ({ name }: { name: string }) => name === "read_thumbnail"
    ? { isError: true, content: [{ type: "text", text: "Image is unavailable" }] } : job);
  app.readServerResource.mockRejectedValue(new Error("Resource unavailable"));
  app.ontoolresult(job);
  await settle();
  expect(app.readServerResource).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Ready. Preview unavailable.");
  expect(document.querySelector<HTMLImageElement>("#preview")!.hidden).toBe(true);
  await app.onteardown();
});

it("ignores results after teardown", async () => {
  const app=await openView();
  await app.onteardown();
  app.ontoolresult({content:[{type:"text",text:JSON.stringify({id:"late",status:"done",prompt:"Late image"})}]});
  expect(document.querySelector("#prompt")?.textContent).toBe("");
  expect(app.readServerResource).not.toHaveBeenCalled();
});

it("applies the initial host theme after connecting", async () => {
  const {applyDocumentTheme,applyHostStyleVariables}=await import("../src/mcp/views/compact-app");
  await openView();
  await Promise.resolve();
  expect(applyDocumentTheme).toHaveBeenCalledWith("dark");
  expect(applyHostStyleVariables).toHaveBeenCalledWith({"--color-text-primary":"white"});
  await bridge.app.onteardown();
});

it("ignores an old thumbnail response after switching jobs", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden>');
  let resolveOld!: (result: unknown) => void;
  app.readServerResource.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  app.readServerResource.mockResolvedValueOnce({ contents: [{ blob: "bmV3", mimeType: "image/png" }] });
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "old", status: "done", prompt: "Old" }) }] });
  await settle();
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "new", status: "done", prompt: "New" }) }] });
  await settle();
  resolveOld({ contents: [{ blob: "b2xk", mimeType: "image/png" }] });
  await settle();
  expect(document.querySelector<HTMLImageElement>("#preview")!.src).toBe("data:image/png;base64,bmV3");
  expect(document.querySelector("#prompt")?.textContent).toBe("New");
  await app.onteardown();
});


it.each([
  { id: "one", status: "unknown", prompt: "Image" },
  { id: "one", status: "failed", prompt: "Image", error: {} },
  { error: {} },
  { id: "one", status: "done", prompt: {} },
  { id: "one", status: "done", prompt: "Image", outputPath: {} },
])("rejects malformed job data without reading a preview", async job => {
  const app = await openView();
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify(job) }] });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Invalid response from image-queue.");
  expect(app.readServerResource).not.toHaveBeenCalled();
  await app.onteardown();
});


it("clears the displayed preview when the job is moved to Trash", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" src="data:image/png;base64,b2xk">');
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({
    id: "one", status: "done", prompt: "Image", trashedAt: "2026-11-14",
  }) }] });
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  expect(preview.hidden).toBe(true);
  expect(preview.hasAttribute("src")).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("In Trash");
  expect(app.readServerResource).not.toHaveBeenCalled();
  await app.onteardown();
});


it("does not restore an in-flight preview after a trash update", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden>');
  let complete!: (value: unknown) => void;
  app.readServerResource.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const job = { id: "one", status: "done", prompt: "Image" };
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify(job) }] });
  await settle();
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ ...job, trashedAt: "2026-11-14" }) }] });
  complete({ contents: [{ blob: "b2xk", mimeType: "image/png" }] });
  await settle();
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  expect(preview.hidden).toBe(true);
  expect(preview.hasAttribute("src")).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("In Trash");
  await app.onteardown();
});


it("clears stale image content when the job no longer exists", async () => {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" src="data:image/png;base64,b2xk">');
  document.querySelector("#prompt")!.textContent = "Previous image";
  document.querySelector("#path")!.textContent = "previous.png";
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] });
  expect(document.querySelector("#prompt")?.textContent).toBe("");
  expect(document.querySelector("#path")?.textContent).toBe("");
  expect(document.querySelector<HTMLImageElement>("#preview")!.hidden).toBe(true);
  expect(document.querySelector("#preview")!.hasAttribute("src")).toBe(false);
  await app.onteardown();
});

it.each(["../private", "", "a".repeat(129), "has space", "one/two"])("rejects unsafe job identifier %s before reading resources", async id => {
  vi.useFakeTimers();
  const app = await openView();
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id, status: "done", prompt: "Image" }) }] });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Invalid response from image-queue.");
  expect(app.readServerResource).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(app.callServerTool).not.toHaveBeenCalled();
  await app.onteardown();
});

it.each([false, true])("ignores an old poll after a new job result, rejected=%s", async rejected => {
  vi.useFakeTimers();
  const app = await openView();
  let finish!: (value: any) => void;
  app.callServerTool.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = rejected ? reject : resolve; }));
  const response = (id: string, status: string) => ({ content: [{ type: "text", text: JSON.stringify({ id, status, prompt: id }) }] });
  app.ontoolresult(response("old", "queued"));
  await vi.advanceTimersByTimeAsync(2000);
  app.ontoolresult(response("new", "blocked"));
  finish(rejected ? new Error("Offline") : response("old", "running"));
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector("#prompt")?.textContent).toBe("new");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Blocked");
  await app.onteardown();
});

it("keeps only one poll in flight when visibility changes", async () => {
  vi.useFakeTimers();
  const app = await openView();
  app.callServerTool.mockImplementationOnce(() => new Promise(() => {}));
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "queued", prompt: "One" }) }] });
  await vi.advanceTimersByTimeAsync(2000);
  bridge.visibility([{ isIntersecting: false }]);
  bridge.visibility([{ isIntersecting: true }]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(app.callServerTool).toHaveBeenCalledTimes(1);
  await app.onteardown();
});

it("refreshes a terminal result when opening a saved conversation", async () => {
  const app = await openView();
  app.callServerTool.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ id: "saved", status: "cancelled", prompt: "Saved" }) }] });
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "saved", status: "done", prompt: "Saved" }) }] });
  await Promise.resolve();
  await Promise.resolve();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "get_job_state", arguments: { id: "saved" } });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Cancelled");
  await app.onteardown();
});

it("slows polling after thirty seconds of waiting for the same job", async () => {
  vi.useFakeTimers();
  const app = await openView();
  const response = { content: [{ type: "text", text: JSON.stringify({ id: "waiting", status: "queued", prompt: "Waiting" }) }] };
  app.callServerTool.mockResolvedValue(response);
  app.ontoolresult(response);
  await vi.advanceTimersByTimeAsync(30000);
  expect(app.callServerTool).toHaveBeenCalledTimes(15);
  await vi.advanceTimersByTimeAsync(9999);
  expect(app.callServerTool).toHaveBeenCalledTimes(15);
  await vi.advanceTimersByTimeAsync(1);
  expect(app.callServerTool).toHaveBeenCalledTimes(16);
  await app.onteardown();
});

it("reserves the requested image proportions", async () => {
  const app = await openView();
  const preview = document.createElement("img");
  preview.id = "preview";
  document.body.append(preview);
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "portrait", status: "queued", prompt: "Portrait", width: 1080, height: 1920 }) }] });
  expect(preview.width).toBe(1080);
  expect(preview.height).toBe(1920);
  expect(preview.style.aspectRatio).toBe("1080 / 1920");
  await app.onteardown();
});

it("keeps the placeholder hidden on repeated ready updates after preview loading", async () => {
  const app = await openView();
  const placeholder = document.createElement("div");
  placeholder.id = "placeholder";
  const preview = document.createElement("img");
  preview.id = "preview";
  document.body.append(placeholder, preview);
  const response = { content: [{ type: "text", text: JSON.stringify({ id: "ready", status: "done", prompt: "Ready", width: 256, height: 256 }) }] };
  app.readServerResource.mockResolvedValue({ contents: [{ blob: "aGVsbG8=", mimeType: "image/png" }] });
  app.callServerTool.mockResolvedValue(response);
  app.ontoolresult(response);
  await settle();
  app.ontoolresult(response);
  expect(placeholder.hidden).toBe(true);
  await app.onteardown();
});


it("copies the result path only when a path is available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const app = await openView();
  app.callServerTool.mockReturnValue(new Promise(() => {}));
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "copy", status: "done", prompt: "Copy", outputPath: "/images/result.png" }) }] });
  const button = document.querySelector<HTMLButtonElement>("#copy-path")!;
  expect(button.hidden).toBe(false);
  button.click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledWith("/images/result.png");
  expect(button.textContent).toBe("Copied");
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] });
  expect(button.hidden).toBe(true);
  await app.onteardown();
});

it("ignores an old clipboard result after switching jobs", async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
  const app = await openView();
  const response = (id: string) => ({ content: [{ type: "text", text: JSON.stringify({ id, status: "queued", prompt: id, outputPath: `/images/${id}.png` }) }] });
  app.ontoolresult(response("first"));
  const button = document.querySelector<HTMLButtonElement>("#copy-path")!;
  button.click();
  app.ontoolresult(response("second"));
  finish();
  await Promise.resolve();
  expect(button.textContent).toBe("Copy path");
  await app.onteardown();
});

it("opens the current job in the configured dashboard", async () => {
  const app = await openView();
  document.body.dataset.dashboard = encodeURIComponent("http://127.0.0.1:3247");
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "image-one", status: "queued", prompt: "Forest" }) }] });
  document.querySelector<HTMLButtonElement>("#open-app")!.click();
  await Promise.resolve();
  expect(app.openLink).toHaveBeenCalledWith({ url: "http://127.0.0.1:3247/jobs/image-one" });
  await app.onteardown();
});

it("shows the source and model for the current job", async () => {
  const app = await openView();
  const render = (job: object) => app.ontoolresult({ content: [{ type: "text", text: JSON.stringify(job) }] });
  render({ id: "one", prompt: "Forest", status: "queued", source: "queue" });
  expect(document.querySelector("#source")?.textContent).toBe("Codex queue");
  render({ id: "one", prompt: "Forest", status: "running", source: "queue", workerSlot: 2 });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Generating · Worker slot 2");
  render({ id: "one", prompt: "Forest", status: "running", source: "queue", workerSlot: 2, claim: { reserved: true } });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Reserved · Worker slot 2");
  render({ id: "two", prompt: "Forest", status: "queued", source: "api", provider: "openrouter", model: "vendor/image" });
  expect(document.querySelector("#source")?.textContent).toBe("OpenRouter · vendor/image");
  render({ error: "Not found" });
  expect(document.querySelector("#source")?.textContent).toBe("");
  await app.onteardown();
});

it("clears the worker warning when the pool responds or the job starts", async () => {
  const app = await openView();
  const job = { id: "one", source: "queue", prompt: "Forest", status: "queued" };
  const render = (patch: object) =>
    app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ ...job, ...patch }) }] });
  const notice = document.querySelector<HTMLElement>("#workers-offline")!;
  render({ workersOffline: true });
  expect(notice.hidden).toBe(false);
  expect(notice.textContent).toBe("Workers are offline. Requests will wait in the queue.");
  render({ workersOffline: false });
  expect(notice.hidden).toBe(true);
  render({ workersOffline: true });
  render({ status: "running", workersOffline: true });
  expect(notice.hidden).toBe(true);
  render({ workersOffline: false, queueNotice: "Queue stopped — action needed. Sign in to Codex. Requests will wait until you resume the queue." });
  expect(notice.hidden).toBe(false);
  expect(notice.textContent).toBe("Queue stopped — action needed. Sign in to Codex. Requests will wait until you resume the queue.");
  render({ workersOffline: false });
  expect(notice.hidden).toBe(true);
  await app.onteardown();
});

it("selects the full output path when the host denies clipboard access", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"));
  const clipboard = vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
  const app = await openView();
  try {
    app.callServerTool.mockReturnValue(new Promise(() => {}));
    const outputPath = "/images/project folder/result.png";
    app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({
      id: "copy", status: "done", prompt: "Copy", outputPath,
    }) }] });
    const button = document.querySelector<HTMLButtonElement>("#copy-path")!;
    button.click();
    await Promise.resolve();
    expect(button.textContent).toBe("Path selected. Copy it manually.");
    expect(window.getSelection()?.toString()).toBe(outputPath);
    app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({
      id: "copy", status: "done", prompt: "Copy", outputPath,
    }) }] });
    expect(button.textContent).toBe("Path selected. Copy it manually.");
    expect(window.getSelection()?.toString()).toBe(outputPath);
  } finally {
    window.getSelection()?.removeAllRanges();
    clipboard.mockRestore();
    await app.onteardown();
  }
});

it("keeps the last request visible during a connection loss and recovers on the next poll", async () => {
  vi.useFakeTimers();
  const app = await openView();
  const result = (status: string) => ({
    content: [{ type: "text", text: JSON.stringify({ id: "one", status, prompt: "Forest" }) }],
  });
  app.callServerTool.mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(result("cancelled"));
  app.ontoolresult(result("queued"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.querySelector('[role="status"]')?.textContent)
    .toBe("Connection unavailable. Showing the last known request.");
  expect(document.querySelector("#prompt")?.textContent).toBe("Forest");
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Cancelled");
  await vi.advanceTimersByTimeAsync(30000);
  expect(app.callServerTool).toHaveBeenCalledTimes(2);
  await app.onteardown();
});

it("keeps the loaded preview and copy state through an unchanged job refresh", async () => {
  const app=await openView();
  document.body.insertAdjacentHTML("beforeend",'<img id="preview" hidden>');
  app.readServerResource.mockResolvedValue({contents:[{blob:"YWJj",mimeType:"image/png"}]});
  const job={id:"stable",status:"done",prompt:"Stable image",outputPath:"/output/stable.png"};
  const result={content:[{type:"text",text:JSON.stringify(job)}]};
  app.ontoolresult(result);
  await settle();
  const preview=document.querySelector<HTMLImageElement>('#preview')!;
  const source=preview.src;
  const copy=document.querySelector<HTMLButtonElement>('#copy-path')!;
  copy.textContent="Copied";
  app.ontoolresult(result);
  expect(document.querySelector('#preview')).toBe(preview);
  expect(preview.src).toBe(source);
  expect(preview.hidden).toBe(false);
  expect(copy.textContent).toBe("Copied");
  expect(app.readServerResource).toHaveBeenCalledTimes(1);
  await app.onteardown();
});

it("offers a full-size download for a finished image and hands it to the host", async () => {
  const app = await openView();
  const file = { uri: "image-queue://image/one.png", mimeType: "image/png", blob: "UE5H" };
  app.callServerTool.mockImplementation(async ({ name }: { name: string }) =>
    name === "read_image_file" ? { content: [{ type: "resource", resource: file }] } : { isError: true, content: [] });
  document.body.insertAdjacentHTML("beforeend", '<div id="placeholder" hidden></div>');
  const download = document.querySelector<HTMLButtonElement>("#download")!;
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "running", prompt: "A forest" }) }] });
  expect(download.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#placeholder")?.dataset.label).toBe("Generating…");
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "A forest" }) }] });
  expect(download.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("#placeholder")?.dataset.label).toBe("Loading preview…");
  download.click();
  await settle();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_image_file", arguments: { id: "one" } });
  expect(app.downloadFile).toHaveBeenCalledWith({ contents: [{ type: "resource", resource: file }] });
  expect(download.textContent).toBe("Download");
});

it("opens the full image when the host cannot save files", async () => {
  const app = await openView();
  app.canDownloadFiles.mockReturnValue(false);
  app.callServerTool.mockResolvedValue({ isError: true, content: [] });
  document.body.dataset.dashboard = encodeURIComponent("https://app.example.com");
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "one", status: "done", prompt: "A forest" }) }] });
  document.querySelector<HTMLButtonElement>("#download")!.click();
  await settle();
  expect(app.openLink).toHaveBeenCalledWith({ url: "https://app.example.com/api/asset?job=one" });
  delete document.body.dataset.dashboard;
});

const gifJob = { content: [{ type: "text", text: JSON.stringify({ id: "gif", status: "done", prompt: "A corgi typing", outputFormat: "gif" }) }] };
function previewResult(data: string, animated: boolean) {
  return { content: [{ type: "image", mimeType: "image/webp", data }, { type: "text", text: JSON.stringify({ animated }) }] };
}
async function openGifView(tool: (call: { name: string; arguments: Record<string, unknown> }) => unknown) {
  const app = await openView();
  document.body.insertAdjacentHTML("beforeend", '<img id="preview" hidden><button id="play" hidden>Play animation</button>');
  // The view was imported before these elements existed, so load it again with them in place.
  vi.resetModules();
  await import("../src/mcp/views/job");
  bridge.app.callServerTool.mockImplementation(async (call: any) => tool(call));
  return bridge.app as typeof app;
}

it("plays a GIF in the request view through an animated preview", async () => {
  const app = await openGifView(({ name }) => name === "read_thumbnail" ? previewResult("YW5pbQ==", true) : { isError: true, content: [] });
  app.ontoolresult(gifJob);
  await settle();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "gif", animated: true } });
  expect(document.querySelector<HTMLImageElement>("#preview")!.src).toBe("data:image/webp;base64,YW5pbQ==");
  expect(document.querySelector<HTMLButtonElement>("#play")!.hidden).toBe(true);
});

it("shows a still with Play under reduced motion and starts the animation on request", async () => {
  // The view's stylesheet sets this under the reduced-motion media query.
  document.documentElement.style.setProperty("--motion-reduced", "1");
  const app = await openGifView(({ name, arguments: args }) =>
    name === "read_thumbnail" ? previewResult(args.animated ? "YW5pbQ==" : "c3RpbGw=", Boolean(args.animated)) : { isError: true, content: [] });
  app.ontoolresult(gifJob);
  await settle();
  const preview = document.querySelector<HTMLImageElement>("#preview")!;
  const play = document.querySelector<HTMLButtonElement>("#play")!;
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "gif" } });
  expect(preview.src).toBe("data:image/webp;base64,c3RpbGw=");
  expect(play.hidden).toBe(false);
  play.click();
  await settle();
  expect(preview.src).toBe("data:image/webp;base64,YW5pbQ==");
  expect(play.hidden).toBe(true);
  document.documentElement.style.removeProperty("--motion-reduced");
});

it("plays the full file when the preview service returned one frame", async () => {
  const app = await openGifView(({ name }) =>
    name === "read_thumbnail" ? previewResult("c3RpbGw=", false)
      : name === "read_image_file" ? { content: [{ type: "resource", resource: { uri: "image-queue://image/gif.gif", mimeType: "image/gif", blob: "R0lG" } }] }
        : { isError: true, content: [] });
  app.ontoolresult(gifJob);
  await settle();
  const play = document.querySelector<HTMLButtonElement>("#play")!;
  expect(play.hidden).toBe(false);
  play.click();
  await settle();
  expect(document.querySelector<HTMLImageElement>("#preview")!.src).toBe("data:image/gif;base64,R0lG");
  expect(play.hidden).toBe(true);
});

it("keeps Play away from images that are not GIFs", async () => {
  const app = await openGifView(({ name }) => name === "read_thumbnail" ? previewResult("c3RpbGw=", false) : { isError: true, content: [] });
  app.ontoolresult({ content: [{ type: "text", text: JSON.stringify({ id: "png", status: "done", prompt: "A fox" }) }] });
  await settle();
  expect(app.callServerTool).toHaveBeenCalledWith({ name: "read_thumbnail", arguments: { id: "png" } });
  expect(document.querySelector<HTMLButtonElement>("#play")!.hidden).toBe(true);
});
