import { UserFacingError } from "./user-facing-error";
import { createRecordIdentity, replicaIdentityFields, replicaIdentitySchema, type ReplicaIdentity } from "./replica-identity";
import { writeMetadata, type RecordWrite } from "./metadata-operation";
import { z } from "zod";
import type { Storage } from "../storage/types";
import { idSchema, type Job, type Reference } from "./schema";
export const topicSchema = z.object({
  ...replicaIdentityFields.shape,
  id: idSchema,
  projectId: idSchema,
  name: z.string().trim().min(1).max(100),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deleted: z.boolean().optional(),
  machineId: z.string().optional(),
});
export type Topic = z.infer<typeof topicSchema>;
export type Pin = Partial<ReplicaIdentity> & {
  id: string;
  targetType: "project" | "topic";
  targetId: string;
  order: number;
  updatedAt: string;
};
export async function createTopic(
  store: Storage,
  projectId: string,
  name: string,
) {
  if (!(await store.get("projects", projectId)))
    throw new UserFacingError("Project does not exist");
  const topics = await store.list<Topic>("topics");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const identity = await createRecordIdentity(store, "topics", id);
  const topic = topicSchema.parse({
    ...identity,
    id,
    projectId,
    name,
    machineId: identity.originMachine,
    order: Math.min(0, ...topics.map((t) => t.order)) - 1,
    createdAt: now,
    updatedAt: now,
  });
  await store.put("topics", topic.id, topic);
  return topic;
}
export async function pinTarget(
  store: Storage,
  targetType: "project" | "topic",
  targetId: string,
  pinned: boolean,
) {
  const target = await store.get<{ deleted?: boolean }>(
    targetType === "project" ? "projects" : "topics",
    targetId,
  );
  if (!target || target.deleted) throw new UserFacingError("Target does not exist");
  const id = `${targetType}-${targetId}`;
  const pins = await store.list<Pin & { removed?: boolean }>("pins");
  const existing = pins.find(pin => pin.id === id);
  const identity = existing?.globalId
    ? replicaIdentitySchema.parse({globalId:existing.globalId,originMachine:existing.originMachine,createdVersion:existing.createdVersion})
    : await createRecordIdentity(store, "pins", id);
  const value = {
    ...identity,
    id,
    targetType,
    targetId,
    order:
      pins.find((pin) => pin.id === id && !pin.removed)?.order ??
      Math.min(0, ...pins.map((p) => p.order)) - 1,
    updatedAt: new Date().toISOString(),
    removed: !pinned,
  };
  await store.put("pins", id, value);
  return value;
}
export async function moveToTopic(
  store: Storage,
  ids: string[],
  topicId: string,
) {
  return store.lock("stacks", async () => {
    const topic = await store.get<Topic>("topics", topicId);
    if (!topic || topic.deleted) throw new UserFacingError("Topic does not exist");
    const all = await store.list<Job>("jobs");
    const selected = ids.map((id) => {
      const job = all.find((item) => item.id === id);
      if (!job) throw new UserFacingError("Image does not exist");
      return job;
    });
    const stackIds = new Set(
      selected.map((job) => job.stackId).filter(Boolean),
    );
    const members = all.filter(
      (job) =>
        ids.includes(job.id) || (!!job.stackId && stackIds.has(job.stackId)),
    );
    await writeMetadata(
      store,
      members.map((job) => ({
        collection: "jobs",
        id: job.id,
        merge: true,
        value: {
          projectId: topic.projectId,
          topicId,
          updatedAt: new Date().toISOString(),
        },
      })),
    );
  });
}

