import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../src/core/schema";
import {
  appendQueue,
  cancelQueue,
  deleteQueueOutput,
  inspectQueue,
  parseQueue,
  prepareBlockedQueueRetry,
  queueOutput,
  queueRoot,
  readQueueDimensions,
  resolveQueueReferences,
  withQueueLock,
} from "../src/sources/queue";

let root: string;
const job = (): Job => ({
  id: "IMG-test",
  idempotencyKey: "test",
  projectId: "test",
  prompt: "A red panda\nwith a blue scarf",
  source: "queue",
  provider: "openai",
  model: "",
  width: 1,
  height: 1,
  transparent: true,
  referenceIds: [],
  createdAt: "2026-11-14T00:00:00Z",
  updatedAt: "2026-11-14T00:00:00Z",
  status: "queued",
  requestHash: "test",
});
const worker = (args: string[]) =>
  JSON.parse(
    execFileSync(
      "python3",
      ["docs/protocol/worker.py", "--root", root, ...args],
      { encoding: "utf8" },
    ),
  );
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "image-queue-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.CODEX_QUEUE_DIR;
});
describe("real worker protocol", () => {
  it("appends, reserves, publishes and finishes with the original Python worker", async () => {
    const j = job();
    j.outputPath = await appendQueue(root, j, []);
    expect(await appendQueue(root, j, [])).toBe(j.outputPath);
    const queue = await readFile(path.join(root, "images-todo.md"), "utf8");
    expect(parseQueue(queue)[0].prompt).toBe(j.prompt);
    expect(queue.split("\n")).toContain(`- Size: ${j.width}x${j.height} PNG`);
    const claim = worker(["claim", "--worker", "test-worker"]);
    expect(claim.id).toBe(j.id);
    const owned = [
      "--worker",
      "test-worker",
      "--id",
      j.id,
      "--token",
      claim.token,
    ];
    expect(worker(["check", ...owned]).state).toBe("reserved");
    expect((await inspectQueue(root, j)).claim).toMatchObject({ owner: "test-worker", reserved: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(path.join(root, "test.png"), png);
    await writeFile(
      path.join(root, "prompt.md"),
      "A red panda\nTool: fixture\n",
    );
    await writeFile(path.join(root, "receipt.json"), JSON.stringify({
      prompt: j.prompt, referencePaths: [], attachment: null,
    }));
    worker([
      "publish",
      ...owned,
      "--source",
      path.join(root, "test.png"),
      "--prompt-source",
      path.join(root, "prompt.md"),
      "--generation-receipt",
      path.join(root, "receipt.json"),
    ]);
    worker(["finish", ...owned, "--status", "done"]);
    expect(await inspectQueue(root, { ...j, width: 10, height: 20 })).toMatchObject({
      status: "done", width: 1, height: 1,
      requestedSize: { width: 10, height: 20 },
      generatedSize: { width: 1, height: 1 },
    });
    expect(await queueOutput(root, j)).toEqual(new Uint8Array(png));
  }, 15000);
  it("preserves other requests, cancels only unreserved work", async () => {
    const a = job();
    a.outputPath = await appendQueue(root, a, []);
    const b = { ...job(), id: "IMG-second" };
    await appendQueue(root, b, []);
    await cancelQueue(root, b);
    expect((await inspectQueue(root, b)).status).toBe("cancelled");
    expect((await inspectQueue(root, a)).status).toBe("queued");
    worker(["claim", "--worker", "owner"]);
    await expect(cancelQueue(root, a)).rejects.toThrow("unreserved");
  });
  it("keeps busy locks intact and rejects conflicting append", async () => {
    await withQueueLock(root, async () => {
      await expect(appendQueue(root, job(), [])).rejects.toThrow("busy");
    });
    await appendQueue(root, job(), []);
    await expect(
      appendQueue(root, { ...job(), prompt: "Different" }, []),
    ).rejects.toThrow("conflicts");
  });
  it("handles absent job, blocked status and missing ownership", async () => {
    const j = job();
    j.outputPath = await appendQueue(root, j, []);
    expect(await inspectQueue(root, { ...j, id: "IMG-missing" })).toEqual({});
    const file = path.join(root, "images-todo.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "Status: pending",
        "Status: blocked: missing reference",
      ),
    );
    expect((await inspectQueue(root, j)).error).toBe("missing reference");
    await expect(
      queueOutput(root, { ...j, outputPath: "/etc/passwd" }),
    ).rejects.toThrow("escapes");
  });
  it("uses configured root", () => {
    process.env.CODEX_QUEUE_DIR = root;
    expect(queueRoot()).toBe(root);
    delete process.env.CODEX_QUEUE_DIR;
    expect(queueRoot()).toContain("image-queue");
  });
});

it("preserves CRLF queues and rejects duplicate IDs or statuses", async () => {
  const item = job();
  await appendQueue(root, item, []);
  const file = path.join(root, "images-todo.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/\n/g, "\r\n"));
  expect(parseQueue(await readFile(file, "utf8"))[0].id).toBe(item.id);
  await cancelQueue(root, item);
  expect((await inspectQueue(root, item)).status).toBe("cancelled");
  expect(() =>
    parseQueue("## IMG-a\n- Status: pending\n## IMG-a\n- Status: done"),
  ).toThrow("duplicate");
  expect(() => parseQueue("## IMG-a\n- Prompt: Missing status")).toThrow(
    "status",
  );
});
it("propagates unreadable queues and malformed claim records", async () => {
  await mkdir(path.join(root, "images-todo.md"));
  await expect(appendQueue(root, job(), [])).rejects.toThrow();
  await rm(path.join(root, "images-todo.md"), { recursive: true });
  const item = job();
  await appendQueue(root, item, []);
  await mkdir(path.join(root, "out", ".claims"), { recursive: true });
  await writeFile(path.join(root, "out", ".claims", item.id + ".json"), "{");
  await expect(inspectQueue(root, item)).rejects.toThrow();
});
it("rejects malformed reference export identifiers", async () => {
  const {exportQueueReferences}=await import("../src/sources/queue");
  await expect(exportQueueReferences(root,"../escape",[{id:"ref",mime:"image/png",bytes:new Uint8Array([1])}])).rejects.toThrow("Invalid");
});


it("preserves legacy reference fields without assuming every reference is an image", () => {
  const queue = [
    "## IMG-legacy",
    "- Status: blocked",
    "- References: art/chest.png, art/README.md",
    "- Prompt: Render the chest",
    "## IMG-empty",
    "- Status: pending",
    "- References: none",
    "## IMG-missing",
    "- Status: blocked",
  ].join("\r\n");

  expect(parseQueue(queue).map(entry => entry.references)).toEqual([
    "art/chest.png, art/README.md",
    "none",
    undefined,
  ]);
});

it("resolves mixed legacy references and rejects symlinks escaping the allowed directory", async () => {
  const allowed = path.join(root, "art");
  await mkdir(allowed);
  await writeFile(path.join(allowed, "README.md"), "Style reference");
  await writeFile(path.join(root, "private.txt"), "Outside the reference directory");
  await symlink(path.join(root, "private.txt"), path.join(allowed, "escape.txt"));
  await expect(resolveQueueReferences("art/README.md", root, [allowed])).resolves.toEqual([
    await realpath(path.join(allowed, "README.md")),
  ]);
  await expect(resolveQueueReferences("art/escape.txt", root, [allowed])).rejects.toThrow("allowed reference directory");
  await expect(resolveQueueReferences(undefined, root, [allowed])).rejects.toThrow("no References field");
});

it("prepares a blocked legacy request from its original entry with exact dimensions", async () => {
  const reference = path.join(root, "style.md");
  await writeFile(reference, "Style notes");
  await writeFile(path.join(root, "images-todo.md"), [
    "## IMG-old", "- Status: blocked", "- Size: 1080x1920",
    "- Background: transparent", `- References: ${reference}`, "- Prompt: Match the style",
  ].join("\n"));
  await expect(prepareBlockedQueueRetry(root, "IMG-old", [root])).resolves.toEqual({
    prompt: "Match the style", width: 1080, height: 1920,
    transparent: true, references: [await realpath(reference)],
  });
  await expect(prepareBlockedQueueRetry(root, "IMG-missing", [root])).rejects.toThrow("no longer blocked");
});

it("retries queue-owned exported references outside external import roots without allowing escapes", async () => {
  const external = path.join(root, "external");
  const queue = path.join(root, "queue");
  const refs = path.join(queue, "out", "IMG-origin", "references");
  await mkdir(external);
  await mkdir(refs, { recursive: true });
  const reference = path.join(refs, "exported-ref.png");
  await writeFile(reference, "exported image bytes");
  const entry = (ref: string) => ["## IMG-retry", "- Status: blocked", "- Size: 1024x1024 PNG", `- References: ${ref}`, "- Prompt: Make the hat blue"].join("\n");
  await writeFile(path.join(queue, "images-todo.md"), entry(reference));
  expect((await prepareBlockedQueueRetry(queue, "IMG-retry", [external])).references).toEqual([await realpath(reference)]);

  const secret = path.join(root, "secret.png");
  await writeFile(secret, "private bytes");
  const escape = path.join(refs, "escape.png");
  await symlink(secret, escape);
  for (const denied of [escape, secret, path.join(queue, "out", "IMG-origin", "private.png")]) {
    await writeFile(path.join(queue, "images-todo.md"), entry(denied));
    await expect(prepareBlockedQueueRetry(queue, "IMG-retry", [external])).rejects.toThrow("allowed reference directory");
  }
});

it("has no status update when the local queue file is absent", async () => {
  await expect(inspectQueue(root, job())).resolves.toEqual({});
});

it.each([
  ["dangling comma", "art.png,", "malformed"],
  ["directory instead of a file", ".", "existing file"],
  ["missing file", "missing.png", "existing file"],
])("rejects legacy references with %s", async (_label, field, message) => {
  await expect(resolveQueueReferences(field, root, [root])).rejects.toThrow(message);
});

it("accepts explicitly empty references without opening a directory", async () => {
  await expect(resolveQueueReferences("none", root, [path.join(root, "missing")])).resolves.toEqual([]);
});

it.each([
  ["pending", "1080x1920 PNG", "no longer blocked"],
  ["blocked", "auto", "valid dimensions"],
])("rejects a %s request with Size %s during retry preparation", async (status, size, message) => {
  await writeFile(path.join(root, "images-todo.md"), [
    "## IMG-original", `- Status: ${status}`, `- Size: ${size}`,
    "- References: none", "- Prompt: Keep the original request",
  ].join("\n"));
  await expect(prepareBlockedQueueRetry(root, "IMG-original", [root])).rejects.toThrow(message);
});

it("rejects a directory at the expected PNG output path", async () => {
  const request = job();
  const outputPath = path.join(root, "out", request.id, "result.png");
  await mkdir(outputPath, { recursive: true });

  await expect(queueOutput(root, { ...request, outputPath })).rejects.toThrow("not a regular file");
});

it("preserves an external output referenced by pending work and deletes it once released", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "fixture");
  const requestsPath = path.join(root, "images-todo.md");
  const requests = await readFile(requestsPath, "utf8");
  await writeFile(requestsPath, requests.replace("- Status: pending", "- Status: done"));
  await appendQueue(root, { ...job(), id: "IMG-consumer" }, [outputPath]);

  await deleteQueueOutput(root, { ...request, outputPath });
  expect(await readFile(outputPath, "utf8")).toBe("fixture");

  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  await writeFile(queuePath, queue.replace(/(## IMG-consumer\n- Status: )pending/, "$1cancelled"));
  await deleteQueueOutput(root, { ...request, outputPath });
  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(deleteQueueOutput(root, { ...request, outputPath })).resolves.toBeUndefined();
});

it("recovers opted-in external deletion after the queue lock is released", async () => {
  const { MemoryStorage } = await import("../src/storage/memory");
  const { purgeJobs, recoverPurges } = await import("../src/core/purge");
  const store = new MemoryStorage();
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  const requestsPath = path.join(root, "images-todo.md");
  const requests = await readFile(requestsPath, "utf8");
  await writeFile(requestsPath, requests.replace("- Status: pending", "- Status: done"));
  await store.put("jobs", request.id, {
    ...request, outputPath, status: "done", trashedAt: "2026-01-01",
  });

  await withQueueLock(root, async () => {
    await expect(purgeJobs(store, [request.id], root)).rejects.toThrow("queue is busy");
  });
  expect(await readFile(outputPath, "utf8")).toBe("fixture");

  await recoverPurges(store);
  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await store.get("jobs", request.id)).toBeUndefined();
  expect(await store.get("tombstones", request.id)).toBeTruthy();
});

it("keeps an output if the queue entry is pending despite stale completed metadata", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");

  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath }))
    .rejects.toThrow("does not match the local queue entry");
  expect(await readFile(outputPath, "utf8")).toBe("fixture");
});

