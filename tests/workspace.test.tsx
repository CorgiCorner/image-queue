// @vitest-environment happy-dom
import userEvent from "@testing-library/user-event";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/select-input", () => ({
  SelectInput: ({
    id,
    label,
    value,
    onValueChange,
    options,
    placeholder,
  }: {
    id?: string;
    label: string;
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string; disabled?: boolean }[];
    placeholder?: string;
  }) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("../src/actions", () => ({
  retryImageAction: vi.fn(async () => ({data:{...state.jobs[1],id:"IMG-retry"}})),
  inspectReservationAction: vi.fn(async()=>({data:{...state.jobs[0],status:"uncertain"}})),
  markUncertainFailedAction: vi.fn(async () => ({data:{...state.jobs[0],status:"failed"}})),
  pinAction: vi.fn(async () => ({data:{}})),
  purgeAction: vi.fn(async () => ({data:{deleted:["IMG-first"]}})),
  createTopicAction: vi.fn(async () => ({ data: {} })),
  createProjectAction: vi.fn(async () => ({ data: { id: "new-project" } })),
  addNoteAction: vi.fn(async () => ({ data: { id: "saved-note" } })),
  requestImageAction: vi.fn(async () => ({ data: { id: "IMG-new" } })),
  generationSourceAction: vi.fn(async ({source,model}: {source:"api"|"queue";model?:string})=>({data:{source,provider:"openai",...(model?{model}:{})}})),
  connectAction: vi.fn(async () => ({ data: [] })),
  tagImageAction: vi.fn(async () => ({})),
  editTagAction: vi.fn(async () => ({})),
  rebuildIndexAction: vi.fn(async () => ({ data: { rebuilt: true } })),
  moveToTopicAction: vi.fn(async () => ({})),
  joinStackAction: vi.fn(async () => ({})),
  moveJobAction: vi.fn(async () => ({})),
  cancelAction: vi.fn(async () => ({})),
  processingAction: vi.fn(async () => ({})),
  poolConfigAction: vi.fn(async () => ({})),
  pauseLocalRunnerAction: vi.fn(async () => ({})),
  retryBlockedQueueAction: vi.fn(async () => ({data:{queued:[],failures:[]}})),
  pathSettingsAction: vi.fn(async () => ({})),
  disconnectAction: vi.fn(async () => ({})),
  testConnectionAction: vi.fn(async () => ({ data: { models: 3 } })),
  retentionAction: vi.fn(async () => ({data:{changed:["IMG-first"],skipped:[],undoId:"undo-one"}})),
  undoRetentionAction: vi.fn(async () => ({})),
}));
vi.mock("../src/components/gallery", () => ({
  Gallery: ({ jobs, onOpen, onSelection }: any) => (
    <div>
      <button
        type="button"
        onClick={() => onSelection(jobs.map((j: any) => j.id))}
      >
        Select images
      </button>
      {jobs.map((job: any) => (
        <button type="button" key={job.id} data-job-id={job.id} onClick={() => onOpen(job)}>
          Open {job.id}
        </button>
      ))}
    </div>
  ),
  imageUrl: (job: any) => `/api/asset?job=${job.id}`,
}));
vi.mock("../src/components/image-preview", () => ({
  ImagePreview: ({ selection }: { selection?: { w?: number; h?: number } }) => <div className="progressive-image">Image preview
    {selection?.w !== undefined && selection.h !== undefined && <span className="annotation-region-draft" style={{ width: `${selection.w * 100}%`, height: `${selection.h * 100}%` }} />}
  </div>,
}));

import {
  connectAction,
  rebuildIndexAction,
  retryImageAction,
  markUncertainFailedAction,
  createProjectAction,
  addNoteAction,
  createTopicAction,
  processingAction,
  poolConfigAction,
  generationSourceAction,
  requestImageAction,
  moveJobAction,
  cancelAction,
  pathSettingsAction,
} from "../src/actions";
import { Workspace } from "../src/components/workspace";

const state = {
  projects: [
    { id: "project", name: "Project One" },
    { id: "project-two", name: "Project Two" },
  ],
  jobs: [
    {
      id: "IMG-first",
      projectId: "project",
      prompt: "A red panda",
      status: "done",
      source: "queue",
      width: 1024,
      height: 1024,
      referenceIds: [],
      transparent: false,
    },
    {
      id: "IMG-queued",
      projectId: "project",
      prompt: "A forest",
      status: "queued",
      source: "queue",
      width: 1024,
      height: 1024,
      referenceIds: [],
      transparent: false,
    },
  ],
  references: [],
  models: [
    {
      id: "gpt-image-test",
      sizeProfile: { mode: "fixed", sizes: [{width:1024,height:1024},{width:1536,height:1024},{width:1024,height:1536}] },
      name: "Image test",
      provider: "openai",
      transparency: true,
      references: true,
    },
  ],
  pool: {
    workers: 4,
    idleMinutes: 5,
    activeMinutes: 1,
    activityWindowMinutes: 10,
  },
  pulses: [],
  cloud: false,
};
beforeEach(() => {
  window.localStorage.removeItem("image-queue-custom-sizes");
  window.history.replaceState({}, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(state) })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function ready() {
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-first" });
}
it("shows the annotation area during dragging and clears a cancelled selection", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  const image = document.querySelector<HTMLElement>(".progressive-image")!;
  const preview = document.querySelector<HTMLElement>(".detail-preview")!;
  image.getBoundingClientRect = () => ({ left: 100, top: 100, width: 400, height: 300 }) as DOMRect;
  preview.setPointerCapture = vi.fn();
  fireEvent.pointerDown(image, { button: 0, pointerId: 7, clientX: 140, clientY: 130 });
  fireEvent.pointerMove(preview, { pointerId: 7, clientX: 260, clientY: 220 });
  const draft = document.querySelector<HTMLElement>(".annotation-region-draft")!;
  expect(draft).not.toBeNull();
  expect(Number.parseFloat(draft.style.width)).toBeCloseTo(30);
  expect(Number.parseFloat(draft.style.height)).toBeCloseTo(30);
  fireEvent.pointerCancel(preview, { pointerId: 7 });
  expect(document.querySelector(".annotation-region-draft")).toBeNull();
  expect(addNoteAction).not.toHaveBeenCalled();
});
describe("workspace flows", () => {
  it("disables the shared current project and ignores a no-op move", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Select images" }));
    const select = screen.getByRole("combobox", { name: "Move selected images" });
    const option = [...select.querySelectorAll("option")].find(option => option.value === "project");
    expect(option?.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "project" } });
    expect(moveJobAction).not.toHaveBeenCalled();
    expect(screen.getByText("2 selected")).toBeTruthy();
  });
  it("loads projects, filters and toggles theme", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    expect(
      screen.queryByRole("button", { name: "Open IMG-queued" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Everything/ }));
    fireEvent.change(screen.getByLabelText("Search images"), {
      target: { value: "forest" },
    });
    expect(screen.queryByRole("button", { name: "Open IMG-first" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Toggle color theme"));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
    window.localStorage.removeItem("image-queue-theme");
  });
  it("submits a validated image request and clears the prompt", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Image prompt"), {
      target: { value: "A glossy red panda" },
    });
    fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
    await waitFor(() => expect(requestImageAction).toHaveBeenCalled());
    expect(vi.mocked(requestImageAction).mock.calls[0][0]).toMatchObject({
      prompt: "A glossy red panda",
      source: "queue",
    });
    await screen.findByText("Added to the Codex queue");
  });
  it("labels imported images independently of their stored generation source and hides expansion for short text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      ...structuredClone(state), jobs: [{ ...state.jobs[0], imported: true, prompt: "Imported photo", source: "api", model: "old-model" }],
    }) })));
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Open IMG-first" }));
    expect(await screen.findByText("Imported", { selector: ".detail-metadata" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.queryByText(/old-model/, { selector: ".detail-metadata" })).toBeNull();
  });
  it("gives long project and file titles independent layout regions", async () => {
    const projectName = "A deliberately long project name for production photographs";
    const filename = "portrait-with-a-blue-hat.png";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      ...structuredClone(state), projects: [{ ...state.projects[0], name: projectName }],
      jobs: [{ ...state.jobs[0], originalName: filename }],
    }) })));
    const { container } = render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Open IMG-first" }));
    expect(container.ownerDocument.querySelector(".image-detail-project")?.textContent).toBe(projectName);
    expect(container.ownerDocument.querySelector(".image-detail-filename")?.textContent).toContain(filename);
  });
  it("creates a project through the dialog", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(await screen.findByLabelText("Project name"), {
      target: { value: "Product art" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(createProjectAction).toHaveBeenCalledWith({ name: "Product art" }),
    );
  });
  it("shows provider settings and saves the fixed worker configuration", async () => {
    render(<Workspace settingsPage />);
    await screen.findByLabelText("API key");
    fireEvent.change(await screen.findByLabelText("API key"), {
      target: { value: "test-key-value-123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Connect & load models|Update key & refresh models/ }),
    );
    await waitFor(() => expect(connectAction).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Active workers"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Worker chat model"), { target: { value: "gpt-6.1-terra" } });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "high" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save worker settings" }),
    );
    await waitFor(() =>
      expect(poolConfigAction).toHaveBeenCalledWith(
        expect.objectContaining({ workers: 2, workerModel: "gpt-6.1-terra", workerEffort: "high" }),
      ),
    );
  });
  it("opens details and reuses the prompt", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
    await screen.findByText("Image preview");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reuse prompt" }));
    expect(
      (screen.getByLabelText("Image prompt") as HTMLTextAreaElement).value,
    ).toBe("A red panda");
  });
  it("opens the reference library", async () => {
    await ready();
    fireEvent.click(screen.getByLabelText("Attach image reference"));
    await screen.findByText("Reference library");
    expect(
      screen.getByRole("button", { name: "Upload reference" }),
    ).toBeTruthy();
  });
  it("reports fetch failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    render(<Workspace />);
    await screen.findByText("Could not load workspace");
  });
});

describe("workspace edge cases and interactions", () => {
  it("opens empty projects and focuses the composer with its shortcut", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...structuredClone(state),
          projects: [],
          jobs: [],
        }),
      })),
    );
    render(<Workspace />);
    await screen.findByText("Your next idea starts here");
    fireEvent.change(screen.getByLabelText("Image prompt"), {
      target: { value: "An image" },
    });
    expect(screen.getByLabelText("Generation source")).toHaveProperty("value", "api");
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Image model").value).toBe("gpt-image-test"));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText("Keep related images and references together.");
    fireEvent.keyDown(window, { key: "n" });
  });
  it("navigates projects, queue and empty search results", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Project Two 0" }));
    expect(await screen.findByText("Your next idea starts here")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Queue 1" }));
    expect(
      screen.getByRole("button", { name: "Open IMG-queued" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search images"), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByText("No matching requests")).toBeTruthy();
  });
  it("selects an API provider and model", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Generation source"), {
      target: { value: "api" },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "google" },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Image model"), {
      target: { value: "gpt-image-test" },
    });
    fireEvent.change(screen.getByLabelText("Image size"), {
      target: { value: "1536x1024" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Transparent" }));
    fireEvent.change(screen.getByLabelText("Image prompt"), {
      target: { value: "A new image" },
    });
    fireEvent.keyDown(screen.getByLabelText("Image prompt"), {
      key: "Enter",
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(requestImageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "api",
          width: 1536,
          transparent: true,
        }),
      ),
    );
    await screen.findByText("Generation started");
  });
  it("shows request failures and dismisses the notice", async () => {
    vi.mocked(requestImageAction).mockResolvedValueOnce({
      serverError: "Request failed",
    } as never);
    await ready();
    fireEvent.change(screen.getByLabelText("Image prompt"), {
      target: { value: "A new image" },
    });
    fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
    await screen.findByText("Request failed");
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    await waitFor(() => expect(screen.queryByText("Request failed")).toBeNull());
  });
  it("reports project and connection errors", async () => {
    vi.mocked(createProjectAction).mockResolvedValueOnce({
      validationErrors: { name: ["Bad"] },
    } as never);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(await screen.findByLabelText("Project name"), {
      target: { value: "Bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText("Please check the form fields");
  });
  it("moves a selection into another project", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Select images" }));
    fireEvent.change(screen.getByLabelText("Move selected images"), {
      target: { value: "project-two" },
    });
    expect((await screen.findByText("Moved 2 images to Project Two.")).closest("[role=status]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select images" }));
    fireEvent.click(screen.getByLabelText("Clear selection"));
    expect(screen.queryByText("2 selected")).toBeNull();
  });
  it("renders worker pulse states and copies the MCP config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...structuredClone(state),
          pulses: [
            { slot: 1, lastWake: new Date().toISOString(), mode: "active" },
            { slot: 2, lastWake: new Date().toISOString(), mode: "disabled" },
            { slot: 3, lastWake: new Date().toISOString(), draining: true },
            { slot: 4, lastWake: "2020-01-01" },
          ],
        }),
      })),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() },
    });
    render(<Workspace settingsPage />);
    await screen.findByLabelText("API key");
    await screen.findByText("Finishing current image");
    expect(screen.getByText("Heartbeat overdue")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Idle interval (minutes)"), {
      target: { value: "10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Codex configuration" }),
    );
    await screen.findByText("Codex configuration copied");
  });
  it("uploads an image reference and handles a failed upload", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        String(input).includes("/upload")
          ? {
              ok: !fail,
              json: async () =>
                fail
                  ? { error: "Upload rejected" }
                  : { id: "ref", kind: "image" },
            }
          : {
              ok: true,
              json: async () => ({
                ...structuredClone(state),
                references: [
                  {
                    id: "ref",
                    projectId: "project",
                    name: "reference.png",
                    kind: "image",
                    blobKey: "refs/ref",
                  },
                ],
              }),
            },
      ),
    );
    await ready();
    const input = screen.getByTestId("reference-file-input")!;
    fireEvent.change(input, {
      target: {
        files: [new File(["x"], "reference.png", { type: "image/png" })],
      },
    });
    await screen.findByLabelText("Remove reference.png");
    fireEvent.click(screen.getByLabelText("Remove reference.png"));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Image prompt" }));
    fail = true;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "fail.png", { type: "image/png" })] },
    });
    await screen.findByText("Upload rejected");
  });
  it("reports a provider connection error", async () => {
    vi.mocked(connectAction).mockResolvedValueOnce({
      serverError: "Invalid key",
    } as never);
    render(<Workspace settingsPage />);
    await screen.findByLabelText("API key");
    fireEvent.change(await screen.findByLabelText("API key"), {
      target: { value: "invalid-key-123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Connect & load models|Update key & refresh models/ }),
    );
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Invalid key");
    expect(error.classList.contains("field-error")).toBe(true);
    expect(document.querySelector(".toast")).toBeNull();
    const key = screen.getByLabelText("API key");
    expect(key.getAttribute("aria-describedby")).toBe(error.id);
    expect(key.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(key, { target: { value: "replacement-fixture" } });
    expect(screen.queryByText("Invalid key")).toBeNull();
  });
  it("shows API-only mode for a Cloudflare workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...structuredClone(state), cloud: true }),
      })),
    );
    await ready();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Generation source") as HTMLSelectElement).value,
      ).toBe("api"),
    );
    // The sidebar names the source in use instead of a Codex queue that cannot run there.
    const status = document.querySelector(".generation-status")!;
    expect(status.textContent).toContain("OpenAI API");
    expect(screen.queryByText("Local companion required")).toBeNull();
    expect(screen.queryByLabelText("Active generation source")).toBeNull();
  });
});