export async function reorderItem(
  store: Storage,
  collection: "projects" | "topics" | "pins",
  id: string,
  direction: -1 | 1,
) {
  await store.lock(`order-${collection}`, async () => {
    const items = (
      await store.list<{
        id: string;
        order?: number;
        projectId?: string;
        removed?: boolean;
      }>(collection)
    ).filter((item) => !item.removed);
    const current = items.find((item) => item.id === id);
    if (!current) throw new UserFacingError("Item does not exist");
    const siblings = items
      .filter(
        (item) =>
          collection !== "topics" || item.projectId === current.projectId,
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = siblings.findIndex((item) => item.id === id);
    const next = index + direction;
    if (next < 0 || next >= siblings.length) return;
    [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
    await writeMetadata(
      store,
      siblings.map((item, index) => ({
        collection,
        id: item.id,
        merge: true,
        value: { order: index, updatedAt: new Date().toISOString() },
      })),
    );
  });
}
export async function moveTopic(store: Storage, id: string, projectId: string) {
  if (!(await store.get("projects", projectId)))
    throw new UserFacingError("Project does not exist");
  await store.lock(`topic-${id}`, async () => {
    const topic = await store.get<Topic>("topics", id);
    if (!topic || topic.deleted) throw new UserFacingError("Topic does not exist");
    const writes: RecordWrite[] = [];
    for (const collection of ["jobs", "references"] as const) {
      const records = await store.list<
        (Job | Reference) & { topicId?: string }
      >(collection);
      for (const record of records.filter((record) => record.topicId === id))
        writes.push({
          collection,
          id: record.id,
          merge: true,
          value: { projectId, updatedAt: new Date().toISOString() },
        });
    }
    writes.push({
      collection: "topics",
      id,
      merge: true,
      value: { projectId, updatedAt: new Date().toISOString() },
    });
    await writeMetadata(store, writes);
  });
}

export async function deleteTopic(store: Storage, id: string) {
  await store.lock(`topic-${id}`, async () => {
    const topic = await store.get<Topic>("topics", id);
    if (!topic || topic.deleted) throw new UserFacingError("Topic does not exist");
    const writes: RecordWrite[] = [];
    for (const collection of ["jobs", "references"] as const) {
      for (const record of await store.list<
        (Job | Reference) & { topicId?: string }
      >(collection))
        if (record.topicId === id)
          writes.push({
            collection,
            id: record.id,
            merge: true,
            unset: ["topicId"],
            value: {
              updatedAt: new Date().toISOString(),
            },
          });
    }
    writes.push({
      collection: "topics",
      id,
      merge: true,
      value: { deleted: true, updatedAt: new Date().toISOString() },
    });
    writes.push({
      collection: "pins",
      id: `topic-${id}`,
      value: {
        id: `topic-${id}`,
        targetType: "topic",
        targetId: id,
        removed: true,
        order: 0,
        updatedAt: new Date().toISOString(),
      },
    });
    await writeMetadata(store, writes);
  });
}

export async function renameTopic(store: Storage, id: string, name: string) {
  const clean = z.string().trim().min(1).max(100).parse(name);
  await store.lock(`topic-${id}`, async () => {
    const topic = await store.get<Topic>("topics", id);
    if (!topic || topic.deleted) throw new UserFacingError("Topic does not exist");
    await store.put("topics", id, {
      ...topic,
      name: clean,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function placeBefore(
  store: Storage,
  collection: "projects" | "topics" | "pins",
  id: string,
  beforeId: string,
  afterTarget = false,
) {
  await store.lock(`order-${collection}`, async () => {
    const items = await store.list<{
      id: string;
      order?: number;
      projectId?: string;
      removed?: boolean;
      deleted?: boolean;
    }>(collection);
    const moving = items.find((item) => item.id === id);
    const target = items.find((item) => item.id === beforeId);
    if (
      !moving ||
      !target ||
      moving.removed ||
      moving.deleted ||
      target.removed ||
      target.deleted
    )
      throw new UserFacingError("Ordering target does not exist");
    if (collection === "topics" && moving.projectId !== target.projectId)
      throw new UserFacingError("Move the topic to this project before reordering");
    if (id === beforeId) return;
    const siblings = items
      .filter(
        (item) =>
          !item.removed &&
          !item.deleted &&
          item.id !== id &&
          (collection !== "topics" || item.projectId === moving.projectId),
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    siblings.splice(
      siblings.findIndex((item) => item.id === beforeId) + Number(afterTarget),
      0,
      moving,
    );
    await writeMetadata(
      store,
      siblings.map((item, order) => ({
        collection,
        id: item.id,
        merge: true,
        value: { order, updatedAt: new Date().toISOString() },
      })),
    );
  });
}
