import { UserFacingError } from "../src/core/user-facing-error";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

afterEach(()=>vi.unstubAllEnvs());
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  openFile: vi.fn(),
  openConfigFolder: vi.fn(),
  create: vi.fn(),
  createProject: vi.fn(),
  move: vi.fn(),
  moveProject: vi.fn(),
  revalidatePath: vi.fn(),
  enqueue: vi.fn(),
  dispatch: vi.fn(),
  retryBlocked: vi.fn(),
  retryImage: vi.fn(),
  retryImageJob: vi.fn(),
  markUncertainFailed: vi.fn(),
  headers: vi.fn(async () => new Headers({ host: "localhost" })),
  get: vi.fn(),
  put: vi.fn(),
  discover: vi.fn(),
  saveKey: vi.fn(),
  readKey: vi.fn(async () => "fixture-key"),
  cancel: vi.fn(),
  cancelJob: vi.fn(),
}));
vi.mock("../src/storage/open-agent-config-directory", () => ({openAgentConfigDirectory:mocks.openConfigFolder}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("node:child_process", () => ({ execFile: mocks.openFile }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("../src/core/access", () => ({ verifyAccess: async () => {} }));
vi.mock("../src/core/runtime", () => ({
  service: async () => ({
    create: mocks.create,
    retryImage: mocks.retryImage,
    markUncertainFailed: mocks.markUncertainFailed,
    createProject: mocks.createProject,
    moveJob: mocks.move,
    moveProject: mocks.moveProject,
    cancelJob: mocks.cancelJob,
    store: {
      put: mocks.put,
      get: mocks.get,
      lock: async (_key: string, work: () => unknown) => work(),
    },
  }),
  enqueue: mocks.enqueue,
  dispatch: mocks.dispatch,
  retryBlockedQueueJob: mocks.retryBlocked,
  retryImageJob: mocks.retryImageJob,
}));
vi.mock("../src/core/settings", () => ({
  saveKey: mocks.saveKey,
  readKey: mocks.readKey,
  removeKey: vi.fn(),
}));
vi.mock("../src/sources/providers", () => ({ discoverModels: mocks.discover }));
vi.mock("../src/sources/queue", () => ({
  queueRoot: () => "/tmp",
  configuredQueueRoot: async () => "/tmp/fixture-queue",
  queueOutputPath: async () => "/tmp/fixture-queue/out/image.png",
  cancelQueue: mocks.cancel,
}));

import {
  cancelAction,
  pathSettingsAction,
  disconnectAction,
  connectAction,
  testConnectionAction,
  createProjectAction,
  moveJobAction,
  moveProjectAction,
  poolConfigAction,
  requestImageAction,
  retryBlockedQueueAction,
  retryImageAction,
  markUncertainFailedAction,
  revealQueueImageAction,
  openAgentConfigDirectoryAction,
} from "../src/actions";

const request = {
  projectId: "p",
  idempotencyKey: "one",
  prompt: "A panda",
  source: "queue" as const,
  width: 1024,
  height: 1024,
  provider: "openai" as const,
  model: "",
  transparent: false,
  referenceIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readKey.mockResolvedValue("fixture-key");
  mocks.headers.mockResolvedValue(new Headers({ host: "localhost" }));

  mocks.enqueue.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "IMG-one", source: "queue" });
});
it("creates projects and moves jobs", async () => {
  mocks.createProject.mockResolvedValue({ id: "p" });
  expect((await createProjectAction({ name: "Test" }))?.data).toEqual({
    id: "p",
  });
  await moveJobAction({ id: "IMG-one", projectId: "p" });
  expect(mocks.move).toHaveBeenCalledWith("IMG-one", "p");
});
it("queues Codex images synchronously", async () => {
  await requestImageAction(request);
  expect(mocks.enqueue).toHaveBeenCalledWith("IMG-one");
});
it("creates one panel job per count without storing the count", async () => {
  mocks.create.mockImplementation(async (input: { idempotencyKey: string; count?: number }) => ({
    id: `IMG-${input.idempotencyKey}`, source: "queue", status: "queued", idempotencyKey: input.idempotencyKey,
  }));
  const result = await requestImageAction({ ...request, count: 3 });
  expect(mocks.create.mock.calls.map(call => call[0].idempotencyKey)).toEqual(["one", "one-2", "one-3"]);
  expect(mocks.create.mock.calls.every(call => call[0].count === undefined)).toBe(true);
  expect(result?.data).toMatchObject({ id: "IMG-one" });
  const data = result?.data;
  expect(data && "jobs" in data ? data.jobs.map(job => job.id) : []).toEqual(["IMG-one", "IMG-one-2", "IMG-one-3"]);
  expect(mocks.enqueue).toHaveBeenCalledTimes(3);
});
it("leaves a local API image as durable work for the API runner, in the request", async () => {
  mocks.create.mockResolvedValue({ id: "IMG-one", source: "api" });
  mocks.get.mockImplementation(async (collection: string) => collection === "models"
    ? [{ id: "gpt-image-1.5", provider: "openai", sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } }]
    : { id: "IMG-one", source: "api", status: "queued" });
  await requestImageAction({ ...request, source: "api", model: "gpt-image-1.5" });
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith("IMG-one");
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});
it("on Cloudflare hands API images to the generation queue", async () => {
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER","cloudflare");
  mocks.create.mockResolvedValue({ id: "IMG-one", source: "api" });
  mocks.get.mockImplementation(async (collection: string) => collection === "models"
    ? [{ id: "gpt-image-1.5", provider: "openai", sizeProfile: { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] } }]
    : { id: "IMG-one", source: "api", status: "queued" });
  await requestImageAction({ ...request, source: "api", model: "gpt-image-1.5" });
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith("IMG-one");
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});
it("validates provider models before storing keys", async () => {
  mocks.discover.mockResolvedValue([]);
  expect(
    (await connectAction({ provider: "openai", apiKey: "test-key-value" }))
      ?.serverError,
  ).toContain("No supported");
  mocks.discover.mockResolvedValue([{ id: "model" }]);
  await connectAction({ provider: "openai", apiKey: "test-key-value" });
  expect(mocks.saveKey).toHaveBeenCalled();
});
it("leaves stored credentials and the catalog untouched when discovery rejects the replacement key", async () => {
  mocks.discover.mockRejectedValueOnce(new UserFacingError("The provider rejected this API key (401)."));
  const result = await connectAction({ provider: "openai", apiKey: "replacement-fixture" });

  expect(result?.serverError).toBe("The provider rejected this API key (401).");
  expect(JSON.stringify(result)).not.toContain("replacement-fixture");
  expect(mocks.saveKey).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
});

