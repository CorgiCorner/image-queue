import { UserFacingError } from "./user-facing-error";
import { recoverMetadata, writeMetadata, type RecordWrite } from "./metadata-operation";
import type { Storage } from "../storage/types";
import { idSchema, type Job } from "./schema";
export async function joinStack(
  store: Storage,
  parentId: string,
  versionId: string,
  sameLocation = false,
) {
  idSchema.parse(parentId);
  idSchema.parse(versionId);
  return store.lock("stacks", async () => {
    await recoverMetadata(store);
    const parent = await store.get<Job>("jobs", parentId);
    const version = await store.get<Job>("jobs", versionId);
    if (!parent || !version || parentId === versionId)
      throw new UserFacingError("Select two different images");
    if (sameLocation && (parent.archivedAt || parent.trashedAt || version.archivedAt || version.trashedAt || parent.status !== "done" || version.status !== "done"))
      throw new UserFacingError("Select completed images outside Archive and Trash");
    if (sameLocation && (parent.projectId !== version.projectId || parent.topicId !== version.topicId))
      throw new UserFacingError("Select an image from the same project and topic");
    const allJobs = await store.list<Job>("jobs");
    let ancestor: Job | undefined = parent;
    const visited = new Set<string>();
    while (ancestor) {
      if (ancestor.id === version.id || visited.has(ancestor.id))
        throw new UserFacingError("Version ancestry cannot contain a cycle");
      visited.add(ancestor.id);
      ancestor = allJobs.find((job) => job.id === ancestor?.parentVersionId);
    }
    const stackId = parent.stackId ?? crypto.randomUUID();
    if (version.stackId && version.stackId !== stackId)
      throw new UserFacingError("Version already belongs to another stack");
    const members = allJobs.filter(job => job.stackId === stackId || job.id === parent.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const counter = await store.get<{ lastVersion: number }>("stack-counters", stackId);
    const usedNumbers = new Set(members.flatMap(job => job.versionNumber === undefined ? [] : [job.versionNumber]));
    let lastVersion = Math.max(counter?.lastVersion ?? 0, 0, ...usedNumbers);
    const writes: RecordWrite[] = [];
    let candidate = counter ? lastVersion + 1 : 1;
    for (const member of members) {
      if (member.versionNumber !== undefined || member.id === version.id) continue;
      while (usedNumbers.has(candidate)) candidate++;
      writes.push({ collection: "jobs", id: member.id, merge: true, value: { versionNumber: candidate } });
      usedNumbers.add(candidate);
      lastVersion = Math.max(lastVersion, candidate);
      candidate++;
    }
    const versionNumber = version.versionNumber ?? lastVersion + 1;
    writes.push({
      collection: "stack-counters", id: stackId,
      value: { id: stackId, lastVersion: Math.max(lastVersion, versionNumber) },
    });
    for (const job of allJobs)
      if (
        job.stackId === stackId &&
        job.id !== parent.id &&
        job.id !== version.id
      )
        writes.push({
          collection: "jobs",
          id: job.id,
          merge: true,
          value: { isMain: false },
        });
    writes.push({
      collection: "jobs",
      id: parent.id,
      merge: true,
      value: { stackId, isMain: false },
    });
    const updated = {
      ...version,
      versionNumber,
      stackId,
      parentVersionId: parent.id,
      projectId: parent.projectId,
      topicId: parent.topicId,
      isMain: true,
      updatedAt: new Date().toISOString(),
    };
    writes.push({
      collection: "jobs",
      id: version.id,
      merge: true,
      unset: parent.topicId ? [] : ["topicId"],
      value: {
        stackId,
        parentVersionId: parent.id,
        versionNumber,
        projectId: parent.projectId,
        topicId: parent.topicId,
        isMain: true,
        updatedAt: updated.updatedAt,
      },
    });
    await writeMetadata(store, writes);
    return updated;
  });
}
export async function mainVersion(store: Storage, id: string) {
  idSchema.parse(id);
  return store.lock("stacks", async () => {
    const selected = await store.get<Job>("jobs", id);
    if (!selected?.stackId) throw new UserFacingError("Image has no version stack");
    if (selected.archivedAt || selected.trashedAt)
      throw new UserFacingError("Restore the image before making it the main version");
    if (selected.status && selected.status !== "done")
      throw new UserFacingError("Only a completed image can be the main version");
    const writes: RecordWrite[] = (await store.list<Job>("jobs"))
      .filter((job) => job.stackId === selected.stackId)
      .map((job) => ({
        collection: "jobs",
        id: job.id,
        merge: true,
        value: {
          isMain: job.id === id,
          updatedAt: new Date().toISOString(),
        },
      }));
    await writeMetadata(store, writes);
  });
}
export function stackedImages(jobs: Job[]) {
  const groups = new Map<string, Job>();
  for (const job of jobs) {
    const key = job.stackId ?? job.id;
    const current = groups.get(key);
    if (
      !current ||
      job.isMain ||
      (!current.isMain && job.createdAt > current.createdAt)
    )
      groups.set(key, job);
  }
  return [...groups.values()];
}

export async function createIteration(
  api: import("./service").ImageService,
  input: {
    parentId: string;
    prompt: string;
    referenceId: string;
    idempotencyKey: string;
  },
) {
  idSchema.parse(input.parentId);
  idSchema.parse(input.referenceId);
  idSchema.max(96).parse(input.idempotencyKey);
  return api.store.lock(`iteration-${input.idempotencyKey}`, async () => {
    const intent = await api.store.get<typeof input>(
      "iteration-intents",
      input.idempotencyKey,
    );
    if (intent && (
      intent.parentId !== input.parentId ||
      intent.prompt !== input.prompt ||
      intent.referenceId !== input.referenceId ||
      intent.idempotencyKey !== input.idempotencyKey
    ))
      throw new UserFacingError("Iteration key belongs to another request");
    const existing = await api.store.get<Job>(
      "jobs",
      `IMG-${input.idempotencyKey}`,
    );
    if (existing && !intent)
      throw new UserFacingError("Iteration key belongs to another request");
    if (existing?.parentVersionId) {
      if (existing.parentVersionId !== input.parentId)
        throw new UserFacingError("Iteration key belongs to another parent");
      return existing;
    }
    const parent = await api.store.get<Job>("jobs", input.parentId);
    if (!parent) throw new UserFacingError("Parent image does not exist");
    if (parent.archivedAt || parent.trashedAt) throw new UserFacingError("Restore the parent image before requesting a version");
    if (!existing && parent.status !== "done") throw new UserFacingError("Wait for the parent image to finish before requesting a version");
    await api.store.put("iteration-intents", input.idempotencyKey, input);
    const job =
      existing ??
      (await api.create({
        projectId: parent.projectId,
        topicId: parent.topicId,
        prompt: input.prompt,
        source: parent.imported ? "queue" : parent.source,
        provider: parent.provider,
        model: parent.model,
        width: parent.width,
        height: parent.height,
        transparent: parent.transparent,
        referenceIds: [input.referenceId],
        idempotencyKey: input.idempotencyKey,
      }));
    return joinStack(api.store, parent.id, job.id);
  });
}