it("opens a deep-linked job and moves it between projects", async () => {
  render(<Workspace initialJob="IMG-first" initialProject="project" />);
  await screen.findByText("Image preview");
  fireEvent.change(document.querySelector("#move-project")!, {
    target: { value: "project-two" },
  });
  await waitFor(() => expect(vi.mocked(moveJobAction)).toHaveBeenCalled());
});
it("cancels a queued request and reports cancellation failures", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-queued" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await waitFor(() => expect(cancelAction).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-queued" }));
  vi.mocked(cancelAction).mockResolvedValueOnce({
    serverError: "Already claimed",
  } as never);
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await screen.findByText("Already claimed");
});
it("disables using a GIF or SVG result as a reference", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), jobs: [{ ...state.jobs[0], outputFormat: "gif", source: "api" }] }),
  })));
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Open IMG-first" }));
  expect(screen.getByRole("button", { name: "Use as reference" })).toHaveProperty("disabled", true);
  expect(document.getElementById("reference-format-reason")?.textContent).toBe("GIF and SVG results cannot be used as references.");
});
it("downloads a WebP result with a matching file extension", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), jobs: [{ ...state.jobs[0], outputFormat: "webp", source: "api" }] }),
  })));
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Open IMG-first" }));
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(names).toEqual(["IMG-first.webp"]);
});
it("downloads and reuses a generated image as a reference", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      String(input).includes("/api/asset")
        ? {
            ok: true,
            blob: async () => new Blob(["png"], { type: "image/png" }),
          }
        : String(input).includes("/api/upload")
          ? { ok: true, json: async () => ({ id: "ref", kind: "image" }) }
          : { ok: true, json: async () => structuredClone(state) },
    ),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await ready();
  const composer = screen.getByRole("textbox", { name: "Image prompt" });
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  fireEvent.click(screen.getByRole("button", { name: "Use as reference" }));
  await waitFor(() => expect(document.activeElement).toBe(composer), { timeout: 5000 });
  expect(screen.queryByText("References added")).toBeNull();
});
it("shows errors when reusing or moving a result fails", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  vi.mocked(moveJobAction).mockResolvedValueOnce({
    serverError: "Cannot move",
  } as never);
  fireEvent.change(document.querySelector("#move-project")!, {
    target: { value: "project-two" },
  });
  await screen.findByText("Cannot move");
  fireEvent.click(screen.getByRole("button", { name: "Use as reference" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("blob"),
  );
});
it("saves the first reference file to Inbox", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...structuredClone(state), projects: [], jobs: [] }),
    })),
  );
  render(<Workspace />);
  await screen.findByText("Your next idea starts here");
  fireEvent.change(screen.getByTestId("reference-file-input")!, {
    target: { files: [new File(["x"], "x.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" })));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("toggles mobile navigation and generation options", async () => {
  const { container } = render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
  expect(container.querySelector(".mobile-menu-open")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".mobile-menu-open")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Toggle navigation" }));
  fireEvent.click(screen.getByRole("button", { name: "Image options" }));
  expect(container.querySelector(".composer-expanded")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide options" }));
  expect(container.querySelector(".composer-expanded")).toBeNull();
});
it("submits distinct stable keys for image variants", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image variants"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Image prompt"), {
    target: { value: "A landscape in watercolor" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^(Generate image|Add to queue)$/ }));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledTimes(3));
  const keys = vi
    .mocked(requestImageAction)
    .mock.calls.map(([input]) => input.idempotencyKey);
  expect(new Set(keys).size).toBe(3);
});

it("saves local directories from settings", async () => {
  render(<Workspace settingsPage />);
  const queue = await screen.findByLabelText("Queue directory");
  fireEvent.change(queue, { target: { value: "/queue" } });
  fireEvent.change(screen.getByLabelText("Allowed reference directories"), {
    target: { value: "/images\n/references" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save directories" }));
  await waitFor(() =>
    expect(pathSettingsAction).toHaveBeenCalledWith({
      queueDirectory: "/queue",
      referenceDirectories: ["/images", "/references"],
    }),
  );
  await waitFor(() => expect(document.querySelector("#local-directories .saved-status")?.getAttribute("data-visible")).toBe("true"));
});
it("navigates details and copies the prompt", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("A red panda");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(screen.getByText("A forest")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(screen.getByText("A red panda")).toBeTruthy();
});
it("reports directory-save failures", async () => {
  vi.mocked(pathSettingsAction).mockResolvedValueOnce({
    serverError: "Directory unavailable",
  } as never);
  render(<Workspace settingsPage />);
  await screen.findByLabelText("Queue directory");
  fireEvent.change(screen.getByLabelText("Queue directory"), {
    target: { value: "/queue" },
  });
  fireEvent.change(screen.getByLabelText("Allowed reference directories"), {
    target: { value: "/refs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save directories" }));
  await screen.findByText("Directory unavailable");
});
it("disconnects a provider and changes the settings provider", async () => {
  const { disconnectAction } = await import("../src/actions");
  render(<Workspace settingsPage />);
  await screen.findByLabelText("API key");
  fireEvent.change(screen.getByLabelText("Provider"), {
    target: { value: "google" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await waitFor(() =>
    expect(disconnectAction).toHaveBeenCalledWith({ provider: "openai" }),
  );
});
it("tests a connected provider beside its disconnect action", async () => {
  const { testConnectionAction, disconnectAction } = await import("../src/actions");
  render(<Workspace settingsPage />);
  await screen.findByLabelText("API key");
  const test = screen.getByRole("button", { name: "Test connection" });
  expect(test.parentElement).toBe(screen.getByRole("button", { name: "Disconnect" }).parentElement);
  fireEvent.click(test);
  const confirmation = await screen.findByText("Connection works. 3 image models available.");
  expect(confirmation.closest(".toast")).toBeTruthy();
  expect(document.querySelector(".settings-notice")).toBeNull();
  expect(test.closest("li")?.querySelector(".settings-list-meta")?.textContent).toBe("1 model");
  expect(testConnectionAction).toHaveBeenCalledWith({ provider: "openai" });
  expect(disconnectAction).not.toHaveBeenCalled();
});
it("keeps a failed connection test beside the provider", async () => {
  const { testConnectionAction } = await import("../src/actions");
  vi.mocked(testConnectionAction).mockResolvedValueOnce({
    serverError: "The provider rejected this API key (401). Check the key and try again.",
  } as never);
  render(<Workspace settingsPage />);
  await screen.findByLabelText("API key");
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  const error = await screen.findByText("The provider rejected this API key (401). Check the key and try again.");
  expect(error.closest(".settings-list-meta")).toBeTruthy();
  expect(error.closest(".toast")).toBeNull();
  expect(document.querySelector(".settings-notice")).toBeNull();
});
it("copies an output path and focuses the prompt", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...structuredClone(state),
        jobs: [
          { ...state.jobs[0], outputPath: "/queue/out/image.png" },
          state.jobs[1],
        ],
      }),
    })),
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "New image" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Image prompt")));
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    "/queue/out/image.png",
  );
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(screen.getByText("A red panda")).toBeTruthy();
});
it("initializes the queue view from its URL", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  try {
    render(<Workspace />);
    await screen.findByRole("button", { name: "Open IMG-queued" });
    expect(screen.queryByRole("button", { name: "Open IMG-first" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open IMG-queued" }),
    ).toBeTruthy();
  } finally {
    window.history.replaceState({}, "", "/");
  }
});
it("handles settings navigation and provider disconnect errors", async () => {
  const { disconnectAction } = await import("../src/actions");
  vi.mocked(disconnectAction).mockResolvedValueOnce({
    serverError: "Cannot disconnect",
  } as never);
  render(<Workspace settingsPage />);
  await screen.findByLabelText("API key");
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  const failure = await screen.findByText("Cannot disconnect");
  expect(failure.classList.contains("settings-notice")).toBe(true);
  expect(document.querySelector(".toast")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^All images/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Queue/ }));
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  await screen.findByLabelText("Project name");
});
it("opens settings shortcuts from the workspace", async () => {
  await ready();
  fireEvent.click(
    screen.getByRole("button", { name: "Settings" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect agent" }));
  expect(routerPush).toHaveBeenLastCalledWith("/settings#agent-connection");
  fireEvent.click(screen.getByRole("button", { name: /^All images/ }));
});
it("opens the empty API connection path", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...structuredClone(state), models: [] }),
    })),
  );
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), {
    target: { value: "api" },
  });
  expect(screen.getByRole("button", {
    name: /^(Generate image|Add to queue)$/,
    description: "Describe the image first.",
  })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: /Connect OpenAI/ }));
});
it("reports worker settings and bulk move errors", async () => {
  vi.mocked(poolConfigAction).mockResolvedValueOnce({
    serverError: "Pool update failed",
  } as never);
  const view = render(<Workspace settingsPage />);
  await screen.findByLabelText("API key");
  fireEvent.click(screen.getByRole("button", { name: "Save worker settings" }));
  await screen.findByText("Pool update failed");
  view.unmount();
  await ready();
  vi.mocked(moveJobAction).mockResolvedValueOnce({
    serverError: "Bulk move failed",
  } as never);
  fireEvent.click(screen.getByRole("button", { name: "Select images" }));
  fireEvent.change(screen.getByLabelText("Move selected images"), {
    target: { value: "project-two" },
  });
  await screen.findByText("Bulk move failed");
});
it("closes image details and opens the upload picker", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.keyDown(window,{key:"a"});
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  fireEvent.click(screen.getByLabelText("Attach image reference"));
  const picker=screen.getByTestId("reference-file-input") as HTMLInputElement;
  const click=vi.spyOn(picker,"click");
  fireEvent.click(screen.getByRole("button",{name:"Upload reference"}));
  expect(click).toHaveBeenCalled();
});
it("keeps an open workspace when periodic refresh fails", async () => {
  await ready();
  vi.useFakeTimers();
  try {
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("offline");}));
    await vi.advanceTimersByTimeAsync(30000);
    expect(screen.getByRole("button",{name:"Open IMG-first"})).toBeTruthy();
  } finally {vi.useRealTimers();}
});
it("resets incompatible dimensions when changing generation source", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"),{target:{value:"1792x1024"}});
  fireEvent.change(screen.getByLabelText("Generation source"),{target:{value:"api"}});
  await waitFor(()=>expect((screen.getByLabelText("Image size") as HTMLSelectElement).value).toBe("1024x1024"));
});
it("imports an Inbox batch sequentially and reports each outcome", async () => {
  let finishFirst!: () => void;
  const first = new Promise<void>(resolve => { finishFirst = resolve; });
  let finishSecond!: () => void;
  const second = new Promise<void>(resolve => { finishSecond = resolve; });
  const submitted: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init?: RequestInit) => {
    if (String(input) !== "/api/import") return { ok: true, json: async () => structuredClone(state) };
    const form = init?.body as FormData;
    expect(form.get("projectId")).toBe("inbox");
    const name = (form.get("file") as File).name;
    submitted.push(name);
    if (name === "first.png") await first;
    if (name === "second-batch.png") await second;
    return {
      ok: name !== "bad.png",
      json: async () => name === "bad.png" ? { error: "Invalid image" } : { duplicate: name === "existing.png", job: { projectId: "inbox" } },
    };
  }));
  await ready();
  const files = ["first.png", "bad.png", "existing.png"].map(name => new File(["x"], name, { type: "image/png" }));
  fireEvent.change(screen.getByTestId("import-file-input"), { target: { files } });
  await waitFor(() => expect(submitted).toEqual(["first.png"]));
  fireEvent.change(screen.getByTestId("import-file-input"), {
    target: { files: [new File(["x"], "second-batch.png", { type: "image/png" })] },
  });
  expect(submitted).toEqual(["first.png"]);
  finishFirst();
  try {
    await screen.findByText("first.png: imported · bad.png: Invalid image · existing.png: already imported in Inbox");
  } finally {
    finishSecond();
  }
  await screen.findByText("second-batch.png: imported");
  expect(submitted).toEqual([...files.map(file => file.name), "second-batch.png"]);
});
it("keeps vertical navigation within the selected version stack", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    jobs: [
      {...state.jobs[0], stackId: "stack", createdAt: "2026-01-01"},
      {...state.jobs[1], createdAt: "2026-01-02"},
      {...state.jobs[0], id: "IMG-second-version", prompt: "Second version", stackId: "stack", createdAt: "2026-01-03", isMain: true},
    ],
  }) })));
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-second-version" });
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-second-version" }));
  fireEvent.keyDown(window, { key: "ArrowUp" });
  expect(screen.getByText("A red panda")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowUp" });
  expect(screen.getByText("A red panda")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(screen.getByText("Second version")).toBeTruthy();
});
it("filters images by a counted tag and clears the filter", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),jobs:[
    {...state.jobs[0],tags:[{tag:"forest",source:"user",createdAt:"2026-01-01"}]},state.jobs[1]
  ]})})));
  await ready();
  fireEvent.change(screen.getByLabelText("Filter by tag"),{target:{value:"forest"}});
  expect(screen.queryByRole("button",{name:"Open IMG-queued"})).toBeNull();
  expect(screen.getByRole("option",{name:"forest (1)"})).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Filter by tag"),{target:{value:""}});
  expect(screen.getByRole("button",{name:"Open IMG-queued"})).toBeTruthy();
});
it("shows the actual cloud deployment label", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),cloud:true})})));
  await ready();
  expect(screen.getByText("Cloudflare")).toBeTruthy();
  expect(screen.queryByText("Local")).toBeNull();
});
it("minimizes and restores the composer without losing its prompt", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"Keep this draft"}});
  fireEvent.click(screen.getByRole("button",{name:"Minimize prompt editor"}));
  expect(screen.queryByRole("textbox",{name:"Image prompt"})).toBeNull();
  fireEvent.click(screen.getAllByRole("button",{name:"New image"}).at(-1)!);
  expect((screen.getByLabelText("Image prompt") as HTMLTextAreaElement).value).toBe("Keep this draft");
});
it("copies the Claude configuration and reports clipboard failure", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  render(<Workspace settingsPage />);
  expect(await screen.findByRole("button",{name:"Copy Codex configuration"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Claude Code"}));
  expect(screen.getByRole("button",{name:"Claude Code"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(".mcp.json")).toBeTruthy();
  const button = await screen.findByRole("button",{name:"Copy Claude Code configuration"});
  expect(button.textContent).toBe("Copy");
  fireEvent.click(button);
  await screen.findByText("Claude Code configuration copied");
  expect(button.textContent).toBe("Copied");
  expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({mcpServers:{"image-queue":{command:"node",args:["/path/to/image-queue/dist/mcp.mjs"],env:{IMAGE_QUEUE_DASHBOARD_URL:window.location.origin}}}});
  writeText.mockRejectedValue(new Error("Denied"));
  fireEvent.click(button);
  await screen.findByText("Unable to copy. Select and copy the configuration text.");
});
it("initializes archive navigation from its URL", async () => {
  window.history.replaceState({},"","/?view=archive");
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[{...state.jobs[0],archivedAt:"2026-01-01"},state.jobs[1]]})})));
  try {
    render(<Workspace />);
    await screen.findByRole("button",{name:"Open IMG-first"});
    expect(screen.queryByRole("button",{name:"Open IMG-queued"})).toBeNull();
    expect(screen.getByRole("heading",{name:/Archive/})).toBeTruthy();
  } finally {window.history.replaceState({},"","/");}
});
it("opens the live queue after visiting archive", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:/^Archive/}));
  fireEvent.click(screen.getByRole("button",{name:/^Queue/}));
  expect(screen.getByRole("button",{name:"Open IMG-queued"})).toBeTruthy();
  expect(window.location.search).toBe("?view=queue");
  window.history.replaceState({},"","/");
});