it("preserves both requests when concurrent writers retry after contention", async () => {
  const first = job();
  const second = { ...job(), id: "IMG-second", idempotencyKey: "second", prompt: "Another image" };
  const requests = [first, second];
  const attempts = await Promise.allSettled(requests.map(request => appendQueue(root, request, [])));
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.status === "fulfilled") continue;
    expect(attempt.reason).toEqual(new Error("Image queue is busy. Try again."));
    await appendQueue(root, requests[index], []);
  }

  const entries = parseQueue(await readFile(path.join(root, "images-todo.md"), "utf8"));
  expect(entries.map(({ id, prompt }) => ({ id, prompt }))).toEqual(
    expect.arrayContaining(requests.map(({ id, prompt }) => ({ id, prompt }))),
  );
  expect(entries).toHaveLength(2);
});

it("keeps one queue entry when concurrent submissions retry the same job", async () => {
  const request = job();
  const results = await Promise.allSettled([
    appendQueue(root, request, []),
    appendQueue(root, request, []),
  ]);
  const saved = await appendQueue(root, request, []);
  for (const result of results) {
    if (result.status === "fulfilled") expect(result.value).toBe(saved);
    else expect(result.reason).toEqual(new Error("Image queue is busy. Try again."));
  }
  const queue = await readFile(path.join(root, "images-todo.md"), "utf8");
  expect(parseQueue(queue)).toMatchObject([{ id: request.id, outputPath: saved }]);
});

