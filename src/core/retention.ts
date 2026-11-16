import { UserFacingError } from "./user-facing-error";
import { z } from "zod";
import type { Storage } from "../storage/types";
import { idSchema, type Job } from "./schema";
import { writeMetadata } from "./metadata-operation";

export const retentionInput = z.object({
  ids: z.array(idSchema).min(1).max(1000),
  operation: z.enum(["archive", "trash", "restore"]),
  includeStack: z.boolean().default(true),
});

export async function changeRetention(
  store: Storage,
  input: z.input<typeof retentionInput>,
) {
  const parsed = retentionInput.parse(input);
  return store.lock("stacks", async () => {
    const jobs = await store.list<Job>("jobs");
    const ids = new Set(parsed.ids);
    if ([...ids].some((id) => !jobs.some((job) => job.id === id)))
      throw new UserFacingError(
        "Selected image no longer exists. Refresh and try again.");
    const stacks = new Set(
      jobs
        .filter((job) => ids.has(job.id))
        .map((job) => job.stackId)
        .filter(Boolean),
    );
    const selected = jobs.filter(
      (job) =>
        ids.has(job.id) ||
        (parsed.includeStack && job.stackId && stacks.has(job.stackId)),
    );
    const eligible = selected.filter(
      (job) => !["queued", "running"].includes(job.status),
    );
    const now = new Date().toISOString();
    const destinations = new Map<
      string,
      { projectId: string; topicId?: string }
    >();
    if (parsed.operation === "restore") {
      for (const job of eligible) {
        const project = job.projectId
          ? await store.get("projects", job.projectId)
          : undefined;
        const topic = job.topicId
          ? await store.get<{ deleted?: boolean }>("topics", job.topicId)
          : undefined;
        destinations.set(job.id, {
          projectId: project ? job.projectId : "inbox",
          topicId: project && topic && !topic.deleted ? job.topicId : undefined,
        });
      }
      if (
        [...destinations.values()].some((item) => item.projectId === "inbox") &&
        !(await store.get("projects", "inbox"))
      )
        await store.put("projects", "inbox", {
          id: "inbox",
          name: "Inbox",
          createdAt: now,
        });
    }
    const undoId = crypto.randomUUID();
    const undo = {
      id: undoId,
      records: eligible.map((job) => ({
        id: job.id,
        archivedAt: job.archivedAt,
        trashedAt: job.trashedAt,
        retentionRevision: job.retentionRevision,
        ...(parsed.operation === "restore"
          ? {
              projectId: job.projectId,
              topicId: job.topicId,
              expectedDestination: destinations.get(job.id),
            }
          : {}),
      })),
    };
    await writeMetadata(
      store,
      [
        ...eligible.map((job) => ({
          collection: "jobs",
          id: job.id,
          merge: true,
          value: {
            updatedAt: now,
            retentionRevision: undoId,
            ...destinations.get(job.id),
            ...(parsed.operation === "archive"
              ? { archivedAt: job.archivedAt ?? now }
              : parsed.operation === "trash"
              ? { trashedAt: job.trashedAt ?? now }
              : {}),
          },
          unset:
            parsed.operation === "restore"
              ? [
                  "archivedAt",
                  "trashedAt",
                  ...(destinations.get(job.id)?.topicId ? [] : ["topicId"]),
                ]
              : [],
        })),
        { collection: "retention-undo", id: undoId, value: undo },
      ],
      async () => {
        for (const job of eligible) {
          const current = await store.get<Job>("jobs", job.id);
          if (!current || ["queued", "running"].includes(current.status))
            throw new UserFacingError("Request state changed. Refresh and try again.");
        }
      },
    );
    return {
      undoId,
      changed: eligible.map((job) => job.id),
      skipped: selected
        .filter((job) => !eligible.includes(job))
        .map((job) => job.id),
    };
  });
}

export function visibleJobs(
  jobs: Job[],
  view: "active" | "archive" | "trash" = "active",
) {
  return jobs.filter((job) =>
    view === "trash"
      ? Boolean(job.trashedAt)
      : view === "archive"
      ? Boolean(job.archivedAt) && !job.trashedAt
      : !job.archivedAt && !job.trashedAt,
  );
}

export async function undoRetention(store: Storage, undoId: string) {
  idSchema.parse(undoId);
  return store.lock("stacks", async () => {
    const undo = await store.get<{
      records: {
        id: string;
        archivedAt?: string;
        trashedAt?: string;
        retentionRevision?: string;
        projectId?: string;
        topicId?: string;
        expectedDestination?: { projectId: string; topicId?: string };
      }[];
      applied?: boolean;
    }>("retention-undo", undoId);
    if (!undo) throw new UserFacingError("Undo operation is unavailable");
    if (undo.applied) return;
    await writeMetadata(
      store,
      [
        ...undo.records.map((record) => ({
          collection: "jobs",
          id: record.id,
          merge: true,
          value: {
            ...(record.retentionRevision
              ? { retentionRevision: record.retentionRevision }
              : {}),
            ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
            ...(record.trashedAt ? { trashedAt: record.trashedAt } : {}),
            ...(record.expectedDestination
              ? { projectId: record.projectId, topicId: record.topicId }
              : {}),
            updatedAt: new Date().toISOString(),
          },
          unset: [
            ...(!record.archivedAt ? ["archivedAt"] : []),
            ...(!record.trashedAt ? ["trashedAt"] : []),
            ...(!record.retentionRevision ? ["retentionRevision"] : []),
            ...(record.expectedDestination && !record.topicId
              ? ["topicId"]
              : []),
          ],
        })),
        {
          collection: "retention-undo",
          id: undoId,
          value: { ...undo, applied: true },
        },
      ],
      async () => {
        for (const record of undo.records) {
          const current = await store.get<Job>("jobs", record.id);
          if (
            !current ||
            current.retentionRevision !== undoId ||
            (record.expectedDestination &&
              (current.projectId !== record.expectedDestination.projectId ||
                current.topicId !== record.expectedDestination.topicId))
          )
            throw new UserFacingError("A newer change prevents this undo");
        }
      },
    );
  });
}

export function trashDaysRemaining(
  trashedAt: string,
  now = Date.now(),
  retentionDays = 30,
) {
  const timestamp = Date.parse(trashedAt);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(
    0,
    Math.ceil((timestamp + retentionDays * 86400000 - now) / 86400000),
  );
}

export function expiredTrash(jobs: Job[], now = Date.now(), retentionDays = 30) {
  if (!Number.isFinite(now) || !Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new UserFacingError("Invalid trash retention interval");
  }
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return jobs.filter(job => {
    if (!job.trashedAt || ["queued", "running"].includes(job.status)) return false;
    const trashedAt = Date.parse(job.trashedAt);
    return Number.isFinite(trashedAt) && trashedAt <= cutoff;
  });
}