it("offers Undo after moving selected images to trash", async () => {
  const {retentionAction,undoRetentionAction}=await import("../src/actions");
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  fireEvent.click(screen.getByRole("button",{name:"Move to trash"}));
  const undo=await screen.findByRole("button",{name:"Undo"});
  expect(retentionAction).toHaveBeenCalledWith({ids:["IMG-first","IMG-queued"],operation:"trash",includeStack:true});
  fireEvent.click(undo);
  await waitFor(()=>expect(undoRetentionAction).toHaveBeenCalledWith({id:"undo-one"}));
  await screen.findByText("Action undone");
});
it("keeps prior retention operations available after one undo", async () => {
  const {retentionAction,undoRetentionAction}=await import("../src/actions");
  vi.mocked(retentionAction).mockResolvedValueOnce({data:{changed:["IMG-first"],skipped:[],undoId:"first"}} as any).mockResolvedValueOnce({data:{changed:["IMG-first"],skipped:[],undoId:"second"}} as any);
  await ready();
  for(let i=0;i<2;i++) {
    fireEvent.click(screen.getByRole("button",{name:"Select images"}));
    fireEvent.click(screen.getByRole("button",{name:"Move to trash"}));
    await screen.findByRole("button",{name:"Undo"});
  }
  fireEvent.click(screen.getByRole("button",{name:"Undo"}));
  await waitFor(()=>expect(undoRetentionAction).toHaveBeenCalledWith({id:"second"}));
  await screen.findByText("Action undone");
  fireEvent.click(screen.getByRole("button",{name:"Undo"}));
  await waitFor(()=>expect(undoRetentionAction).toHaveBeenCalledWith({id:"first"}));
});
it("offers Undo only on the notice the retention action produced", async () => {
  const {undoRetentionAction}=await import("../src/actions");
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  fireEvent.click(screen.getByRole("button",{name:"Archive"}));
  const archived=await screen.findByText("1 items updated; 0 active requests skipped");
  expect(archived.closest(".toast")!.textContent).toContain("Undo");
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"A later request"}});
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  const queued=await screen.findByText("Added to the Codex queue");
  expect(screen.queryByRole("button",{name:"Undo"})).toBeNull();
  expect(queued.closest(".toast")!.querySelectorAll("button")).toHaveLength(1);
  // Keyboard undo still reaches the history.
  const before=vi.mocked(undoRetentionAction).mock.calls.length;
  fireEvent.keyDown(window,{key:"z",metaKey:true});
  await waitFor(()=>expect(vi.mocked(undoRetentionAction).mock.calls.length).toBe(before+1));
  expect(vi.mocked(undoRetentionAction)).toHaveBeenLastCalledWith({id:"undo-one"});
  await screen.findByText("Action undone");
});
it("ignores a repeated Undo click while its request is pending", async () => {
  const {undoRetentionAction}=await import("../src/actions");
  let resolveUndo: (value: any) => void = () => {};
  vi.mocked(undoRetentionAction).mockImplementationOnce(() => new Promise(resolve => {resolveUndo=resolve;}) as any);
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  fireEvent.click(screen.getByRole("button",{name:"Move to trash"}));
  const undo=await screen.findByRole("button",{name:"Undo"});
  const before=vi.mocked(undoRetentionAction).mock.calls.length;
  fireEvent.click(undo);
  fireEvent.click(undo);
  expect(vi.mocked(undoRetentionAction).mock.calls.length).toBe(before+1);
  resolveUndo({});
  await screen.findByText("Action undone");
});
it("replaces filters with contextual selection actions", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/^Ready/})).toBeNull();
  expect(screen.queryByRole("textbox",{name:"Search images"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Clear selection"}));
  expect(screen.getByRole("button",{name:/^Ready/})).toBeTruthy();
});
it("uses one next-version field in image details", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  expect(screen.getByLabelText("Next version")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Keep note"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Add notes to queue"})).toBeNull();
  expect((screen.getByRole("button",{name:"Request next version"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Next version"),{target:{value:"Make the sky blue"}});
  expect((screen.getByRole("button",{name:"Request next version"}) as HTMLButtonElement).disabled).toBe(false);
});
it("restores the original draft after visiting another image", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.change(screen.getByLabelText("Next version"),{target:{value:"Draft for first image"}});
  fireEvent.click(screen.getByRole("button",{name:"Next image"}));
  expect(screen.queryByLabelText("Next version")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Previous image"}));
  expect((screen.getByLabelText("Next version") as HTMLTextAreaElement).value).toBe("Draft for first image");
  expect((screen.getByRole("button",{name:"Request next version"}) as HTMLButtonElement).disabled).toBe(false);
});
it("opens the minimized composer when reusing an image prompt", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Minimize prompt editor"}));
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Reuse prompt"}));
  expect((screen.getByRole("textbox",{name:"Image prompt"}) as HTMLTextAreaElement).value).toBe("A red panda");
});
it("changes the next-version source without closing the preview",async()=>{
 await ready();
 fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
 fireEvent.change(screen.getByLabelText("Next version source"),{target:{value:"api"}});
 expect(screen.getByRole("dialog")).toBeTruthy();
 expect(screen.getByLabelText("Next version model")).toBeTruthy();
 expect(screen.queryByText(/This version will wait in the queue/)).toBeNull();
});
it("collapses project navigation without changing the selected project",async()=>{
 await ready();
 const toggle=screen.getByRole("button",{name:"Projects"});
 expect(toggle.getAttribute("aria-expanded")).toBe("true");
 fireEvent.click(toggle);
 expect(toggle.getAttribute("aria-expanded")).toBe("false");
 expect(document.getElementById("sidebar-projects")?.hasAttribute("inert")).toBe(true);
 fireEvent.click(toggle);
 expect(document.getElementById("sidebar-projects")?.hasAttribute("inert")).toBe(false);
 expect(screen.getByRole("button",{name:/All images/}).getAttribute("aria-current")).toBe("page");
});
it("blocks a correction when the API model cannot accept reference images",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),models:state.models.map(model=>({...model,references:false}))})})));
 await ready();
 fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
 fireEvent.change(screen.getByLabelText("Next version source"),{target:{value:"api"}});
 fireEvent.change(screen.getByLabelText("Next version"),{target:{value:"Make the sky blue"}});
 expect(await screen.findByText("Choose a model that supports reference images.")).toBeTruthy();
 expect((screen.getByRole("button",{name:"Request next version"}) as HTMLButtonElement).disabled).toBe(true);
});
it("blocks a transparent image correction when the selected model only supports opaque results",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:state.jobs.map(job=>({...job,transparent:true,opacityVerified:true})),models:state.models.map(model=>({...model,transparency:false}))})})));
 await ready();
 fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
 fireEvent.change(screen.getByLabelText("Next version source"),{target:{value:"api"}});
 fireEvent.change(screen.getByLabelText("Next version"),{target:{value:"Change the circle"}});
 expect(await screen.findByText("This image has transparency. Choose a source that supports transparent images.")).toBeTruthy();
 expect((screen.getByRole("button",{name:"Request next version"}) as HTMLButtonElement).disabled).toBe(true);
});
it("focuses Next version with N outside text fields",async()=>{
 await ready();
 fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
 fireEvent.keyDown(window,{key:"n"});
 expect(document.activeElement).toBe(screen.getByLabelText("Next version"));
});
it("explains archived state and disables next-version editing",async()=>{
 window.history.replaceState({},"","/?view=archive");
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[{...state.jobs[0],archivedAt:"2026-01-01"}]})})));
 render(<Workspace />);
 fireEvent.click(await screen.findByRole("button",{name:"Open IMG-first"}));
 expect(screen.getByText("This image is archived")).toBeTruthy();
 expect((screen.getByLabelText("Next version") as HTMLTextAreaElement).disabled).toBe(true);
 expect(screen.getByRole("button",{name:"Restore"})).toBeTruthy();
});

it("saves detail tags with Enter and keeps the draft on failure", async () => {
  const { tagImageAction } = await import("../src/actions");
  vi.mocked(tagImageAction).mockResolvedValueOnce({data: {...state.jobs[0], tags: [{tag:"forest",source:"user",createdAt:"2026-01-01"},{tag:"green",source:"user",createdAt:"2026-01-01"}]}} as any);
  await ready();
  fireEvent.click(screen.getByRole("button", {name:"Open IMG-first"}));
  expect(screen.queryByRole("textbox", { name: "Tags" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Tags/ }));
  const input = screen.getByRole("textbox", { name: "Tags" });
  expect(screen.queryByRole("button", {name:"Save tags"})).toBeNull();
  fireEvent.change(input, {target:{value:"forest, green"}});
  fireEvent.keyDown(input, {key:"Enter"});
  await waitFor(() => expect(tagImageAction).toHaveBeenCalledWith({id:"IMG-first",tags:["forest","green"]}));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Tags" }) as HTMLInputElement).value).toBe(""));
  vi.mocked(tagImageAction).mockResolvedValueOnce({serverError:"Tag could not be saved"} as any);
  const retryInput = screen.getByRole("textbox", { name: "Tags" });
  fireEvent.change(retryInput, {target:{value:"retry"}});
  fireEvent.keyDown(retryInput, {key:"Enter"});
  await screen.findAllByText("Tag could not be saved");
  expect((retryInput as HTMLInputElement).value).toBe("retry");
});

it("limits detail topics to the image project and preserves the open image after moving", async () => {
  const {moveToTopicAction} = await import("../src/actions");
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async () => ({...structuredClone(state),topics:[
    {id:"local-topic",projectId:"project",name:"Local topic"},
    {id:"other-topic",projectId:"project-two",name:"Other topic"},
    {id:"deleted-topic",projectId:"project",name:"Deleted topic",deleted:true},
  ]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  const picker=screen.getByLabelText("Move image to topic");
  expect(picker.textContent).toContain("Local topic");
  expect(picker.textContent).not.toContain("Other topic");
  expect(picker.textContent).not.toContain("Deleted topic");
  fireEvent.change(picker,{target:{value:"local-topic"}});
  await waitFor(() => expect(moveToTopicAction).toHaveBeenCalledWith({ids:["IMG-first"],topicId:"local-topic"}));
  expect(screen.getByLabelText("Next version")).toBeTruthy();
});

it("excludes trashed stack members from detail navigation and thumbnails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),jobs:[
    {...state.jobs[0],stackId:"versions",createdAt:"2026-01-01"},
    {...state.jobs[0],id:"hidden-version",stackId:"versions",createdAt:"2026-01-02",trashedAt:"2026-01-03"},
  ]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  expect((screen.getByRole("button",{name:"Next image"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:"Version 2"})).toBeNull();
});

it("reports rejected topic changes without closing details", async () => {
  const {moveToTopicAction} = await import("../src/actions");
  vi.mocked(moveToTopicAction).mockResolvedValueOnce({serverError:"Topic no longer exists"} as any);
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),topics:[{id:"topic",projectId:"project",name:"Topic"}]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.change(screen.getByLabelText("Move image to topic"),{target:{value:"topic"}});
  await screen.findAllByText("Topic no longer exists");
  expect(screen.getByLabelText("Next version")).toBeTruthy();
  expect((screen.getByLabelText("Move image to topic") as HTMLSelectElement).value).toBe("");
});
it("refreshes the restored image destination from the server", async () => {
  window.history.replaceState({}, "", "/?view=archive");
  let restored = false;
  const {retentionAction} = await import("../src/actions");
  vi.mocked(retentionAction).mockImplementationOnce(async () => {
    restored = true;
    return {data:{changed:["IMG-first"],skipped:[],undoId:"restore-undo"}} as any;
  });
  vi.stubGlobal("fetch",vi.fn(async () => ({ok:true,json:async () => ({
    ...structuredClone(state),
    projects:[...state.projects,{id:"inbox",name:"Inbox"}],
    jobs:[{...state.jobs[0],projectId:restored?"inbox":"project",archivedAt:restored?undefined:"2026-01-01"}],
  })})));
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"Restore"}));
  await waitFor(() => expect((screen.getByRole("combobox", {name:"Project"}) as HTMLSelectElement).value).toBe("inbox"));
  expect(screen.queryByText("This image is archived")).toBeNull();
  expect((screen.getByLabelText("Next version") as HTMLTextAreaElement).disabled).toBe(false);
});

it.each(["Archive", "Trash"])("shows %s in the breadcrumb and only its sidebar row is active", async view => {
  window.history.replaceState({}, "", `/?view=${view.toLowerCase()}`);
  const { container } = render(<Workspace />);
  const destination = await screen.findByRole("button", { name: `${view} 0` });
  expect(destination.getAttribute("aria-current")).toBe("page");
  expect([...container.querySelectorAll(".sidebar .nav-item.selected")]).toEqual([destination]);
  expect(container.querySelector(".topbar strong")?.textContent).toBe(view);
  expect(container.querySelector(".topbar .mobile-project-selector")).toBeNull();
});
it("keeps destination topic selection independent of gallery filtering", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),topics:[
    {id:"topic",projectId:"project",name:"Topic"},
  ]})})));
  await ready();
  fireEvent.change(screen.getByLabelText("Destination topic"),{target:{value:"topic"}});
  expect(screen.getByRole("button",{name:"Open IMG-first"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Open IMG-queued"})).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"A new forest"}});
  fireEvent.click(screen.getByRole("button",{name:/^(Generate image|Add to queue)$/}));
  await waitFor(()=>expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({topicId:"topic"})));
});
it("uses the open topic and resets an earlier destination override", async () => {
  const loaded = {...structuredClone(state),topics:[{id:"topic",projectId:"project",name:"Illustrations"}]};
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>loaded})));
  await ready();
  fireEvent.change(screen.getByLabelText("Destination project"),{target:{value:"project-two"}});
  fireEvent.click(screen.getByRole("button",{name:/^Project One/}));
  fireEvent.click(screen.getByRole("button",{name:"Illustrations"}));
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"Topic image"}});
  fireEvent.click(screen.getByRole("button",{name:"Add to queue"}));
  await waitFor(()=>expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({projectId:"project",topicId:"topic"})));
});
it("archives only the opened version from More", async () => {
  const {retentionAction} = await import("../src/actions");
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Archive image"}));
  await waitFor(()=>expect(retentionAction).toHaveBeenCalledWith({ids:["IMG-first"],operation:"archive",includeStack:false}));
  await screen.findAllByText("Image archived");
  expect(screen.queryByLabelText("Next version")).toBeNull();
});
it("reports unavailable image clipboard support", async () => {
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:vi.fn()}});
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Copy image"}));
  await screen.findAllByText("Image copying is unavailable in this browser");
});
it("copies the original image blob to the clipboard", async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{write}});
  const copied: Record<string,Blob>[] = [];
  vi.stubGlobal("ClipboardItem",class {
    static supports(type: string) {return type === "image/png";}
    constructor(data: Record<string,Blob>) {copied.push(data);}
  });
  const blob = new Blob(["image bytes"],{type:"image/png"});
  vi.stubGlobal("fetch",vi.fn(async (url: string) => url === "/api/state"
    ? {ok:true,json:async()=>structuredClone(state)}
    : {ok:true,blob:async()=>blob}));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Copy image"}));
  await screen.findAllByText("Image copied");
  expect(write).toHaveBeenCalledTimes(1);
  expect(copied[0]["image/png"]).toBe(blob);
});

it("does not upload a failed image download as a reference", async () => {
  const fetcher=vi.fn(async (url: string) => url === "/api/state"
    ? {ok:true,json:async()=>structuredClone(state)}
    : {ok:false});
  vi.stubGlobal("fetch",fetcher);
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"Use as reference"}));
  await screen.findAllByText("Could not load image reference");
  expect(fetcher.mock.calls.some(([url])=>url === "/api/upload")).toBe(false);
});