it("preserves an output when a pending queue entry has no reference field", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  await appendQueue(root, { ...request, id: "IMG-consumer" }, []);
  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  const consumer = queue.indexOf("## IMG-consumer");
  expect(consumer).toBeGreaterThan(0);
  await writeFile(queuePath,
    queue.slice(0, consumer).replace("- Status: pending", "- Status: done") +
    queue.slice(consumer).replace(/^- References:.*\n/m, ""),
  );

  await deleteQueueOutput(root, { ...request, status: "done", outputPath });
  expect(await readFile(outputPath, "utf8")).toBe("fixture");
});

it("deletes the acknowledged queue output through an alias in its own directory", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  const alias = path.join(path.dirname(outputPath), "alias.png");
  await symlink(path.basename(outputPath), alias);
  const queuePath = path.join(root, "images-todo.md");
  const contents = await readFile(queuePath, "utf8");
  await writeFile(queuePath, contents.replace("- Status: pending", "- Status: done"));

  await deleteQueueOutput(root, { ...request, status: "done", outputPath: alias });
  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath: alias })).resolves.toBeUndefined();
});

it("imports the request written by the original shell producer", async () => {
  const script = path.join(root, "request.sh");
  await writeFile(path.join(root, "images-todo.md"), "");

  await writeFile(script, await readFile("docs/protocol/request.sh"));
  const outputPath = execFileSync("bash", [script, "IMG-shell", "legacy.png"], {
    encoding: "utf8",
    input: "- Size: 1080x1920 PNG\n- References: none\n- Prompt: A portrait from the shell\n",
  }).trim();

  const queue = await readFile(path.join(root, "images-todo.md"), "utf8");
  expect(parseQueue(queue)).toMatchObject([{
    id: "IMG-shell", prompt: "A portrait from the shell", outputPath,
  }]);
  expect(worker(["claim", "--worker", "test-worker"]).id).toBe("IMG-shell");
});

