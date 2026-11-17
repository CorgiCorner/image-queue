import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { UserFacingError } from "../core/user-facing-error";
import { configuration } from "@/core/config";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  lstat,
  link,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Job } from "../core/schema";
export function queueBlockReason(status: string) {
  return status.match(/^blocked:?\s*(.*)$/)?.[1]?.trim() || undefined;
}

export function parseQueue(text: string) {
  const headings = [...text.matchAll(/^## (IMG-[A-Za-z0-9-]+)\r?$/gm)];
  const ids = new Set<string>();
  return headings.map((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    const statuses = [...body.matchAll(/^- Status: ([^\r\n]+)/gm)];
    const id = heading[1];
    if (ids.has(id) || statuses.length !== 1)
      throw new UserFacingError("Queue contains duplicate IDs or invalid status fields");
    ids.add(id);
    const field = (name: string) =>
      body
        .match(new RegExp(`^- ${name}: (.*(?:\\n(?!- |## ).*)*)`, "m"))?.[1]
        ?.trim() ?? "";
    return {
      id,
      status: statuses[0][1],
      prompt: field("Prompt"),
      outputPath: field("Save to"),
      references: /^- References:[ \t]*([^\r\n]*)/m.exec(body)?.[1].trim(),
      body,
      start,
      end,
    };
  });
}
export async function resolveQueueReferences(
  field: string | undefined,
  repository: string,
  allowedDirectories: string[],
  managedQueueRoot?: string,
): Promise<string[]> {
  if (field === "none") return [];
  if (!field) throw new UserFacingError("The original queue entry has no References field");
  const entries = field.split(",").map(value => value.trim());
  if (entries.some(value => !value || /[\r\n\0]/.test(value)))
    throw new UserFacingError("The original References field is malformed");

  const roots = await Promise.all(allowedDirectories.map(directory => realpath(directory)));
  const queueOutputs = managedQueueRoot
    ? path.join(await realpath(managedQueueRoot), "out")
    : undefined;
  return Promise.all(entries.map(async (entry, index) => {
    try {
      const file = await realpath(path.resolve(repository, entry));
      const permitted = roots.some(root => {
        const relative = path.relative(root, file);
        return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      });
      // Exported attachments are owned by the configured queue, independently
      // of folders from which the user permits importing external references.
      // Check the canonical path so a symlink cannot turn this into arbitrary access.
      const managed = queueOutputs && /^IMG-[A-Za-z0-9-]+\/references\/[A-Za-z0-9-]+\.(?:png|jpg|webp)$/.test(
        path.relative(queueOutputs, file).split(path.sep).join("/"),
      );
      if ((!permitted && !managed) || /[,\r\n]/.test(file) || !(await stat(file)).isFile())
        throw new Error();
      return file;
    } catch {
      throw new UserFacingError(`Reference ${index + 1} must be an existing file inside an allowed reference directory`);
    }
  }));
}

export async function prepareBlockedQueueRetry(
  root: string,
  id: string,
  allowedDirectories: string[],
  allowReserved = false,
) {
  const queue = await readFile(path.join(root, "images-todo.md"), "utf8");
  const entry = parseQueue(queue).find(row => row.id === id);
  if (!entry || (!/^blocked(?:$|[ (:-])/.test(entry.status) && !(allowReserved && entry.status === "in-progress")))
    throw new UserFacingError("The original request is no longer blocked");
  const dimensions = /^- Size: (\d+)[x×](\d+)(?: PNG)?\r?$/m.exec(entry.body);
  if (!dimensions || !entry.prompt)
    throw new UserFacingError("The original request is missing a prompt or valid dimensions");
  return {
    prompt: entry.prompt,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    transparent: /^- Background: transparent\r?$/m.test(entry.body),
    references: await resolveQueueReferences(entry.references, path.dirname(path.resolve(root)), allowedDirectories, root),
  };
}

export function queueRoot() {
  return (
    configuration("QUEUE_DIR", "CODEX_QUEUE_DIR") ??
    path.join(process.cwd(), "image-queue")
  );
}
export async function configuredQueueRoot(existingStore?: import("../storage/types").Storage) {
  const store = existingStore ?? await (await import("../storage")).storage();
  const saved = await store.get<{ queueDirectory: string }>(
    "settings",
    "paths",
  );
  return saved?.queueDirectory ?? queueRoot();
}
const currentLocks = new AsyncLocalStorage<ReadonlySet<string>>();
export async function withQueueLock<T>(root: string, work: () => Promise<T>) {
  await mkdir(root, { recursive: true });
  const canonicalRoot=await realpath(root);
  const held=currentLocks.getStore();
  if(held?.has(canonicalRoot))throw new UserFacingError("Image queue is busy. Try again.");
  const marker = path.join(root, ".queue.lock");
  const kernel = path.join(root, ".queue.kernel");
  const handle = await open(kernel, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const deadline = Date.now() + 10000;
  async function wait() {
    if (Date.now() >= deadline) throw new UserFacingError("Image queue is busy. Try again.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try {
    const { default: native } = await import("fs-native-extensions");
    while (!native.tryLock(handle.fd)) await wait();
    const identity = await handle.stat();
    for (;;) {
      try { await link(kernel, marker); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = await lstat(marker).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        });
        if (!owner) continue;
        if (owner.dev === identity.dev && owner.ino === identity.ino) break;
        // A legacy writer uses mkdir, which has no verifiable ownership.
        await wait();
      }
    }
    try { return await currentLocks.run(new Set([...(held??[]),canonicalRoot]),work); }
    finally { await unlink(marker); }
  } finally { await handle.close(); }
}
export async function appendQueue(
  root: string,
  job: Job,
  references: string[],
) {
  return withQueueLock(root, async () => {
    const queueFile = path.join(root, "images-todo.md");
    let text = "";
    try {
      text = await readFile(queueFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const outputPath = path.join(
      path.resolve(root),
      "out",
      job.id,
      "image.png",
    );
    const existing = parseQueue(text).find((j) => j.id === job.id);
    if (existing) {
      if (existing.outputPath !== outputPath || existing.prompt !== job.prompt)
        throw new UserFacingError("Queue request conflicts with existing job");
      return outputPath;
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    const entry = `\n## ${job.id}\n- Status: pending\n- Filed: ${job.createdAt}\n- Save to: ${outputPath}\n- Requested: by image-queue\n- Size: ${job.width}x${job.height} PNG\n- Background: ${job.transparent ? "transparent" : "opaque"}\n- References: ${references.join(", ") || "none"}\n- Prompt: ${job.prompt}\n`;
    const temp = `${queueFile}.${crypto.randomUUID()}.partial`;
    await writeFile(temp, text + entry, { mode: 0o600, flag: "wx" });
    await rename(temp, queueFile);
    return outputPath;
  });
}
// Atomic protocol writes replace the inode. Legacy appends change size/mtime.
let inspectionCache: { root:string; version:string; pending:number; entries:Map<string,ReturnType<typeof parseQueue>[number]> } | undefined;
async function queueIndex(root: string) {
  const file=path.join(root,"images-todo.md");
  const handle=await open(file,"r").catch((error:NodeJS.ErrnoException)=>{
    if(error.code!=="ENOENT")throw error;
  });
  if (!handle) return;
  try {
    const stat=await handle.stat({bigint:true});
    const version=`${stat.dev}-${stat.ino}-${stat.size}-${stat.mtimeNs}`;
    if(inspectionCache?.root!==root || inspectionCache.version!==version){
      const text=await handle.readFile("utf8");
      const parsed = parseQueue(text);
      inspectionCache = {
        root, version,
        pending: parsed.reduce((n, entry) => n + Number(entry.status === "pending"), 0),
        entries: new Map(parsed.map(entry => [entry.id, entry])),
      };
    }
    return inspectionCache;
  } finally { await handle.close(); }
}

export async function pendingQueueCount(root: string) {
  return (await queueIndex(root))?.pending ?? 0;
}

export async function queueInspector(root: string) {
  const index = await queueIndex(root);
  return (job: Job) => inspectQueueEntry(root, job, index?.entries.get(job.id));
}

export async function inspectQueue(root: string, job: Job): Promise<Partial<Job>> {
  return (await queueInspector(root))(job);
}

async function inspectQueueEntry(
  root: string,
  job: Job,
  entry: ReturnType<typeof parseQueue>[number] | undefined,
): Promise<Partial<Job>> {
  if (!entry) return {};
  let claim: Job["claim"];
  try {
    const saved = JSON.parse(
      await readFile(
        path.join(root, "out", ".claims", `${job.id}.json`),
        "utf8",
      ),
    );
    claim = {
      owner: saved.worker,
      since: saved.claimed_at_utc,
      ...(saved.state === "reserved" ? { reserved: true as const } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const status =
    entry.status === "pending"
      ? claim
        ? "running"
        : "queued"
      : entry.status === "in-progress"
        ? "running"
        : entry.status.startsWith("blocked")
          ? "blocked"
          : (entry.status as Job["status"]);
  const dimensions = status === "done"
    ? await readQueueDimensions(root, { ...job, outputPath: entry.outputPath })
    : undefined;
  return {
    ...dimensions,
    status,
    claim,
    error: queueBlockReason(entry.status),
    outputPath: entry.outputPath,
  };
}
export async function readQueueDimensions(root: string, job: Job) {
  if (!job.outputPath) return;
  try {
    const file = await open(await queueOutputPath(root, job), "r");
    const header = new Uint8Array(33);
    let bytes: Uint8Array;
    try {
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      bytes = header.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
    const { imageSize } = await import("image-size");
    const { width, height, type } = imageSize(bytes);
    if (type !== "png" || !width || !height) return;
    return {
      width,
      height,
      requestedSize: job.requestedSize ?? { width: job.width, height: job.height },
      generatedSize: { width, height },
    };
  } catch {
    // Unavailable output does not prevent loading the rest of the queue.
  }
}

export async function queueOutputPath(root: string, job: Job) {
  const expected = path.join(await realpath(root), "out", job.id);
  const target = await realpath(job.outputPath!);
  if (path.dirname(target) !== expected || path.extname(target) !== ".png")
    throw new UserFacingError("Output path escapes job directory");
  if (!(await stat(target)).isFile()) throw new UserFacingError("Queue output is not a regular file");
  return target;
}
export async function deleteQueueOutput(root: string, job: Job) {
  await withQueueLock(root, async () => {
    let target: string;
    try {
      target = await queueOutputPath(root, job);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (path.resolve(job.outputPath!) !== target && await realpath(path.dirname(job.outputPath!)) !== path.dirname(target))
      throw new UserFacingError("External output does not match the local queue file");
    const entries = parseQueue(await readFile(path.join(root, "images-todo.md"), "utf8"));
    const ownEntry = entries.find(entry => entry.id === job.id);
    if (ownEntry?.status !== "done" || !ownEntry.outputPath || await realpath(/* turbopackIgnore: true */ path.resolve(root, "..", ownEntry.outputPath)) !== target)
      throw new UserFacingError("External output does not match the local queue entry");
    for (const entry of entries) {
      if (entry.id === job.id || /^(done|cancelled)(?:$|[ (:-])/.test(entry.status)) continue;
      if (!entry.references) return;
      if (entry.references === "none") continue;
      for (const reference of entry.references.split(",")) {
        try {
          if (await realpath(/* turbopackIgnore: true */ path.resolve(root, "..", reference.trim())) === target) return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    await unlink(target);
  });
}

export async function queueOutput(root: string, job: Job) {
  return new Uint8Array(await readFile(await queueOutputPath(root, job)));
}
export async function cancelQueue(root: string, job: Job) {
  await withQueueLock(root, async () => {
    const file = path.join(root, "images-todo.md");
    const text = await readFile(file, "utf8");
    const current = await inspectQueue(root, job);
    if (current.status !== "queued" || current.claim)
      throw new UserFacingError("Only unreserved jobs can be cancelled");
    const entry = parseQueue(text).find((entry) => entry.id === job.id)!;
    const { start, end } = entry;
    const body = entry.body.replace(
      /^- Status: pending(\r?)$/m,
      "- Status: cancelled$1",
    );
    const temp = `${file}.${crypto.randomUUID()}.partial`;
    await writeFile(temp, text.slice(0, start) + body + text.slice(end), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, file);
  });
}

export async function exportQueueReferences(
  root: string,
  jobId: string,
  references: { id: string; mime: string; bytes: Uint8Array }[],
) {
  const directory = path.join(root, "out", jobId, "references");
  const files: string[] = [];
  for (const reference of references) {
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[reference.mime];
    if (
      !extension ||
      !/^[A-Za-z0-9-]+$/.test(reference.id) ||
      !/^IMG-[A-Za-z0-9-]+$/.test(jobId)
    )
      throw new UserFacingError("Invalid queue reference");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${reference.id}.${extension}`);
    const temporary = `${file}.${crypto.randomUUID()}.partial`;
    await writeFile(temporary, reference.bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
    files.push(file);
  }
  return files;
}

export async function readQueueSnapshot(root: string) {
  try {
    return { text: await readFile(path.join(root, "images-todo.md"), "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