it("removes moved cards before the server replies and brings back what it did not move", async () => {
  const {retentionAction}=await import("../src/actions");
  let reply!: (value: unknown) => void;
  vi.mocked(retentionAction).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }) as any);
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  fireEvent.click(screen.getByRole("button",{name:"Archive"}));
  // Neighbours close in while the click still counts as recent input, not after the server round trip.
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Open IMG-first"})).toBeNull());
  expect(screen.getByRole("button",{name:"Open IMG-queued"})).toBeTruthy();
  expect(screen.queryByText("2 selected")).toBeNull();
  reply({data:{changed:[],skipped:["IMG-first"],undoId:"empty"}});
  await screen.findByRole("button",{name:"Open IMG-first"});
  await screen.findByText("0 items updated; 1 active requests skipped");
});

it("reports a skipped archive when the request became active", async () => {
  const {retentionAction} = await import("../src/actions");
  vi.mocked(retentionAction).mockResolvedValueOnce({data:{changed:[],skipped:["IMG-first"],undoId:"empty"}} as any);
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Archive image"}));
  await screen.findAllByText("This request is active and cannot be moved yet");
  expect(screen.queryByText("Image archived")).toBeNull();
});

it("selects a stack parent through the searchable thumbnail picker", async () => {
  const {joinStackAction}=await import("../src/actions");
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[
    state.jobs[0],{...state.jobs[0],id:"parent",prompt:"Blue mountain"},
  ]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  fireEvent.change(screen.getByLabelText("Search parent images"),{target:{value:"mountain"}});
  fireEvent.click(screen.getByRole("button",{name:"Blue mountain"}));
  await waitFor(()=>expect(joinStackAction).toHaveBeenCalledWith({parentId:"parent",versionId:"IMG-first"}));
});

it("shows an empty state for unmatched stack parents", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  fireEvent.change(screen.getByLabelText("Search parent images"),{target:{value:"missing parent"}});
  expect(screen.getByText("No matching images")).toBeTruthy();
});

it("keeps stack join errors visible inside the picker", async () => {
  const {joinStackAction}=await import("../src/actions");
  vi.mocked(joinStackAction).mockResolvedValueOnce({serverError:"Parent is no longer available"} as any);
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[state.jobs[0],{...state.jobs[0],id:"parent",prompt:"Parent image"}]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  fireEvent.click(screen.getByRole("button",{name:"Parent image"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","Parent is no longer available");
  expect(screen.getByLabelText("Search parent images")).toBeTruthy();
});

it("does not navigate the underlying image while the stack picker is open", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[state.jobs[0],{...state.jobs[0],id:"parent",prompt:"Parent image"}]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  fireEvent.keyDown(window,{key:"ArrowRight"});
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  expect(screen.getByText("A red panda")).toBeTruthy();
});
it("sends only one stack join while a selection is pending", async () => {
  const {joinStackAction}=await import("../src/actions");
  let resolveJoin: (value: any) => void = () => {};
  vi.mocked(joinStackAction).mockImplementationOnce(()=>new Promise(resolve=>{resolveJoin=resolve;}) as any);
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[state.jobs[0],{...state.jobs[0],id:"parent",prompt:"Parent image"}]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  const button=screen.getByRole("button",{name:"Parent image"});
  const before=vi.mocked(joinStackAction).mock.calls.length;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(vi.mocked(joinStackAction).mock.calls.length).toBe(before+1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  resolveJoin({});
  await waitFor(()=>expect(screen.queryByLabelText("Search parent images")).toBeNull());
});
it("loads additional parent thumbnails and searches beyond the first batch", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),jobs:[state.jobs[0],...Array.from({length:65},(_,index)=>({...state.jobs[0],id:`parent-${index}`,prompt:`Candidate ${index}`}))]})})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(screen.getByRole("button",{name:"More"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"Add to a version stack…"}));
  expect(document.querySelectorAll(".stack-picker-item")).toHaveLength(60);
  fireEvent.click(screen.getByRole("button",{name:"Show more images"}));
  expect(document.querySelectorAll(".stack-picker-item")).toHaveLength(65);
  fireEvent.change(screen.getByLabelText("Search parent images"),{target:{value:"Candidate 64"}});
  expect(document.querySelectorAll(".stack-picker-item")).toHaveLength(1);
  expect(screen.getByRole("button",{name:"Candidate 64"})).toBeTruthy();
});

it("selects all gallery images with the page-level keyboard shortcut", async () => {
  await ready();
  fireEvent.keyDown(window,{key:"a",metaKey:true});
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Clear selection"}));
  const prompt = screen.getByLabelText("Image prompt");
  expect(fireEvent.keyDown(prompt, { key: "a", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(prompt, { key: "a", metaKey: true })).toBe(true);
  expect(screen.queryByText("2 selected")).toBeNull();
});
it("does not select the gallery behind image details", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.keyDown(window,{key:"a",ctrlKey:true});
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  expect(screen.queryByText("2 selected")).toBeNull();
});
it("selects only the filtered gallery with Ctrl+A", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button",{name:/^Ready/}));
  fireEvent.keyDown(window,{key:"a",ctrlKey:true});
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.queryByText("2 selected")).toBeNull();
});

it("clears page-level image selection with Escape", async () => {
  await ready();
  fireEvent.keyDown(window,{key:"a",metaKey:true});
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.keyDown(window,{key:"Escape"});
  expect(screen.queryByText("2 selected")).toBeNull();
});

it("offers project creation instead of an empty destination selector", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),projects:[],jobs:[]})})));
  render(<Workspace />);
  await screen.findByText("Your next idea starts here");
  expect(screen.queryByLabelText("Destination project")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Create project"}));
  expect(await screen.findByLabelText("Project name")).toBeTruthy();
});
it("submits exact custom dimensions for the agent queue", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"),{target:{value:"custom"}});
  fireEvent.change(screen.getByLabelText("Width"),{target:{value:"1080"}});
  fireEvent.change(screen.getByLabelText("Height"),{target:{value:"1920"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply size"}));
  expect((screen.getByLabelText("Image size") as HTMLSelectElement).value).toBe("1080x1920");
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"A vertical landscape"}});
  fireEvent.click(screen.getByRole("button",{name:/^(Generate image|Add to queue)$/}));
  await waitFor(()=>expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({width:1080,height:1920,source:"queue",aspectRatio:"9:16"})));
});

it("keeps invalid custom dimensions in the size dialog", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"),{target:{value:"custom"}});
  fireEvent.change(screen.getByLabelText("Width"),{target:{value:"0"}});
  fireEvent.change(screen.getByLabelText("Height"),{target:{value:"5000"}});
  fireEvent.submit(screen.getByRole("button",{name:"Apply size"}).closest("form")!);
  expect(screen.getByRole("alert").textContent).toContain("256 to 4096");
  expect(screen.getByLabelText("Width")).toBeTruthy();
  expect((screen.getByLabelText("Image size") as HTMLSelectElement).value).toBe("1024x1024");
});

it("blocks generation when a model profile has no available size choices", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    models: [{ ...state.models[0], sizeProfile: {
      mode: "dimensions", minSide: 256, maxSide: 512, multiple: 16,
      minPixels: 65536, maxPixels: 262144, minRatio: 0.5, maxRatio: 2,
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  expect(screen.getByText("Choose Custom size to enter dimensions supported by this model.")).toBeTruthy();
  expect((screen.getByLabelText(/^(Generate image|Add to queue)$/) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "Panda" } });
  fireEvent.keyDown(screen.getByLabelText("Image prompt"), { key: "Enter", ctrlKey: true });
  expect(requestImageAction).not.toHaveBeenCalled();
});

it("submits a validated custom size for a dimension-profile model", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    models: [{ ...state.models[0], sizeProfile: {
      mode: "dimensions", minSide: 256, maxSide: 512, multiple: 16,
      minPixels: 65536, maxPixels: 262144, minRatio: 0.5, maxRatio: 2,
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "512" } });
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "512" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  expect((screen.getByLabelText("Image size") as HTMLSelectElement).value).toBe("512x512");
  expect((screen.getByLabelText(/^(Generate image|Add to queue)$/) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "Panda" } });
  expect((screen.getByLabelText(/^(Generate image|Add to queue)$/) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({ width: 512, height: 512 })));
});

it("keeps custom size open when dimensions violate the model profile", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    models: [{ ...state.models[0], sizeProfile: {
      mode: "dimensions", minSide: 256, maxSide: 2048, multiple: 16,
      minPixels: 65536, maxPixels: 4194304, minRatio: 0.5, maxRatio: 2,
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  // Off-grid sizes are now fitted down from a covering native size; exceeding maxSide is still refused.
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "2064" } });
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1024" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  expect(screen.getByRole("alert").textContent).toContain("model's limits");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(requestImageAction).not.toHaveBeenCalled();
});

it("submits custom dimensions for a model-specific aspect ratio", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    models: [{ ...state.models[0], sizeProfile: {
      mode: "aspect-ratio", ratios: ["5:4"], levels: [],
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1280" } });
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1024" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  expect((screen.getByLabelText("Image size") as HTMLSelectElement).value).toBe("1280x1024");
  fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "Panda" } });
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 1024 })));
});

it("shows the resulting proportion while editing custom dimensions", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  expect(screen.getByRole("dialog").querySelector("[aria-live=polite]")?.textContent).toBe("9:16 · 1080 × 1920");
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1280" } });
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1024" } });
  expect(screen.getByText("5:4 · 1280 × 1024")).toBeTruthy();
});

it("keeps custom dimensions in the selected aspect ratio until unlocked", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "16:9" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1920" } });
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("1080");
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "720" } });
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("1280");
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "free" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1500" } });
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("720");
});

it("fills the queue folder from the picker and preserves it on cancel", async () => {
  let picks = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () =>
    url === "/api/directory-picker"
      ? (++picks === 1 ? { path: "/tmp/chosen-queue/" } : { cancelled: true })
      : structuredClone(state),
  })));
  render(<Workspace settingsPage />);
  await screen.findByLabelText("Queue directory");
  fireEvent.click(screen.getByLabelText("Queue directory").parentElement!.querySelector("button")!);
  await waitFor(() => expect((screen.getByLabelText("Queue directory") as HTMLInputElement).value).toBe("/tmp/chosen-queue/"));
  await waitFor(() => expect(screen.getByLabelText("Queue directory").parentElement!.querySelector("button")!.disabled).toBe(false));
  fireEvent.click(screen.getByLabelText("Queue directory").parentElement!.querySelector("button")!);
  await waitFor(() => expect(picks).toBe(2));
  expect((screen.getByLabelText("Queue directory") as HTMLInputElement).value).toBe("/tmp/chosen-queue/");
});

it("does not duplicate a reference folder selected with a trailing slash", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () =>
    url === "/api/directory-picker" ? { path: "/tmp/references/" } : structuredClone(state),
  })));
  render(<Workspace settingsPage />);
  const input = await screen.findByLabelText("Allowed reference directories");
  fireEvent.change(input, { target: { value: "/tmp/references" } });
  fireEvent.click(screen.getByRole("button", { name: "Add folder…" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add folder…" })).toBeTruthy());
  expect((input as HTMLTextAreaElement).value).toBe("/tmp/references");
});

it("initializes locked custom proportions with exact whole-pixel dimensions", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "16:9" } });
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("1088");
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("612");
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("finds the closest exact dimensions for 21:9", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "21:9" } });
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("1078");
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("462");
});

it("rejects rounded custom dimensions that do not match the locked ratio", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "16:9" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  expect(screen.getByRole("alert").textContent).toContain("Try 1008 × 567");
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1008" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("suggests exact locked dimensions accepted by the selected model", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), models: [{ ...state.models[0], sizeProfile: {
      mode: "dimensions", minSide: 256, maxSide: 2048, multiple: 16,
      minPixels: 65536, maxPixels: 4194304, minRatio: 0.5, maxRatio: 2,
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom aspect ratio"), { target: { value: "16:9" } });
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("1024");
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("576");
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows fitting notice for a custom target and clears it for native dimensions", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), models: [{ ...state.models[0], sizeProfile: {
      mode: "fixed", sizes: [{ width: 1024, height: 1024 }],
    } }],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-test" } });
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Width"), { target: { value: "800" } });
  fireEvent.change(screen.getByLabelText("Height"), { target: { value: "800" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply size" }));
  expect(screen.getByText("Output will be center-cropped or resized from 1024 × 1024 to 800 × 800.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "1024x1024" } });
  expect(screen.queryByText(/Output will be center-cropped/)).toBeNull();
});

it("offers download for a blocked job with retained image output", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [{ ...state.jobs[0], status: "blocked",
      blobKey: "results/retained", error: "Output could not be fitted" }],
  }) })));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use as reference" })).toBeNull();
});

it("uses queue-specific empty copy", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),jobs:[]})})));
  render(<Workspace />);
  await screen.findByText("The queue is empty");
  expect(screen.getByText("The queue is empty")).toBeTruthy();
  expect(screen.getByText("Requests appear here while they wait, are reserved by a worker, or are generating.")).toBeTruthy();
});

it("uses request wording when a queue search has no matches", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  render(<Workspace />);
  await screen.findByRole("button", {name:"Open IMG-queued"});
  fireEvent.change(screen.getByLabelText("Search images"), { target: { value: "does-not-exist" } });
  expect(screen.getByText("No matching requests")).toBeTruthy();
  expect(screen.queryByText("The queue is empty")).toBeNull();
});

it("separates waiting and generating requests in the queue", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-queued" });
  expect(screen.getByRole("button", { name: "Waiting 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Generating 0" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Ready/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open IMG-first" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Generating 0" }));
  expect(screen.queryByRole("button", { name: "Open IMG-queued" })).toBeNull();
  expect(screen.getByText("No images are generating")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reserved 0" }));
  expect(screen.getByText("No requests are reserved")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Waiting 1" }));
  expect(screen.getByRole("button", { name: "Open IMG-queued" })).toBeTruthy();
});

it("places project pinning in the project heading outside topics", async () => {
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const pin = screen.getByRole("button", { name: "Pin project" });
  expect(pin.closest(".page-heading-actions")).toBeTruthy();
  expect(pin.closest(".topic-nav")).toBeNull();
});

it("updates queue tab counts for the current search", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  render(<Workspace />);
  await screen.findByRole("button", { name: "Waiting 1" });
  fireEvent.change(screen.getByLabelText("Search images"), { target: { value: "missing" } });
  expect(screen.getByRole("button", { name: "Waiting 0" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "All requests 0" })).toBeTruthy();
});

it("pins the current project from its heading", async () => {
  const { pinAction } = await import("../src/actions");
  vi.mocked(pinAction).mockResolvedValueOnce({ data: {} } as never);
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "Pin project" }));
  await waitFor(() => expect(pinAction).toHaveBeenCalledWith({
    targetType: "project", targetId: "project", pinned: true,
  }));
});

it("requires confirmation before permanently deleting trash", async () => {
  const { purgeAction } = await import("../src/actions");
  window.history.replaceState({}, "", "/?view=trash");
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({
    ...structuredClone(state), jobs:[{...state.jobs[0],trashedAt:"2026-11-14"}],
  })})));
  render(<Workspace />);
  await screen.findByRole("button", {name:"Open IMG-first"});
  fireEvent.click(screen.getByRole("button",{name:"Empty trash"}));
  expect(purgeAction).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  const buttons = screen.getAllByRole("button",{name:"Delete permanently"});
  fireEvent.click(buttons[buttons.length-1]);
  await waitFor(()=>expect(purgeAction).toHaveBeenCalledWith({ids:["IMG-first"]}));
});

it("keeps permanent deletion confirmation open after a failure", async () => {
  const { purgeAction } = await import("../src/actions");
  vi.mocked(purgeAction).mockResolvedValueOnce({serverError:"Storage unavailable"} as never);
  window.history.replaceState({}, "", "/?view=trash");
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({
    ...structuredClone(state), jobs:[{...state.jobs[0],trashedAt:"2026-11-14"}],
  })})));
  render(<Workspace />);
  await screen.findByRole("button",{name:"Open IMG-first"});
  fireEvent.keyDown(window,{key:"a",ctrlKey:true});
  fireEvent.click(screen.getByRole("button",{name:"Delete permanently"}));
  const buttons=screen.getAllByRole("button",{name:"Delete permanently"});
  fireEvent.click(buttons[buttons.length-1]);
  await screen.findByText("Storage unavailable");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("1 selected")).toBeTruthy();
});