it("keeps both requests when the shell producer and panel share a queue", async () => {
  const script = path.join(root, "request.sh");
  const queuePath = path.join(root, "images-todo.md");
  await writeFile(script, await readFile("docs/protocol/request.sh"));
  const reserved = { ...job(), id: "IMG-reserved" };
  await appendQueue(root, reserved, []);
  const claim = worker(["claim", "--worker", "test-worker"]);
  const shellRequest = new Promise<void>((resolve, reject) => {
    const child = execFile("bash", [script, "IMG-shell", "legacy.png"], (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin!.end("- Size: 1080x1920 PNG\n- References: none\n- Prompt: Shell request\n");
  });
  const request = job();
  const [panelResult] = await Promise.allSettled([appendQueue(root, request, []), shellRequest]);
  await shellRequest;
  if (panelResult.status === "rejected") {
    expect(panelResult.reason).toEqual(new Error("Image queue is busy. Try again."));
    await appendQueue(root, request, []);
  }

  const entries = parseQueue(await readFile(queuePath, "utf8"));
  expect(entries.map(({ id, prompt }) => ({ id, prompt }))).toEqual(expect.arrayContaining([
    { id: request.id, prompt: request.prompt },
    { id: "IMG-shell", prompt: "Shell request" },
  ]));
  expect(entries).toHaveLength(3);
  expect(entries[0]).toMatchObject({ id: reserved.id, prompt: reserved.prompt });
  expect(worker(["check", "--worker", "test-worker", "--id", reserved.id, "--token", claim.token]).state).toBe("reserved");
});

it("rejects a directory named like the queue output", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await mkdir(outputPath);
  const sentinel = path.join(outputPath, "keep.txt");
  await writeFile(sentinel, "fixture");

  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath }))
    .rejects.toThrow("Queue output is not a regular file");
  expect(await readFile(sentinel, "utf8")).toBe("fixture");
});