it("discards unverified cached and discovered size profiles on refresh", async () => {
  const savedProfile = { mode: "fixed", sizes: [{ width: 1024, height: 1024 }] };
  const discoveredProfile = { mode: "fixed", sizes: [{ width: 1536, height: 1024 }] };
  mocks.get.mockResolvedValueOnce([
    { id: "retained", sizeProfile: savedProfile },
    { id: "updated", sizeProfile: savedProfile },
    { id: "removed", sizeProfile: savedProfile },
  ]);
  mocks.discover.mockResolvedValueOnce([
    { id: "retained", name: "Updated name" },
    { id: "updated", sizeProfile: discoveredProfile },
    { id: "new" },
  ]);
  const result = await connectAction({ provider: "openai", apiKey: "test-key-value" });
  expect(result?.data).toEqual([
    { id: "retained", name: "Updated name" },
    { id: "updated" },
    { id: "new" },
  ]);
  expect(mocks.get).toHaveBeenCalledWith("models", "openai");
  expect(mocks.put).toHaveBeenCalledWith("models", "openai", result?.data);
});
it("delegates cancellation to the shared core", async () => {
  mocks.cancelJob.mockRejectedValueOnce(
    new UserFacingError("Only queued jobs can be cancelled"),
  );
  expect((await cancelAction({ id: "IMG-one" }))?.serverError).toContain(
    "queued",
  );
  await cancelAction({ id: "IMG-one" });
  expect(mocks.cancelJob).toHaveBeenCalledWith("IMG-one");
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("saves pool configuration with validation", async () => {
  await poolConfigAction({
    workers: 2,
    idleMinutes: 5,
    activeMinutes: 1,
    activityWindowMinutes: 10,
  });
  expect(mocks.put).toHaveBeenCalledWith(
    "settings",
    "worker-pool",
    expect.objectContaining({ workers: 2 }),
  );
  expect(
    (
      await poolConfigAction({
        workers: 50,
        idleMinutes: 5,
        activeMinutes: 1,
        activityWindowMinutes: 10,
      })
    )?.validationErrors,
  ).toBeTruthy();
});

it("cancels queued API work without changing the Codex queue", async () => {
  mocks.get.mockResolvedValue({
    id: "IMG-one",
    status: "queued",
    source: "api",
  });
  await cancelAction({ id: "IMG-one" });
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it("rejects local directory configuration on Cloudflare", async () => {
  process.env.IMAGE_QUEUE_STORAGE_DRIVER = "cloudflare";
  try {
    expect(
      (
        await pathSettingsAction({
          queueDirectory: "/queue",
          referenceDirectories: ["/refs"],
        })
      )?.serverError,
    ).toContain("local workspace");
  } finally {
    delete process.env.IMAGE_QUEUE_STORAGE_DRIVER;
  }
});

it("disconnects a provider through the shared credential accessor", async () => {
  const { removeKey } = await import("../src/core/settings");
  await disconnectAction({ provider: "openrouter" });
  expect(removeKey).toHaveBeenCalledWith(expect.anything(), "openrouter");
});
it("saves validated local directory settings", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(tmpdir() + "/image-queue-action-");
  mocks.get.mockResolvedValue({
    queueDirectory: root,
    referenceDirectories: [root],
  });
  try {
    const result = await pathSettingsAction({
      queueDirectory: root,
      referenceDirectories: [root],
    });
    expect(result?.serverError).toBeUndefined();
    expect(mocks.put).toHaveBeenCalledWith(
      "settings",
      "paths",
      expect.anything(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("retries distinct blocked requests and returns partial failures", async () => {
  mocks.retryBlocked.mockResolvedValueOnce({ id: "IMG-retry" })
    .mockRejectedValueOnce(new Error("Reference is missing"))
    .mockRejectedValueOnce("Internal failure")
    .mockResolvedValueOnce({ id: "IMG-retry-third" });
  const result = await retryBlockedQueueAction({
    ids: ["IMG-first", "IMG-missing", "IMG-first", "IMG-error", "IMG-third"],
  });

  expect(mocks.retryBlocked.mock.calls).toEqual([
    ["IMG-first"], ["IMG-missing"], ["IMG-error"], ["IMG-third"],
  ]);
  expect(result?.data).toEqual({
    queued: ["IMG-first", "IMG-third"],
    failures: [
      { id: "IMG-missing", message: "Reference is missing" },
      { id: "IMG-error", message: "Retry failed" },
    ],
  });
});

it("does not reveal files for a non-local request", async () => {
  mocks.headers.mockResolvedValue(new Headers({
    origin: "https://example.test",
    host: "example.test",
  }));
  expect((await revealQueueImageAction({ id: "IMG-one" }))?.serverError)
    .toBe("Access denied");
  expect(mocks.get).not.toHaveBeenCalled();
});

it("rejects revealing an unfinished local queue job", async () => {
  if (process.platform !== "darwin") return;
  mocks.headers.mockResolvedValue(new Headers({
    origin: "http://127.0.0.1:3215",
    host: "127.0.0.1:3215",
  }));
  mocks.get.mockResolvedValueOnce({ source: "queue", status: "queued" });
  expect((await revealQueueImageAction({ id: "IMG-one" }))?.serverError)
    .toBe("This request has no local queue output");
  expect(mocks.get).toHaveBeenCalledWith("jobs", "IMG-one");
});

it.each([false, true])("reveals a finished local queue result (system error: %s)", async fails => {
  if (process.platform !== "darwin") return;
  mocks.headers.mockResolvedValue(new Headers({
    origin: "http://127.0.0.1:3215",
    host: "127.0.0.1:3215",
  }));
  mocks.get.mockResolvedValueOnce({
    source: "queue", status: "done", outputPath: "out/image.png",
  });
  mocks.openFile.mockImplementationOnce((_command, _args, _options, callback) =>
    callback(fails ? new Error("Private system error") : null),
  );
  const result = await revealQueueImageAction({ id: "IMG-one" });
  expect(mocks.openFile).toHaveBeenCalledWith(
    "/usr/bin/open", ["-R", "/tmp/fixture-queue/out/image.png"],
    { timeout: 5000 }, expect.any(Function),
  );
  expect(result?.serverError).toBe(fails ? "Finder could not reveal this image" : undefined);
});

it("updates the project folder and revalidates both dashboard routes", async () => {
  const directory = "/tmp/new project folder";
  const project = { id: "project-one", directory };
  mocks.moveProject.mockResolvedValueOnce(project);
  expect((await moveProjectAction({ id: project.id, directory }))?.data).toEqual(project);
  expect(mocks.moveProject).toHaveBeenCalledWith(project.id, directory);
  expect(mocks.revalidatePath.mock.calls).toEqual([["/"], ["/p/project-one"]]);
});

it("does not launch Finder when the browser origin is missing", async () => {
  mocks.headers.mockResolvedValue(new Headers({ host: "127.0.0.1:3215" }));
  const result = await revealQueueImageAction({ id: "IMG-one" });
  expect(result?.serverError).toBe("Finder is available from the local Mac workspace");
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.openFile).not.toHaveBeenCalled();
});


it("submits an explicit provider retry once and returns its job",async()=>{
  mocks.get.mockResolvedValue({source:"api"});
  mocks.retryImageJob.mockResolvedValue({id:"IMG-retry",source:"api"});
  const result=await retryImageAction({id:"IMG-original",acknowledgeUncertain:true});
  expect(mocks.retryImageJob).toHaveBeenCalledWith("IMG-original",true);
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.enqueue).toHaveBeenCalledWith("IMG-retry");
  expect(result?.data).toEqual({id:"IMG-retry",source:"api"});
});
it("submits a prepared queue retry without background provider work",async()=>{
  mocks.get.mockResolvedValue({source:"queue"});
  mocks.retryImageJob.mockResolvedValue({id:"IMG-retry",source:"queue"});
  await retryImageAction({id:"IMG-original"});
  expect(mocks.retryImageJob).toHaveBeenCalledWith("IMG-original",false);
  expect(mocks.enqueue).toHaveBeenCalledWith("IMG-retry");
  expect(mocks.retryImage).not.toHaveBeenCalled();
});
it("marks uncertain work failed without scheduling another generation",async()=>{
  mocks.markUncertainFailed.mockResolvedValue({id:"IMG-original",status:"failed"});
  const result=await markUncertainFailedAction({id:"IMG-original"});
  expect(result?.data?.status).toBe("failed");
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});


it("rejects an unprofiled API model before persisting a job or scheduling generation", async () => {
  mocks.get.mockResolvedValueOnce([{ id: "unprofiled" }]);
  const result = await requestImageAction({ ...request, source: "api", model: "unprofiled" });
  expect(result?.serverError).toContain("no valid size profile");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});


it.each([
  { host: "foreign.example", origin: "http://foreign.example" },
  { host: "localhost", origin: "https://foreign.example" },
  { host: "localhost", origin: "null" },
])("rejects foreign action provenance before a mutation: %j", async headers => {
  mocks.headers.mockResolvedValueOnce(new Headers(headers));
  const result = await createProjectAction({ name: "Denied" });
  expect(result?.serverError).toBe("Access denied");
  expect(mocks.createProject).not.toHaveBeenCalled();
});


it("rejects other providers before discovery or saving credentials in 0.1.0", async () => {
  for (const provider of ["google", "openrouter", "gateway"] as const) {
    const result = await connectAction({ provider, apiKey: "fixture-private-key" });
    expect(result?.serverError).toBe("Version 0.1.0 supports OpenAI only.");
  }
  expect(mocks.discover).not.toHaveBeenCalled();
  expect(mocks.saveKey).not.toHaveBeenCalled();
});

it("does not expose unexpected storage errors through server actions", async () => {
  mocks.createProject.mockRejectedValueOnce(new Error("Authorization: Bearer private-action-fixture"));
  const result = await createProjectAction({ name: "Error boundary" });
  expect(result?.serverError).toBe("The operation could not be completed. Try again.");
  expect(JSON.stringify(result)).not.toContain("private-action-fixture");
});


it("rejects a missing provider connection before creating a request", async () => {
  mocks.get.mockResolvedValue([{id:"gpt-image-1.5",provider:"openai"}]);
  mocks.readKey.mockRejectedValueOnce(new UserFacingError("Connect this provider in Settings first"));
  const result = await requestImageAction({...request,source:"api",model:"gpt-image-1.5"});
  expect(result?.serverError).toBe("Connect this provider in Settings first");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it('opens only the selected known configuration folder from a matching loopback origin',async()=>{
 mocks.headers.mockResolvedValue(new Headers({host:'127.0.0.1:3391',origin:'http://127.0.0.1:3391'}));
 await openAgentConfigDirectoryAction({client:'Codex'});expect(mocks.openConfigFolder).toHaveBeenCalledWith('Codex');
});
it('rejects folder opening without a local origin and rejects arbitrary clients',async()=>{
 await openAgentConfigDirectoryAction({client:'Codex'});expect(mocks.openConfigFolder).not.toHaveBeenCalled();
 mocks.headers.mockResolvedValue(new Headers({host:'127.0.0.1:3391',origin:'http://127.0.0.1:3391'}));
 await openAgentConfigDirectoryAction({client:'../../secret'} as never);expect(mocks.openConfigFolder).not.toHaveBeenCalled();
});

it("records the model access check without changing the key or catalog", async () => {
  mocks.readKey.mockResolvedValueOnce("stored-private-key");
  mocks.discover.mockResolvedValueOnce(Array.from({ length: 12 }, (_, index) => ({ id: `gpt-image-${index}` })));
  const result = await testConnectionAction({ provider: "openai" });
  expect(result?.data).toEqual({ models: 12 });
  expect(mocks.readKey).toHaveBeenCalledWith(expect.anything(), "openai");
  expect(mocks.discover).toHaveBeenCalledWith("openai", "stored-private-key");
  expect(JSON.stringify(result)).not.toContain("stored-private-key");
  expect(mocks.saveKey).not.toHaveBeenCalled();
  expect(mocks.put).toHaveBeenCalledExactlyOnceWith("connection-checks","openai",{checkedAt:expect.any(String)});
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
it("reports a provider rejection of the stored key as one sentence", async () => {
  mocks.readKey.mockResolvedValueOnce("stored-private-key");
  mocks.discover.mockRejectedValueOnce(new UserFacingError("The provider rejected this API key (401). Check the key and try again."));
  const result = await testConnectionAction({ provider: "openai" });
  expect(result?.serverError).toBe("The provider rejected this API key (401). Check the key and try again.");
  expect(JSON.stringify(result)).not.toContain("stored-private-key");
  expect(mocks.put).not.toHaveBeenCalled();
});
it("hides unexpected provider failures and reports an empty catalog", async () => {
  mocks.discover.mockRejectedValueOnce(new Error("Authorization: Bearer fixture-key"));
  const failed = await testConnectionAction({ provider: "openai" });
  expect(failed?.serverError).toBe("The operation could not be completed. Try again.");
  expect(JSON.stringify(failed)).not.toContain("fixture-key");
  mocks.discover.mockResolvedValueOnce([]);
  expect((await testConnectionAction({ provider: "openai" }))?.serverError)
    .toBe("The provider answered, but no supported image models are available for this key.");
});
it("asks to connect first when no key is stored, without calling the provider", async () => {
  mocks.readKey.mockRejectedValueOnce(new UserFacingError("Connect this provider in Settings first"));
  const result = await testConnectionAction({ provider: "openai" });
  expect(result?.serverError).toBe("Connect this provider in Settings first");
  expect(mocks.discover).not.toHaveBeenCalled();
});
it("applies the release and access checks to connection tests", async () => {
  expect((await testConnectionAction({ provider: "google" }))?.serverError).toBe("Version 0.1.0 supports OpenAI only.");
  mocks.headers.mockResolvedValueOnce(new Headers({ host: "foreign.example", origin: "http://foreign.example" }));
  expect((await testConnectionAction({ provider: "openai" }))?.serverError).toBe("Access denied");
  expect(mocks.readKey).not.toHaveBeenCalled();
  expect(mocks.discover).not.toHaveBeenCalled();
});