it("shows the current version position in the detail header", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      { ...state.jobs[0], stackId: "versions", createdAt: "2026-01-01" },
      { ...state.jobs[0], id: "second", stackId: "versions", createdAt: "2026-01-02" },
    ],
  }) })));
  render(<Workspace initialJob="IMG-first" />);
  expect(await screen.findByText("v1 of 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request v3" })).toBeTruthy();
});

it("navigates from a stack version to the next gallery image", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      { ...state.jobs[0], stackId: "versions", createdAt: "2026-01-03", isMain: true },
      { ...state.jobs[0], id: "older", stackId: "versions", createdAt: "2026-01-02" },
      { ...state.jobs[0], id: "separate", prompt: "Separate image", createdAt: "2026-01-01" },
    ],
  }) })));
  render(<Workspace initialJob="older" />);
  await screen.findByText("v1 of 2");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  await waitFor(() => expect(screen.queryByText("v1 of 2")).toBeNull());
  expect(screen.getByLabelText("Image position").textContent).toBe("2 of 2");
});

it("counts the exact version when gallery grouping is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      { ...state.jobs[0], stackId: "versions", createdAt: "2026-01-03", isMain: true },
      { ...state.jobs[0], id: "older", stackId: "versions", createdAt: "2026-01-02" },
    ],
  }) })));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Stacked" }));
  fireEvent.click(screen.getByRole("button", { name: "Open older" }));
  expect(screen.getByLabelText("Image position").textContent).toBe("2 of 2");
});


it("navigates stack versions vertically without leaving the gallery item", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      { ...state.jobs[0], stackId: "versions", createdAt: "2026-01-01" },
      { ...state.jobs[0], id: "second", stackId: "versions", createdAt: "2026-01-02" },
    ],
  }) })));
  render(<Workspace initialJob="IMG-first" />);
  await screen.findByText("v1 of 2");
  fireEvent.keyDown(window, { key: "ArrowDown" });
  await screen.findByText("v2 of 2");
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(screen.getByText("v2 of 2")).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText("Next version"), { key: "ArrowUp" });
  expect(screen.getByText("v2 of 2")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowUp" });
  await screen.findByText("v1 of 2");
});


it("counts retained hidden versions when labeling the next version", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      { ...state.jobs[0], stackId: "versions", createdAt: "2026-01-01" },
      { ...state.jobs[0], id: "hidden", stackId: "versions", createdAt: "2026-01-02", trashedAt: "2026-01-03" },
    ],
  }) })));
  render(<Workspace initialJob="IMG-first" />);
  expect(await screen.findByRole("button", { name: "Request v3" })).toBeTruthy();
});


it("uses the persistent stack counter after older versions are purged", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    jobs: [{ ...state.jobs[0], stackId: "versions", versionNumber: 7 }],
    stackCounters: [{ id: "versions", lastVersion: 7 }],
  }) })));
  render(<Workspace initialJob="IMG-first" />);
  expect(await screen.findByRole("button", { name: "Request v8" })).toBeTruthy();
  expect(screen.getByText("v7 of 7")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Version 7" })).toBeTruthy();
});

it("limits stack picker candidates to the current project and topic", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [
      state.jobs[0],
      { ...state.jobs[0], id: "local", prompt: "Matching parent" },
      { ...state.jobs[0], id: "elsewhere", projectId: "elsewhere", prompt: "Different project" },
      { ...state.jobs[0], id: "topic", topicId: "other-topic", prompt: "Different topic" },
    ],
  }) })));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Add to a version stack…" }));
  expect(screen.getByRole("button", { name: "Matching parent" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Different project" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Different topic" })).toBeNull();
});

it("shows requested and raw provider dimensions when they differ from the saved image", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), jobs: [{
      ...state.jobs[0], width: 800, height: 800,
      requestedSize: { width: 900, height: 800 },
      providerResultSize: { width: 1024, height: 1024 },
    }],
  }) })));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  expect(screen.getByText("Requested size · 900 × 800")).toBeTruthy();
  expect(screen.getByText("Provider output · 1024 × 1024")).toBeTruthy();
  expect(screen.getByText(/^800 × 800 ·/)).toBeTruthy();
});

it("retries only the remaining Trash batch after a partial failure", async () => {
  const { purgeAction } = await import("../src/actions");
  const ids = Array.from({ length: 1001 }, (_, index) => `IMG-trash-${index}`);
  vi.mocked(purgeAction)
    .mockResolvedValueOnce({ data: { deleted: ids.slice(0, 1000) } })
    .mockResolvedValueOnce({ serverError: "Storage unavailable" })
    .mockResolvedValueOnce({ data: { deleted: ids.slice(1000) } });
  window.history.replaceState({}, "", "/?view=trash");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    jobs: ids.map(id => ({ ...state.jobs[0], id, trashedAt: "2026-11-14" })),
  }) })));
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Empty trash" }));
  expect(purgeAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await screen.findByText("Storage unavailable");
  expect(purgeAction).toHaveBeenNthCalledWith(1, { ids: ids.slice(0, 1000) });
  expect(purgeAction).toHaveBeenNthCalledWith(2, { ids: ids.slice(1000) });
  expect(screen.getByRole("heading", { name: "Delete 1 image permanently?" })).toBeTruthy();
  expect(screen.getByText("Processed 1000 of 1001 images.")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Permanently deleting images" }).getAttribute("aria-valuenow")).toBe("1000");
  expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("1001");
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(purgeAction).toHaveBeenNthCalledWith(3, { ids: ids.slice(1000) }));
  expect(await screen.findByText("1001 images permanently deleted")).toBeTruthy();
});

it("requires fresh consent to remove external files and sends it on confirmation", async () => {
  const { purgeAction } = await import("../src/actions");
  window.history.replaceState({}, "", "/?view=trash");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state),
    jobs: [{
      ...state.jobs[0], source: "queue", status: "done", blobKey: undefined,
      outputPath: "/fixture/out/IMG-first/image.png", trashedAt: "2026-11-14",
    }],
  }) })));
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
  const checkbox = () => screen.getByRole("checkbox", { name: /also delete external image files/i });

  open();
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(checkbox());
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(purgeAction).not.toHaveBeenCalled();

  open();
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(checkbox());
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(purgeAction).toHaveBeenCalledWith({
    ids: ["IMG-first"], removeExternal: true,
  }));
});

it("counts and filters waiting, reserved and generating jobs independently", async () => {
  window.history.replaceState({}, "", "/?view=queue");
  const waiting = { ...state.jobs[0], id: "IMG-waiting", status: "queued" };
  const reserved = {
    ...waiting, id: "IMG-reserved", status: "running",
    claim: { owner: "worker", since: "2026-11-14T00:00:00Z", reserved: true },
  };
  const generating = { ...waiting, id: "IMG-generating", status: "running" };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), jobs: [waiting, reserved, generating] }),
  })));
  render(<Workspace />);

  await screen.findByRole("button", { name: "All requests 3" });
  for (const [label, selected] of [
    ["Waiting", waiting], ["Reserved", reserved], ["Generating", generating],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: `${label} 1` }));
    expect(screen.getByRole("button", { name: `Open ${selected.id}` })).toBeTruthy();
    for (const other of [waiting, reserved, generating].filter(job => job.id !== selected.id)) {
      expect(screen.queryByRole("button", { name: `Open ${other.id}` })).toBeNull();
    }
  }
});

it("offers record-only deletion for external outputs in a cloud workspace", async () => {
  const { purgeAction } = await import("../src/actions");
  window.history.replaceState({}, "", "/?view=trash");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), cloud: true,
    jobs: [{
      ...state.jobs[0], source: "queue", status: "done", blobKey: undefined,
      outputPath: "/fixture/out/IMG-first/image.png", trashedAt: "2026-11-14",
    }],
  }) })));
  render(<Workspace />);

  fireEvent.click(await screen.findByRole("button", { name: "Empty trash" }));
  expect(screen.queryByRole("checkbox", { name: /also delete external image files/i })).toBeNull();
  expect(screen.getByText("Records with external images").nextElementSibling?.textContent).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(purgeAction).toHaveBeenCalledWith({ ids: ["IMG-first"] }));
});

it("drops a gallery image onto the composer as a reference", async () => {
  const fetchRequest = vi.fn(async (url: string) => {
    if (url.startsWith("/api/asset")) return { ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) };
    if (url === "/api/upload") return { ok: true, json: async () => ({ id: "drop-ref", kind: "image" }) };
    return { ok: true, json: async () => structuredClone(state) };
  });
  vi.stubGlobal("fetch", fetchRequest);
  const { container } = render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.drop(container.querySelector("form.composer")!, {
    dataTransfer: { files: [], getData: () => '["IMG-first"]' },
  });
  await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" })));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Image prompt" })));
  expect(screen.queryByText("References added")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Image prompt" }), {
    target: { value: "Make the hat blue; preserve the person and background" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^(Generate image|Add to queue)$/ }));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "Make the hat blue; preserve the person and background",
      referenceIds: ["drop-ref"],
      source: "queue",
    }),
  ));
});

it("attaches a local image dropped directly on the prompt without importing it", async () => {
  const fetchRequest = vi.fn(async (url: string, _options?: RequestInit) => ({
    ok: true,
    json: async () => url === "/api/upload"
      ? { id: "local-drop-ref", kind: "image" }
      : structuredClone(state),
  }));
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const prompt = screen.getByRole("textbox", { name: "Image prompt" });
  const file = new File(["image"], "reference.png", { type: "image/png" });
  const dataTransfer = { types: ["Files"], files: [file], getData: () => "", dropEffect: "none" };
  const composer = prompt.closest("form")!;
  expect(fireEvent.dragOver(prompt, { dataTransfer })).toBe(false);
  expect(composer.hasAttribute("data-reference-drop")).toBe(true);
  fireEvent.dragLeave(composer);
  expect(composer.hasAttribute("data-reference-drop")).toBe(false);
  fireEvent.dragOver(prompt, { dataTransfer });
  fireEvent.drop(prompt, { dataTransfer });
  expect(composer.hasAttribute("data-reference-drop")).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Image prompt" })));
  expect(screen.queryByText("References added")).toBeNull();
  const uploads = fetchRequest.mock.calls.filter(([url, options]) => options?.method === "POST");
  expect(uploads.map(([url]) => url)).toEqual(["/api/upload"]);
  expect((uploads[0][1]?.body as FormData).get("file")).toEqual(file);
});

it("rejects an oversized reference drop before uploading files", async () => {
  const fetchRequest = vi.fn(async (_url: string) => ({
    ok: true, json: async () => structuredClone(state),
  }));
  vi.stubGlobal("fetch", fetchRequest);
  const { container } = render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const files = Array.from({ length: 11 }, (_, index) =>
    new File(["image"], `fixture-${index}.png`, { type: "image/png" }),
  );
  fireEvent.drop(container.querySelector("form.composer")!, {
    dataTransfer: { files, getData: () => "" },
  });
  expect(await screen.findByText("You can add up to 10 image references")).toBeTruthy();
  expect(fetchRequest.mock.calls.map(call => call[0])).not.toContain("/api/upload");
});

it("reopens a minimized composer on drop and reports an unavailable gallery image", async () => {
  const fetchRequest = vi.fn(async (url: string) => {
    if (url.startsWith("/api/asset")) return { ok: false };
    return { ok: true, json: async () => structuredClone(state) };
  });
  vi.stubGlobal("fetch", fetchRequest);
  const { container } = render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "Minimize prompt editor" }));
  const target = container.querySelector(".composer-restore")!;
  const dataTransfer = {
    types: ["application/x-image-queue-jobs"], files: [],
    getData: () => '["IMG-first"]', dropEffect: "none",
  };
  fireEvent.drop(target, { dataTransfer });

  expect(await screen.findByRole("textbox", { name: "Image prompt" })).toBeTruthy();
  expect(await screen.findByText("Could not load image reference")).toBeTruthy();
  expect(fetchRequest.mock.calls.map(call => call[0])).not.toContain("/api/upload");
});

it("offers only OpenAI for the 0.1.0 provider connection", async () => {
  render(<Workspace settingsPage />);
  const provider = await screen.findByLabelText<HTMLSelectElement>("Provider");
  expect([...provider.options].map(option => option.value)).toEqual(["openai"]);
});

it("creates a topic in the open project and reloads the sidebar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      topics: vi.mocked(createTopicAction).mock.calls.length
        ? [{ id: "sketches", projectId: "project", name: "Character sketches", order: 0 }]
        : [],
    }),
  })));
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "New topic" }));
  const name = await screen.findByRole("textbox", { name: "Topic name" });
  const submit = screen.getByRole("button", { name: "Create topic" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(name, { target: { value: "Character sketches" } });
  fireEvent.click(submit);
  expect(await screen.findByRole("button", { name: "Character sketches" })).toBeTruthy();
  expect(createTopicAction).toHaveBeenCalledWith({ projectId: "project", name: "Character sketches" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps the topic draft and reports a failed save inside the dialog", async () => {
  vi.mocked(createTopicAction).mockRejectedValueOnce(new Error("Could not save topic"));
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "New topic" }));
  const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "Topic name" });
  fireEvent.change(name, { target: { value: "Character sketches" } });
  fireEvent.click(screen.getByRole("button", { name: "Create topic" }));
  const alert = await screen.findByText("Could not save topic");
  expect(alert.closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
  expect(name.value).toBe("Character sketches");
});

it("keeps the picked project folder after cancelling the picker and submits it", async () => {
  let picks = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/directory-picker"
      ? (++picks === 1 ? { path: "/tmp/picked-project/" } : { cancelled: true })
      : structuredClone(state),
  })));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  const folder = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project folder" });
  const picker = screen.getByRole<HTMLButtonElement>("button", { name: "Choose folder…" });
  fireEvent.click(picker);
  await waitFor(() => expect(folder.value).toBe("/tmp/picked-project/"));
  await waitFor(() => expect(picker.disabled).toBe(false));
  fireEvent.click(picker);
  await waitFor(() => expect(picks).toBe(2));
  await waitFor(() => expect(picker.disabled).toBe(false));
  expect(folder.value).toBe("/tmp/picked-project/");
  fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Picked project" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(createProjectAction).toHaveBeenCalledWith(expect.objectContaining({
    name: "Picked project",
    directory: "/tmp/picked-project/",
  })));
});

it("links an empty Ready filter to active requests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), jobs: [state.jobs[1]] }),
  })));
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-queued" });
  fireEvent.click(screen.getByRole("button", { name: /^Ready\s*0$/ }));
  expect(screen.getByText("No finished images yet")).toBeTruthy();
  expect(screen.getByText("1 request is waiting, reserved, or generating.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show in progress" }));
  expect(screen.getByRole("button", { name: "Open IMG-queued" })).toBeTruthy();
});

it("widens an empty project search without losing its query and lets users clear it", async () => {
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const search = screen.getByRole<HTMLInputElement>("textbox", { name: "Search images" });
  fireEvent.change(search, { target: { value: "missing fixture" } });
  expect(screen.getByText("“missing fixture”")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Search all projects" }));
  expect(screen.getByRole("heading", { name: /All images/ })).toBeTruthy();
  expect(search.value).toBe("missing fixture");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search.value).toBe("");
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole("button", { name: "Open IMG-first" })).toBeTruthy();
});