it.each(["none", "missing.png"])("removes an output when a pending entry references %s", async (reference) => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  await appendQueue(root, { ...request, id: "IMG-consumer" }, []);
  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  const consumer = queue.indexOf("## IMG-consumer");
  await writeFile(queuePath,
    queue.slice(0, consumer).replace("- Status: pending", "- Status: done") +
    queue.slice(consumer).replace(/^- References:.*\n/m, `- References: ${reference}\n`),
  );

  await deleteQueueOutput(root, { ...request, status: "done", outputPath });
  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves an output when a pending reference cannot be resolved due to a symlink loop", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  await appendQueue(root, { ...request, id: "IMG-consumer" }, []);
  const reference = path.join(root, "loop.png");
  await symlink("loop.png", reference);
  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  const consumer = queue.indexOf("## IMG-consumer");
  await writeFile(queuePath,
    queue.slice(0, consumer).replace("- Status: pending", "- Status: done") +
    queue.slice(consumer).replace(/^- References:.*\n/m, `- References: ${reference}\n`),
  );

  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath }))
    .rejects.toMatchObject({ code: "ELOOP" });
  expect(await readFile(outputPath, "utf8")).toBe("fixture");
});

it("preserves a different PNG in the completed job's output folder", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  const otherPath = path.join(path.dirname(outputPath), "different.png");
  await writeFile(outputPath, "acknowledged");
  await writeFile(otherPath, "keep");
  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  await writeFile(queuePath, queue.replace("- Status: pending", "- Status: done"));

  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath: otherPath }))
    .rejects.toThrow("External output does not match the local queue entry");
  expect(await readFile(otherPath, "utf8")).toBe("keep");
  expect(await readFile(outputPath, "utf8")).toBe("acknowledged");
});