it("updates the same polite live region after workers are paused", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      // The sidebar reports the source in use, so the queue must be it.
      generationSource: { source: "queue" },
      pool: { ...state.pool, workers: vi.mocked(poolConfigAction).mock.calls.length ? 0 : 4 },
    }),
  })));
  const { container } = render(<Workspace settingsPage initialState={{ ...structuredClone(state), generationSource: { source: "queue" } } as never} />);
  const region = container.querySelector('.generation-status [aria-live="polite"]');
  expect(region?.textContent).toBe("Workers not responding");
  fireEvent.change(await screen.findByLabelText("Active workers"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save worker settings" }));
  await waitFor(() => expect(region?.textContent).toBe("Workers paused"));
  expect(container.querySelector('.generation-status [aria-live="polite"]')).toBe(region);
});

it("shows a disabled worker finishing its existing reservation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      pool: { ...state.pool, workers: 2 },
      pulses: [{ slot: 3, mode: "disabled", draining: true, lastWake: new Date().toISOString() }],
    }),
  })));
  render(<Workspace settingsPage />);
  expect(await screen.findByText("No active worker has reported a heartbeat yet.")).toBeTruthy();
  expect(screen.queryByText("Awaiting heartbeat")).toBeNull();
  const label = await screen.findByText("Finishing current image");
  expect(label.parentElement?.textContent).toContain("Worker 3");
});

it("explains intentionally paused workers in the composer and next-version panel", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), pool: { ...state.pool, workers: 0 } }),
  })));
  render(<Workspace initialProject="project" />);
  await screen.findByText("Workers are turned off. Requests will wait in the queue.");
  expect(screen.getByRole("link", { name: "Manage workers" }).getAttribute("href")).toBe("/settings#worker-pool");
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  expect(await screen.findByText("Workers are turned off. This version will wait in the queue.")).toBeTruthy();
  const panelLink = screen.getAllByRole("link", { name: "Manage workers" }).at(-1)!;
  expect(panelLink.getAttribute("href")).toBe("/settings#worker-pool");
});

it("explains a stopped queue instead of offline workers in the composer and next-version panel", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), localRunner: { mode: "local", paused: false, enabled: 1, running: 0, desiredWorkers: 1, blockedReason: "Sign in to Codex." } }),
  })));
  render(<Workspace initialProject="project" />);
  await screen.findByText("Queue stopped — action needed. Sign in to Codex. Requests will wait until you resume the queue.");
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  expect(await screen.findByText("Queue stopped — action needed. Sign in to Codex. This version will wait until you resume the queue.")).toBeTruthy();
  expect(screen.queryByText(/Workers are offline/)).toBeNull();
});

it("marks only the current sidebar destination as the current page", async () => {
  await ready();
  const currentPage = () => [...document.querySelectorAll("aside [aria-current=page]")];
  expect(currentPage()).toEqual([screen.getByRole("button", { name: /^All images/ })]);
  const queue = screen.getByRole("button", { name: /^Queue\s+1$/ });
  fireEvent.click(queue);
  expect(currentPage()).toEqual([queue]);
  const inbox = screen.getByRole("button", { name: /^Inbox\s+0$/ });
  fireEvent.click(inbox);
  expect(currentPage()).toEqual([inbox]);
});

it("exposes the active gallery filter as pressed", async () => {
  await ready();
  const everything = screen.getByRole("button", { name: /^Everything/, pressed: true });
  const readyFilter = screen.getByRole("button", { name: /^Ready/, pressed: false });
  fireEvent.click(readyFilter);
  expect(readyFilter.getAttribute("aria-pressed")).toBe("true");
  expect(everything.getAttribute("aria-pressed")).toBe("false");
});

it("prevents copying an old worker configuration while new preferences are saving", async () => {
  render(<Workspace settingsPage />);
  const save = await screen.findByRole("button", { name: "Save worker settings" });
  let complete!: (value: any) => void;
  vi.mocked(poolConfigAction).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.click(save);
  const copy = screen.getByRole<HTMLButtonElement>("button", { name: "Copy saved worker configuration" });
  expect(copy.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
  await act(async () => complete({ data: state.pool }));
  await waitFor(() => expect(copy.disabled).toBe(false));
});

it("announces only jobs that become ready during a refresh", async () => {
  let completed = 0;
  const second = { ...state.jobs[1], id: "IMG-queued-second" };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      jobs: [state.jobs[0], ...[state.jobs[1], second].map((job, index) =>
        index < completed ? { ...job, status: "done" } : job,
      )],
    }),
  })));
  const { container } = render(<Workspace settingsPage />);
  const save = await screen.findByRole("button", { name: "Save worker settings" });
  const region = container.querySelector("main > [aria-live=polite]");
  expect(region?.textContent).toBe("");
  completed = 1;
  fireEvent.click(save);
  await waitFor(() => expect(region?.textContent).toBe("1 image is ready since opening this workspace."));
  completed = 2;
  fireEvent.click(save);
  await waitFor(() => expect(region?.textContent).toBe("2 images are ready since opening this workspace."));
});

it("confirms a saved queue request even when the subsequent refresh fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: !vi.mocked(requestImageAction).mock.calls.length,
    json: async () => structuredClone(state),
  })));
  await ready();
  const prompt = screen.getByRole<HTMLInputElement>("textbox", { name: "Image prompt" });
  fireEvent.change(prompt, { target: { value: "A red panda" } });
  fireEvent.click(screen.getByRole("button", { name: /^(Generate image|Add to queue)$/ }));
  await screen.findByText("Added to the Codex queue. Could not refresh the workspace.");
  expect(prompt.value).toBe("");
  expect(requestImageAction).toHaveBeenCalledOnce();
});

it("attaches the original dropped file in Inbox on first use", async () => {
  const empty = { ...structuredClone(state), projects: [], jobs: [], models: [] };
  const fetchRequest = vi.fn(async (url: string, _options?: RequestInit) => ({
    ok: true,
    json: async () => url === "/api/upload" ? { id: "first-reference", kind: "image" } : empty,
  }));
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialState={empty} />);
  const file = new File(["image"], "first.png", { type: "image/png" });
  fireEvent.drop(screen.getByRole("textbox", { name: "Image prompt" }), {
    dataTransfer: { files: [file], getData: () => "" },
  });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Image prompt" })));
  const uploads = fetchRequest.mock.calls.filter(([url]) => url === "/api/upload");
  expect(uploads).toHaveLength(1);
  const body = uploads[0][1]?.body as FormData;
  expect(body.get("projectId")).toBe("inbox");
  expect(body.get("file")).toEqual(file);
});

it("sends the first prompt directly to Inbox", async () => {
  render(<Workspace initialState={{...structuredClone(state), projects:[], jobs:[], models:[], localRunner:{mode:"local",enabled:0,running:0,paused:true}} as never} />);
  fireEvent.change(screen.getByLabelText("Image prompt"), {target:{value:"First image"}});
  fireEvent.click(screen.getByRole("button",{name:"Add to queue"}));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledWith(expect.objectContaining({projectId:"inbox",prompt:"First image"})));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("clears the filter fade when a viewport resize removes the overflow", async () => {
  await ready();
  const filters = document.querySelector(".filters")!;
  Object.defineProperty(filters, "scrollWidth", { value: 320 });
  Object.defineProperty(filters, "clientWidth", { value: 250, configurable: true });
  fireEvent.scroll(filters);
  expect(filters.classList.contains("fade-right")).toBe(true);

  Object.defineProperty(filters, "clientWidth", { value: 320 });
  fireEvent(window, new Event("resize"));

  expect(filters.classList.contains("fade-right")).toBe(false);
});

it("attaches an image pasted into the prompt while leaving plain text paste alone", async () => {
  const fetchRequest = vi.fn(async (url: string, _options?: RequestInit) => ({
    ok: true,
    json: async () => url === "/api/upload"
      ? { id: "pasted-ref", kind: "image" }
      : structuredClone(state),
  }));
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const prompt = screen.getByRole("textbox", { name: "Image prompt" });
  expect(fireEvent.paste(prompt, { clipboardData: { files: [] } })).toBe(true);
  const file = new File(["image"], "clipboard.png", { type: "image/png" });
  expect(fireEvent.paste(prompt, { clipboardData: { files: [file] } })).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Image prompt" })));
  expect(screen.queryByText("References added")).toBeNull();
  const requests = fetchRequest.mock.calls.filter(([url]) => url === "/api/upload");
  expect(requests).toHaveLength(1);
  expect((requests[0][1]?.body as FormData).get("file")).toEqual(file);
});

it("adds a file dropped in the reference library without closing it", async () => {
  const reference = { id: "library-drop", kind: "image", projectId: "project", name: "library.png", blobKey: "refs/library" };
  const fetchRequest = vi.fn(async (url: string, _options?: RequestInit) => ({
    ok: true,
    json: async () => url === "/api/upload"
      ? reference
      : { ...structuredClone(state), references: fetchRequest.mock.calls.some(([path]) => path === "/api/upload") ? [reference] : [] },
  }));
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "Attach image reference" }));
  const dialog = await screen.findByRole("dialog", { name: "Reference library" });
  const file = new File(["image"], reference.name, { type: "image/png" });
  fireEvent.drop(dialog, { dataTransfer: { files: [file], getData: () => "" } });

  await screen.findByRole("button", { name: reference.name });
  expect(dialog.isConnected).toBe(true);
  const upload = fetchRequest.mock.calls.find(([url]) => url === "/api/upload");
  expect((upload?.[1]?.body as FormData).get("file")).toEqual(file);
});

it("opens a directly linked image from preloaded workspace state", async () => {
  const timestamp = "2026-11-15T00:00:00Z";
  render(<Workspace initialJob="IMG-first" initialState={{
    ...structuredClone(state),
    models: [],
    projects: [{ id: "project", name: "Project", createdAt: timestamp }],
    jobs: [{
      ...state.jobs[0],
      status: "done",
      source: "queue",
      provider: "openai",
      model: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      idempotencyKey: "first",
      requestHash: "fixture",
    }],
  }} />);

  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Use as reference" })).toBeTruthy();
});

it("saves a note for the whole image without adding coordinates", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  const note = screen.getByRole("textbox", { name: "Next version" });
  expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
  fireEvent.change(note, { target: { value: "Preserve the original framing." } });
  fireEvent.keyDown(note, { key: "Enter" });

  await waitFor(() => expect(addNoteAction).toHaveBeenCalledWith({
    imageId: "IMG-first",
    text: "Preserve the original framing.",
  }));
});


it("lets the reference library replace an image at the attachment limit", async () => {
  const references = Array.from({ length: 11 }, (_, index) => ({
    id: `reference-${index}`, projectId: "project", kind: "image" as const,
    name: `reference-${index}.png`, blobKey: `refs/${index}`,
  }));
  const fetchRequest = vi.fn(async (_url: string) => ({
    ok: true, json: async () => ({ ...structuredClone(state), references }),
  }));
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialProject="project" />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  fireEvent.click(screen.getByRole("button", { name: "Attach image reference" }));
  const first = await screen.findByRole("button", { name: "reference-0.png" });
  for (const reference of references.slice(0, 10)) {
    fireEvent.click(screen.getByRole("button", { name: reference.name }));
  }
  const extra = screen.getByRole("button", { name: "reference-10.png" }) as HTMLButtonElement;
  expect(screen.getByText("10 of 10 selected · Remove a reference to add another.")).toBeTruthy();
  expect(extra.disabled).toBe(true);
  fireEvent.change(screen.getByTestId("reference-file-input"), {
    target: { files: [new File(["image"], "extra.png", { type: "image/png" })] },
  });
  expect(await screen.findByText("You can add up to 10 image references")).toBeTruthy();
  expect(first.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(first);
  expect(screen.getByText("9 of 10 selected")).toBeTruthy();
  expect(extra.disabled).toBe(false);
  fireEvent.click(extra);
  expect(extra.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  const useAsReference = await screen.findByRole("button", { name: "Use as reference" });
  fetchRequest.mockClear();
  fireEvent.click(useAsReference);
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("You can add up to 10 image references"));
  expect(fetchRequest).not.toHaveBeenCalled();
});


it("preserves the chosen theme when opening a fresh workspace view", async () => {
  const { unmount } = render(<Workspace />);
  fireEvent.click(screen.getByLabelText("Toggle color theme"));
  unmount();

  render(<Workspace settingsPage />);
  try {
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  } finally {
    window.localStorage.removeItem("image-queue-theme");
  }
});


it("keeps tag edits available to retry after a settings error", async () => {
  const { editTagAction } = await import("../src/actions");
  let finish!: () => void;
  vi.mocked(editTagAction).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ serverError: "Could not rename tag" } as never);
  }));
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      jobs: [{ ...state.jobs[0], tags: [{ tag: "original" }] }],
    }),
  })));
  render(<Workspace settingsPage />);
  await screen.findByRole("option", { name: "original (1)" });
  fireEvent.change(screen.getByRole("combobox", { name: "Existing tag" }), { target: { value: "original" } });
  const replacement = screen.getByLabelText("Rename or merge into") as HTMLInputElement;
  const save = screen.getByRole("button", { name: "Rename or merge" }) as HTMLButtonElement;
  expect(replacement.maxLength).toBe(60);
  fireEvent.change(replacement, { target: { value: "a".repeat(61) } });
  expect(save.disabled).toBe(true);
  fireEvent.change(replacement, { target: { value: "replacement" } });
  fireEvent.click(save);
  expect(save.disabled).toBe(true);
  expect(replacement.disabled).toBe(true);
  fireEvent.click(save);
  expect(editTagAction).toHaveBeenCalledOnce();
  finish();
  await screen.findByText("Could not rename tag");
  expect(replacement.value).toBe("replacement");

  fireEvent.click(save);
  await screen.findByText("Tag updated across the library");
  expect(replacement.value).toBe("");
});

it("keeps an earlier import result out of the image detail header", async () => {
  vi.stubGlobal("fetch", vi.fn(async input => ({
    ok: true,
    json: async () => String(input) === "/api/import"
      ? { job: { projectId: "inbox" } }
      : structuredClone(state),
  })));
  await ready();
  fireEvent.change(screen.getByTestId("import-file-input"), {
    target: { files: [new File(["image"], "frame-1.png", { type: "image/png" })] },
  });
  await screen.findByText("frame-1.png: imported");
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  await screen.findByRole("dialog");
  expect(screen.queryByText("frame-1.png: imported")).toBeNull();
  expect(screen.getByRole("button", { name: "Copy prompt" })).toBeTruthy();
});


it("offers retry and reference repair instead of a disabled version editor for blocked jobs", async () => {
  const data=structuredClone(state);
  Object.assign(data.jobs[0],{status:"blocked",error:"Reference file is missing"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>data})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  await screen.findByRole("dialog");
  expect(screen.queryByLabelText("Next version")).toBeNull();
  expect(screen.getByRole("button",{name:"Attach reference"})).toBeTruthy();
  expect(screen.queryByRole("link",{name:"Manage workers"})).toBeNull();
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("button",{name:"Close"})));
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await waitFor(()=>expect(retryImageAction).toHaveBeenCalledWith({id:"IMG-first",acknowledgeUncertain:false}));
});
it("shows explicit uncertain-result actions without automatically retrying",async()=>{
  const data=structuredClone(state);
  Object.assign(data.jobs[0],{status:"uncertain",source:"api",provider:"openai",error:"Connection ended"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>data})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  await screen.findByRole("dialog");
  expect(retryImageAction).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Mark as failed"})).toBeTruthy();
  expect(screen.getByRole("link",{name:"Open provider dashboard"}).getAttribute("href")).toBe("https://platform.openai.com/usage");
  fireEvent.click(screen.getByRole("button",{name:"Retry (may be charged again)"}));
  await waitFor(()=>expect(retryImageAction).toHaveBeenCalledWith({id:"IMG-first",acknowledgeUncertain:true}));
});