it.skipIf(process.getuid?.() === 0)("propagates lock creation permission errors", async () => {
  const lockedRoot = path.join(root, "read-only");
  await mkdir(lockedRoot, { mode: 0o500 });
  try {
    await expect(withQueueLock(lockedRoot, async () => {
      throw new Error("Queue work must not run");
    })).rejects.toMatchObject({ code: "EACCES" });
  } finally {
    await chmod(lockedRoot, 0o700);
  }
});

it("preserves an output if deletion is requested through an alias outside its directory", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  await writeFile(outputPath, "fixture");
  const queuePath = path.join(root, "images-todo.md");
  const queue = await readFile(queuePath, "utf8");
  await writeFile(queuePath, queue.replace("- Status: pending", "- Status: done"));
  const externalAlias = path.join(root, "external.png");
  await symlink(outputPath, externalAlias);

  await expect(deleteQueueOutput(root, { ...request, status: "done", outputPath: externalAlias }))
    .rejects.toThrow("External output does not match the local queue file");
  expect(await readFile(outputPath, "utf8")).toBe("fixture");
});

it("ignores dimensions of a GIF stored under a PNG output name", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  await writeFile(outputPath, gif);

  await expect(readQueueDimensions(root, { ...request, outputPath })).resolves.toBeUndefined();
});

it.each([0, 1])("ignores a PNG with a zero dimension at axis %s", async (axis) => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  const header = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(header);
  header.writeUInt32BE(axis === 0 ? 0 : 256, 16);
  header.writeUInt32BE(axis === 1 ? 0 : 256, 20);
  await writeFile(outputPath, header);

  await expect(readQueueDimensions(root, { ...request, outputPath })).resolves.toBeUndefined();
});

it("observes a worker reservation without rewriting the pending queue entry", async () => {
  const request = job();
  const outputPath = await appendQueue(root, request, []);
  const queuePath = path.join(root, "images-todo.md");
  const pending = await readFile(queuePath, "utf8");
  const claims = path.join(root, "out", ".claims");
  await mkdir(claims, { recursive: true });
  const timestamp = "2026-11-15T07:00:00Z";
  await writeFile(path.join(claims, `${request.id}.json`), JSON.stringify({
    worker: "test-worker",
    claimed_at_utc: timestamp,
    state: "reserved",
  }));

  await expect(inspectQueue(root, { ...request, outputPath })).resolves.toMatchObject({
    status: "running",
    claim: { owner: "test-worker", since: timestamp, reserved: true },
  });
  expect(await readFile(queuePath, "utf8")).toBe(pending);
});

it("reads an explicitly retried reservation without modifying its original entry", async () => {
 const text=["## IMG-reserved", "- Status: in-progress", "- Size: 1024x1024 PNG", "- Background: opaque", "- References: none", "- Prompt: A square"].join("\n");
 await writeFile(path.join(root,"images-todo.md"),text);
 await expect(prepareBlockedQueueRetry(root,"IMG-reserved",[root])).rejects.toThrow();
 expect((await prepareBlockedQueueRetry(root,"IMG-reserved",[root],true)).prompt).toBe("A square");
 expect(await readFile(path.join(root,"images-todo.md"),"utf8")).toBe(text);
});