it("marks only the failed action as pending while keeping the retry label stable", async () => {
  const data = structuredClone(state);
  Object.assign(data.jobs[0], { status: "uncertain", source: "api" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof markUncertainFailedAction>>>();
  vi.mocked(markUncertainFailedAction).mockImplementationOnce(() => pending.promise);

  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open IMG-first" }));
  const markFailed = await screen.findByRole("button", { name: "Mark as failed" });
  fireEvent.click(markFailed);
  expect(markUncertainFailedAction).toHaveBeenCalledWith({ id: "IMG-first" });
  expect(retryImageAction).not.toHaveBeenCalled();
  const retry = screen.getByRole<HTMLButtonElement>("button", { name: "Retry (may be charged again)" });
  expect(retry.disabled).toBe(true);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(markFailed.getAttribute("aria-busy")).toBe("true");

  const failed: import("../src/core/schema").Job = {
    ...data.jobs[0],
    source: "api",
    provider: "openai",
    model: "gpt-image-1.5",
    status: "failed",
    idempotencyKey: "first",
    requestHash: "original-request",
    createdAt: "2026-11-17T12:00:00Z",
    updatedAt: "2026-11-17T12:01:00Z",
  };
  Object.assign(data.jobs[0], failed);
  await act(async () => pending.resolve({ data: failed }));
  expect((await screen.findByRole<HTMLButtonElement>("button", { name: "Retry" })).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "Mark as failed" })).toBeNull();
  expect(retryImageAction).not.toHaveBeenCalled();
});

it("opens reference attachment with the blocked request's destination and prompt",async()=>{
  const data=structuredClone(state);
  Object.assign(data.jobs[0],{status:"blocked",error:"Reference unavailable",referenceIds:["missing-reference"]});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>data})));
  await ready();
  const picker=vi.spyOn(screen.getByTestId("reference-file-input"),"click").mockImplementation(()=>{});
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(await screen.findByRole("button",{name:"Attach reference"}));
  await waitFor(()=>expect(picker).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox",{name:"Image prompt"}) as HTMLTextAreaElement).value).toBe("A red panda");
  expect((screen.getByLabelText("Destination project") as HTMLSelectElement).value).toBe("project");
  expect(requestImageAction).not.toHaveBeenCalled();
  picker.mockRestore();
});
it("keeps failed retry feedback in the dialog and allows another attempt",async()=>{
  const data=structuredClone(state);Object.assign(data.jobs[0],{status:"blocked",error:"Reference unavailable"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>data})));
  vi.mocked(retryImageAction).mockResolvedValueOnce({serverError:"Directory settings changed. Try again."} as never);
  await ready();fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
  fireEvent.click(await screen.findByRole("button",{name:"Retry"}));
  await screen.findByText("Directory settings changed. Try again.");
  expect((screen.getByRole("button",{name:"Retry"}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("updates an open pending preview when polling reports a terminal result",async()=>{
  const timer=vi.spyOn(globalThis,"setInterval");
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Open IMG-queued"}));
  expect(screen.queryByLabelText("Next version")).toBeNull();
  const next=structuredClone(state);Object.assign(next.jobs[1],{status:"blocked",error:"Reference unavailable"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>next})));
  const poll=timer.mock.calls.find(call=>call[1]===5000)?.[0];
  expect(typeof poll).toBe("function");
  await act(async()=>{(poll as ()=>void)();});
  timer.mockRestore();
  await screen.findByRole("button",{name:"Retry"});
  expect(screen.queryByLabelText("Next version")).toBeNull();
});


it("preserves dropped gallery order without duplicating a native image file", async () => {
  const references: { id: string; projectId: string; name: string; kind: string; mime: string; blobKey: string }[] = [];
  const loaded = { ...structuredClone(state), jobs: state.jobs.map(job => ({ ...job, status: "done" })) };
  const fetchRequest = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/asset")) return { ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) };
    if (url === "/api/upload") {
      const reference = { id: `ref-${references.length + 1}`, projectId: "project", name: ((options?.body as FormData).get("file") as File).name, kind: "image", mime: "image/png", blobKey: "refs/image" };
      references.push(reference);
      return { ok: true, json: async () => reference };
    }
    return { ok: true, json: async () => ({ ...loaded, references: [...references] }) };
  });
  vi.stubGlobal("fetch", fetchRequest);
  render(<Workspace initialProject="project" initialState={loaded as never} />);
  screen.getByLabelText("Attach image reference").focus();
  const prompt = screen.getByLabelText("Image prompt");
  fireEvent.drop(prompt.closest("form")!, { dataTransfer: {
    getData: (type: string) => type === "application/x-image-queue-jobs" ? JSON.stringify(["IMG-queued", "IMG-first"]) : "",
    files: [new File(["native copy"], "asset.png", { type: "image/png" })],
  } });
  await waitFor(() => expect(document.activeElement).toBe(prompt));
  expect(fetchRequest.mock.calls.filter(([url]) => url === "/api/upload")).toHaveLength(2);
  expect(references.map(reference => reference.name)).toEqual(["IMG-queued.png", "IMG-first.png"]);
});

it("keeps the reference strip in the same selection order sent to the queue", async () => {
  const references = ["a", "b"].map(id => ({ id, projectId: "project", kind: "image", name: `${id}.png`, mime: "image/png", blobKey: `refs/${id}`, createdAt: "2026-11-16" }));
  const loaded = { ...structuredClone(state), references };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => loaded })));
  render(<Workspace initialProject="project" initialState={loaded as never} />);
  fireEvent.click(screen.getByLabelText("Attach image reference"));
  fireEvent.click(await screen.findByRole("button", { name: "b.png" }));
  fireEvent.click(screen.getByRole("button", { name: "a.png" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect([...document.querySelectorAll<HTMLElement>(".reference-strip [data-reference-id]")].map(e => e.dataset.referenceId)).toEqual(["b", "a"]);
  fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "Use the first reference for the composition" } });
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalled());
  expect(vi.mocked(requestImageAction).mock.calls.at(-1)?.[0].referenceIds).toEqual(["b", "a"]);
});

it("offers only image uploads and hides legacy video references", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), references: [
      { id: "image-ref", projectId: "project", kind: "image", name: "style.png", blobKey: "refs/image" },
      { id: "old-video", projectId: "project", kind: "video", name: "old.mp4", blobKey: "refs/video" },
    ],
  }) })));
  await ready();
  expect(screen.getByTestId("reference-file-input").getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  fireEvent.click(screen.getByLabelText("Attach image reference"));
  expect(await screen.findByRole("button", { name: "style.png" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "old.mp4" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "style.png" }));
  expect(screen.getByRole("button", { name: "style.png" }).getAttribute("aria-pressed")).toBe("true");
});

it("hides discovered models without usable size profiles from the composer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    ...structuredClone(state), models: [
      ...state.models,
      { ...state.models[0], id: "unprofiled", name: "Unprofiled model", sizeProfile: undefined },
    ],
  }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  // The composer and the sidebar both list models; neither offers one without a size profile.
  expect(screen.getAllByRole("option", { name: "Image test" }).length).toBe(2);
  expect(screen.queryByRole("option", { name: "Unprofiled model" })).toBeNull();
});

it("shows and switches the generation source and model in the sidebar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...structuredClone(state), generationSource: { source: "queue" } }) })));
  render(<Workspace initialState={{ ...structuredClone(state), generationSource: { source: "queue" } } as never} />);
  const status = document.querySelector(".generation-status")!;
  const sourceSelect = screen.getByLabelText("Active generation source") as HTMLSelectElement;
  expect(sourceSelect.value).toBe("queue");
  expect(screen.queryByLabelText("Active image model")).toBeNull();
  fireEvent.change(sourceSelect, { target: { value: "api" } });
  await waitFor(() => expect(generationSourceAction).toHaveBeenCalledWith(expect.objectContaining({ source: "api" })));
  // The composer follows the same setting, and the model becomes switchable beside it.
  expect((screen.getByLabelText("Generation source") as HTMLSelectElement).value).toBe("api");
  expect(await screen.findByLabelText("Active image model")).toBeTruthy();
  await waitFor(() => expect(status.textContent).toContain("Billed to your OpenAI key"));
});


it("updates the provider state from the saved catalog and shows success without error styling", async () => {
  vi.mocked(connectAction).mockResolvedValueOnce({ data: state.models } as never);
  render(<Workspace settingsPage initialState={{ ...state, models: [] } as never} />);
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "fixture-key-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect & load models" }));
  const success = await screen.findByText("Provider connected and image models refreshed");
  expect(success.closest(".toast")).toBeTruthy();
  expect(success.classList.contains("field-error")).toBe(false);
  expect(document.querySelector(".provider-success")).toBeNull();
  expect(document.querySelector(".settings-notice")).toBeNull();
  expect(screen.getByRole("button", { name: "Update key & refresh models" })).toBeTruthy();
  expect(screen.getByText("Model catalog saved", { exact: true })).toBeTruthy();
});

it("toasts when the provider connects but the workspace cannot refresh", async () => {
  vi.mocked(connectAction).mockResolvedValueOnce({ data: state.models } as never);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  render(<Workspace settingsPage initialState={{ ...state, models: [] } as never} />);
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "fixture-key-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect & load models" }));
  const success = await screen.findByText("Provider connected. Refresh the page to reload the workspace.");
  expect(success.closest(".toast")).toBeTruthy();
  expect(document.querySelector(".settings-notice")).toBeNull();
  expect(screen.queryByText("Provider connected and image models refreshed")).toBeNull();
});

it("distinguishes a connected provider without a size profile from a missing connection", async () => {
  const unprofiled = state.models.map(({ sizeProfile: _profile, ...model }) => model);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...structuredClone(state), models: unprofiled }) })));
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  expect(screen.getByLabelText<HTMLSelectElement>("Provider").value).toBe("openai");
  expect(screen.queryByRole("button", { name: /Connect OpenAI/ })).toBeNull();
  expect(screen.getByRole("option", { name: "No models available" })).toBeTruthy();
});

it("selects the first supported image model when switching to API generation", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Image model").value).toBe("gpt-image-test"));
});

it("restores custom formats and keeps them in the menu after selecting a preset", async () => {
  window.localStorage.setItem("image-queue-custom-sizes", JSON.stringify({sizes:["1080x1920"],selected:"1080x1920"}));
  render(<Workspace initialState={structuredClone(state) as any} />);
  fireEvent.change(screen.getByLabelText("Generation source"), {target:{value:"queue"}});
  const select = screen.getByLabelText("Image size") as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("1080x1920"));
  fireEvent.change(select,{target:{value:"1024x1024"}});
  expect(Array.from(select.options).some(option=>option.value==="1080x1920")).toBe(true);
  expect(JSON.parse(window.localStorage.getItem("image-queue-custom-sizes")!).sizes).toContain("1080x1920");
});

it("links a missing provider notice directly to connection settings", async () => {
  vi.mocked(requestImageAction).mockResolvedValueOnce({serverError:"Connect this provider in Settings first"} as never);
  await ready();
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"A test image"}});
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  const link = await screen.findByRole("link",{name:"Open settings"});
  expect(link.getAttribute("href")).toBe("/settings#provider-connection");
});


it("disables generation for empty or whitespace-only prompts", async () => {
  await ready();
  const send=screen.getByLabelText(/^(Generate image|Add to queue)$/) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"   "}});
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Image prompt"),{target:{value:"A blue square"}});
  expect(send.disabled).toBe(false);
});

it("keeps a draft while submitting, prevents duplicate shortcuts and preserves newer text", async () => {
  await ready();
  let resolve!: (value: Awaited<ReturnType<typeof requestImageAction>>) => void;
  vi.mocked(requestImageAction).mockImplementationOnce(() => new Promise(done => { resolve=done; }) as ReturnType<typeof requestImageAction>);
  const prompt=screen.getByLabelText("Image prompt") as HTMLTextAreaElement;
  fireEvent.change(prompt,{target:{value:"First request"}});
  fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
  await waitFor(()=>expect(requestImageAction).toHaveBeenCalledTimes(1));
  expect(prompt.value).toBe("First request");
  expect(screen.getByLabelText(/^(Generate image|Add to queue)$/).getAttribute("aria-busy")).toBe("true");
  fireEvent.keyDown(prompt,{key:"Enter",metaKey:true});
  fireEvent.change(prompt,{target:{value:"Next draft"}});
  await act(async()=>{resolve({data:{...state.jobs[0],id:"IMG-new"}} as unknown as Awaited<ReturnType<typeof requestImageAction>>);});
  expect(requestImageAction).toHaveBeenCalledTimes(1);
  expect(prompt.value).toBe("Next draft");
});
it("groups settings sections and marks the one in view", async () => {
  render(<Workspace settingsPage />);
  const nav = await screen.findByRole("navigation", { name: "Settings sections" });
  const groups = [...nav.querySelectorAll("[role=group]")].map(group => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent);
  expect(groups).toEqual(["Generation", "Storage", "Library", "Agents"]);
  const links = [...nav.querySelectorAll("a")].map(link => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Default source", "#generation-source"], ["Providers", "#provider-connection"], ["Worker pool", "#worker-pool"],
    ["Project folders", "#project-folders"], ["Local directories", "#local-directories"],
    ["Tags and search", "#tag-settings"], ["Connect an agent", "#agent-connection"],
  ]);
  for (const [, href] of links) expect(document.querySelector(href!)).toBeTruthy();
  expect(nav.querySelector("[aria-current=location]")?.textContent).toBe("Default source");
  fireEvent.click(screen.getByRole("link", { name: "Worker pool" }));
  expect(nav.querySelector("[aria-current=location]")?.textContent).toBe("Worker pool");
  expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Worker", "State", "Last heartbeat"]);
});
it("shows one connection action instead of unavailable model and generation controls in image details",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...structuredClone(state),models:[]})})));
 await ready();fireEvent.click(screen.getByRole("button",{name:"Open IMG-first"}));
 fireEvent.change(screen.getByLabelText("Next version source"),{target:{value:"api"}});
 expect(screen.queryByLabelText("Next version model")).toBeNull();
 expect(screen.queryByRole("button",{name:"Request next version"})).toBeNull();
 const connect=screen.getByRole("button",{name:"Connect OpenAI in Settings"});
 expect(connect).toHaveProperty("disabled",false);
 fireEvent.click(connect);expect(routerPush).toHaveBeenLastCalledWith("/settings?provider=openai");
});


it("shows only enabled worker slots and workers draining an existing claim", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...state, pool: {...state.pool, workers: 1}, pulses: [{slot: 3, workerId: "draining", draining: true, mode: "disabled", lastWake: new Date().toISOString()}] }) })));
  render(<Workspace settingsPage />);
  expect(await screen.findByRole("rowheader", {name: "Worker 1"})).toBeTruthy();
  expect(screen.getByRole("rowheader", {name: "Worker 3"})).toBeTruthy();
  expect(screen.queryByRole("rowheader", {name: "Worker 2"})).toBeNull();
  expect(screen.queryByRole("rowheader", {name: "Worker 4"})).toBeNull();
  expect(screen.queryByRole("rowheader", {name: "Worker 5"})).toBeNull();
  expect(screen.getByText("Finishing current image")).toBeTruthy();
});

it("shows direct local execution without chat schedules or heartbeat slots", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...state,localRunner:{mode:'local',running:1,enabled:2},pool:{...state.pool,workers:2}})})));
  render(<Workspace settingsPage />);
  expect(await screen.findByRole('heading',{name:'Generating'})).toBeTruthy();
  expect(screen.queryByText('Idle interval (minutes)')).toBeNull();
  expect(screen.queryByRole('rowheader',{name:'Worker 1'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Copy saved worker configuration'})).toBeNull();
  expect(screen.queryByText(/Scheduled chats take no new requests/)).toBeNull();
  expect(screen.getByRole("button",{name:"Pause"})).toBeTruthy();
  expect(document.querySelector(".runner-advanced")?.hasAttribute("open")).toBe(false);
});

it('does not suggest saving worker settings when Codex must be installed first',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({...state,localRunner:{mode:'local',running:0,enabled:0,blockedReason:'Install Codex and restart image-queue.',canResume:false}})})));
 render(<Workspace settingsPage />);
 expect(await screen.findByText('Install Codex and restart image-queue.')).toBeTruthy();
 expect(screen.queryByText(/Save worker settings to resume/)).toBeNull();
});

it("reports search index rebuild success and failure without false success", async () => {
  render(<Workspace settingsPage />);
  const rebuild = await screen.findByRole("button", { name: "Rebuild search index" });
  fireEvent.click(rebuild);
  await screen.findByText("Search index rebuilt");
  vi.mocked(rebuildIndexAction).mockResolvedValueOnce({ serverError: "Could not save search index" } as any);
  fireEvent.click(rebuild);
  await screen.findByText("Could not save search index");
  expect(screen.queryByText("Search index rebuilt")).toBeNull();
});

it("keeps the workspace usable while warning about an untested platform", async () => {
  const loaded = { ...structuredClone(state), platformSupport: { tested: false, platform: "linux", architecture: "x64", warning: "Untested on this platform. image-queue has been tested on macOS with Apple silicon only." } };
  render(<Workspace initialState={loaded as never} />);
  expect(screen.getByText(loaded.platformSupport.warning)).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Image prompt" }) as HTMLTextAreaElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole("textbox", { name: "Image prompt" }), { target: { value: "A blue circle" } });
  expect((screen.getByRole("button", { name: /^(Generate image|Add to queue)$/ }) as HTMLButtonElement).disabled).toBe(false);
});

it("explains a queue stopped by a failed attempt in the gallery and offers the stopped image", async () => {
  const loaded = structuredClone(state);
  const stopped = loaded.jobs.find(job => job.source === "queue")!;
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...loaded,jobs:[...loaded.jobs,{...stopped,id:"waiting",status:"running",claim:{reserved:true}}],localRunner:{mode:"local",paused:false,enabled:1,running:0,desiredWorkers:1,blockedReason:"Codex is not signed in. Sign in locally, then resume execution.",blockedJobId:stopped.id}})})));
  await ready();
  const notice = screen.getByText("Queue stopped — action needed").closest(".queue-paused-notice")!;
  expect(notice.textContent).toContain("Codex is not signed in");
  expect(notice.querySelector("a")?.getAttribute("href")).toBe("/settings#worker-pool");
  expect(screen.queryByText("Generation paused")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Inspect stopped image" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("shows a prominent paused notice when local queue jobs wait and resumes only on click", async () => {
  const { pauseLocalRunnerAction } = await import("../src/actions");
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({...structuredClone(state),localRunner:{mode:"local",paused:true,enabled:0,running:0,desiredWorkers:1}})})));
  await ready();
  expect(screen.getByText("Generation paused")).toBeTruthy();
  expect(screen.getByText("Queued images are waiting. Resume to start generating on this machine.")).toBeTruthy();
  expect(pauseLocalRunnerAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/^Resume$/}));
  await waitFor(()=>expect(pauseLocalRunnerAction).toHaveBeenCalledWith({paused:false}));
});

it("offers bulk Retry for selected blocked queue images in Everything", async () => {
  const data=structuredClone(state);Object.assign(data.jobs[0],{status:"blocked",error:"Reference unavailable"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>data})));
  await ready();
  fireEvent.click(screen.getByRole("button",{name:"Select images"}));
  expect(screen.getByRole("button",{name:/^Retry$/})).toBeTruthy();
});

describe("submit confirmation follows the new tile's visibility", () => {
  const created = { ...state.jobs[1], id: "IMG-new", prompt: "A brand new tile" };
  const rect = (top: number, height: number, bottom = top + height) =>
    ({ top, bottom, left: 40, right: 240, width: 200, height, x: 40, y: top, toJSON() {} }) as DOMRect;
  function serveCreatedJobAfterSubmit() {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => {
        const next = structuredClone(state);
        if (vi.mocked(requestImageAction).mock.calls.length) next.jobs.unshift(structuredClone(created));
        return next;
      },
    })));
  }
  function placeNewTileAt(top: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.jobId) return this.dataset.jobId === "IMG-new" ? rect(top, 200) : rect(320, 200);
      return rect(0, 0);
    });
  }
  async function submitPrompt() {
    fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "A brand new tile" } });
    fireEvent.click(screen.getByLabelText(/^(Generate image|Add to queue)$/));
    await waitFor(() => expect(requestImageAction).toHaveBeenCalledOnce());
  }
  afterEach(() => vi.restoreAllMocks());

  it("shows no notice when the new tile appears on screen", async () => {
    serveCreatedJobAfterSubmit();
    placeNewTileAt(120);
    await ready();
    await submitPrompt();
    await waitFor(() => expect(document.querySelector('[data-job-id="IMG-new"]')).not.toBeNull());
    await act(async () => {});
    expect(screen.queryByText("Added to the Codex queue")).toBeNull();
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("confirms the request when the new tile is scrolled out of view", async () => {
    serveCreatedJobAfterSubmit();
    placeNewTileAt(-900);
    await ready();
    await submitPrompt();
    await screen.findByText("Added to the Codex queue");
  });

  it("confirms the request when the new tile sits behind the prompt editor", async () => {
    serveCreatedJobAfterSubmit();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("composer")) return rect(560, 180);
      if (this.dataset.jobId) return rect(this.dataset.jobId === "IMG-new" ? 600 : 100, 200);
      return rect(0, 0);
    });
    await ready();
    await submitPrompt();
    await screen.findByText("Added to the Codex queue");
  });

  it("confirms the request when a search hides the new tile", async () => {
    serveCreatedJobAfterSubmit();
    placeNewTileAt(120);
    await ready();
    fireEvent.change(screen.getByLabelText("Search images"), { target: { value: "panda" } });
    await submitPrompt();
    await screen.findByText("Added to the Codex queue");
    expect(document.querySelector('[data-job-id="IMG-new"]')).toBeNull();
  });
});

it("places notifications above the measured prompt editor and in the corner when it is hidden", async () => {
  const observers: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) { observers.push(() => this.callback()); }
    observe() {}
    disconnect() {}
  });
  let editorHeight = 180;
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} }) as DOMRect;
    if (this.classList.contains("composer-wrap")) return editorHeight ? box(768 - editorHeight - 49, editorHeight + 49) : box(0, 0);
    if (this.classList.contains("composer")) return editorHeight ? box(768 - editorHeight - 21, editorHeight) : box(0, 0);
    return box(0, 0);
  });
  const { container } = render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  const root = container.querySelector<HTMLElement>(".workspace")!;
  // Editor top edge: its height plus the wrap's 21px bottom padding, measured from the viewport bottom.
  expect(root.style.getPropertyValue("--toast-editor-offset")).toBe("201px");
  editorHeight = 260;
  act(() => observers.forEach(notify => notify()));
  expect(root.style.getPropertyValue("--toast-editor-offset")).toBe("281px");
  fireEvent.click(screen.getByRole("button", { name: "Minimize prompt editor" }));
  editorHeight = 0;
  act(() => observers.forEach(notify => notify()));
  expect(root.style.getPropertyValue("--toast-editor-offset")).toBe("");
  spy.mockRestore();
});

it("keeps local queue health visible when API is the saved default source",async()=>{
 const loaded={...structuredClone(state),generationSource:{source:"api"},localRunner:{mode:"local",paused:true,enabled:0,running:0,desiredWorkers:5}};
 const {container}=render(<Workspace initialState={loaded as never} />);
 expect(screen.getByRole('combobox',{name:'Generation source'}).textContent).toContain('Your API key');
 expect(container.querySelector('.queue-health [aria-live="polite"]')?.textContent).not.toBe('Not configured');
});

it("saves the default source in Settings without submitting or resuming work", async () => {
  const { generationSourceAction, pauseLocalRunnerAction } = await import('../src/actions');
  vi.mocked(generationSourceAction).mockClear();
  vi.mocked(requestImageAction).mockClear();
  vi.mocked(pauseLocalRunnerAction).mockClear();
  render(<Workspace initialState={state as never} settingsPage />);
  fireEvent.change(screen.getByRole('combobox', {name:'Default generation source'}), {target:{value:'api'}});
  await waitFor(() => expect(generationSourceAction).toHaveBeenCalledWith({source:'api',provider:'openai'}));
  const saved = await screen.findByText("Default source saved. Existing requests keep their source.");
  expect(saved.classList.contains("settings-notice")).toBe(true);
  expect(document.querySelector(".toast")).toBeNull();
  await waitFor(() => expect((screen.getByRole('combobox', {name:'Default generation source'}) as HTMLSelectElement).value).toBe('api'));
  expect(requestImageAction).not.toHaveBeenCalled();
  expect(pauseLocalRunnerAction).not.toHaveBeenCalled();
});

it("restores the composer source when saving its default fails", async () => {
  const {generationSourceAction} = await import('../src/actions');
  vi.mocked(generationSourceAction).mockResolvedValueOnce({serverError:'Could not save source'} as never);
  render(<Workspace initialState={{...state,generationSource:{source:'queue'}} as never} />);
  fireEvent.change(screen.getByRole('combobox', {name:'Generation source'}), {target:{value:'api'}});
  await waitFor(() => expect(screen.getByText('Could not save source')).toBeDefined());
  expect((screen.getByRole('combobox', {name:'Generation source'}) as HTMLSelectElement).value).toBe('queue');
});

const capableModels = [
  {
    id: "gpt-image-2.6-sunburst", name: "Sunburst", provider: "openai", transparency: true, references: true,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
    qualities: ["low", "medium", "high", "xhigh", "auto"],
    complexities: ["low", "medium", "high"],
    outputFormats: ["png", "webp", "jpeg", "gif", "svg"],
  },
  {
    id: "gpt-image-1-mini", name: "Mini", provider: "openai", transparency: true, references: true,
    sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] },
    qualities: ["low", "medium"], complexities: [], outputFormats: ["png", "webp"],
  },
];

it("offers API quality, complexity, format and count, and blocks conflicting formats", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(state), models: capableModels, references: [
      { id: "ref", projectId: "project", name: "panda.png", kind: "image" },
    ] }),
  })));
  render(<Workspace />);
  await screen.findByRole("button", { name: "Open IMG-first" });
  expect(screen.queryByLabelText("Quality")).toBeNull();
  expect(screen.queryByLabelText("Format")).toBeNull();
  expect(screen.getByLabelText("Image variants").querySelectorAll("option")).toHaveLength(4);
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  await waitFor(() => expect(screen.getByLabelText("Quality")).toBeTruthy());
  expect(screen.getByLabelText("Image variants").querySelectorAll("option")).toHaveLength(10);
  const quality = screen.getByLabelText("Quality");
  expect(quality.querySelectorAll("option").length).toBe(5);
  expect([...quality.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Auto quality", "Low quality", "Medium quality", "High quality", "Extra high quality"]);
  expect([...screen.getByLabelText("Complexity").querySelectorAll("option")].map(option => option.textContent)).toEqual(["Default complexity", "Low complexity", "Medium complexity", "High complexity"]);
  const formatOption = (name: string) => screen.getByLabelText("Format").querySelector(`option[value="${name}"]`) as HTMLOptionElement;
  fireEvent.click(screen.getByRole("checkbox", { name: "Transparent" }));
  expect(formatOption("gif").disabled).toBe(true);
  expect(formatOption("svg").disabled).toBe(true);
  expect(screen.getByText("Transparent background requires PNG or WebP output.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "gif" } });
  await waitFor(() => expect(screen.getByLabelText("Format")).toHaveProperty("value", "png"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Transparent" }));
  fireEvent.click(screen.getByRole("button", { name: "Attach image reference" }));
  fireEvent.click(await screen.findByRole("button", { name: "panda.png" }));
  expect(formatOption("gif").disabled).toBe(false);
  expect(formatOption("svg").disabled).toBe(true);
  expect(screen.getByText("SVG output cannot be combined with reference images.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "panda.png" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "xhigh" } });
  fireEvent.change(screen.getByLabelText("Complexity"), { target: { value: "low" } });
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "gif" } });
  expect(screen.getByLabelText("Format")).toHaveProperty("value", "gif");
  expect(screen.getByRole("checkbox", { name: "Transparent" }).hasAttribute("data-disabled")).toBe(true);
  expect(screen.getByText("Transparent background is available with PNG or WebP output.")).toBeTruthy();
  expect(document.getElementById("format-constraint")?.closest(".composer-hint")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Frames"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Image variants"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "queue" } });
  await waitFor(() => expect(screen.queryByLabelText("Format")).toBeNull());
  expect(screen.getByRole("checkbox", { name: "Transparent" }).hasAttribute("data-disabled")).toBe(false);
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "api" } });
  await waitFor(() => expect(screen.getByLabelText("Format")).toHaveProperty("value", "gif"));
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-1-mini" } });
  await waitFor(() => expect(screen.getByLabelText("Quality")).toHaveProperty("value", ""));
  expect(screen.queryByLabelText("Complexity")).toBeNull();
  expect(screen.queryByLabelText("Frames")).toBeNull();
  expect(screen.getByLabelText("Format")).toHaveProperty("value", "png");
  fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "medium" } });
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "webp" } });
  fireEvent.change(screen.getByLabelText("Image prompt"), { target: { value: "A painted panda" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate image" }));
  await waitFor(() => expect(requestImageAction).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(requestImageAction).mock.calls[0][0];
  expect(payload).toMatchObject({ source: "api", quality: "medium", outputFormat: "webp", count: 2 });
  expect(payload).not.toHaveProperty("complexity");
  expect(payload).not.toHaveProperty("frameCount");
  expect(payload).not.toHaveProperty("frameDurationMs");
  fireEvent.change(screen.getByLabelText("Generation source"), { target: { value: "queue" } });
  await waitFor(() => expect(screen.queryByLabelText("Quality")).toBeNull());
  expect(screen.queryByLabelText("Format")).toBeNull();
});

it("shows stored format settings and restores them from the detail view", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...structuredClone(state),
      models: capableModels,
      jobs: [{ ...state.jobs[0], source: "api", model: "gpt-image-2.6-sunburst", outputFormat: "webp", quality: "high", complexity: "low" }],
    }),
  })));
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Open IMG-first" }));
  const metadata = [...document.querySelectorAll(".detail-metadata")].map(node => node.textContent).join(" ");
  expect(metadata).toMatch(/WebP/);
  expect(metadata).toMatch(/High quality/);
  expect(metadata).toMatch(/Low complexity/);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reuse prompt" }));
  await waitFor(() => expect(screen.getByLabelText("Format")).toHaveProperty("value", "webp"));
  expect(screen.getByLabelText("Quality")).toHaveProperty("value", "high");
  expect(screen.getByLabelText("Complexity")).toHaveProperty("value", "low");
});

it("links the processing panel and saves a source pause independently of provider access", async () => {
  const source = { paused: false, workers: 2, policy: { limit: 0, windowMinutes: 60 }, online: true, running: 0 };
  const initialState = {
    ...state, processing: { mode: "local", paused: false, queue: source, api: source },
    localRunner: { mode: "local", paused: false, enabled: 2, running: 0 },
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => initialState })));
  render(<Workspace settingsPage initialState={initialState as never} />);
  expect(screen.getByRole("link", { name: "Processing" }).getAttribute("href")).toBe("#queue-processing");
  fireEvent.click(screen.getByRole("button", { name: "Pause OpenAI API" }));
  await waitFor(() => expect(processingAction).toHaveBeenCalledWith({ source: "api", paused: true }));
  expect(screen.getByRole("button", { name: "Pause Codex queue" })).toBeTruthy();
});
