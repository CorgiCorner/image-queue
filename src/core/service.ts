import {waitForLock} from "../storage/wait-for-lock";
import { configuration } from "./config";
import { UserFacingError } from "./user-facing-error";
import { resolveModelSize, resolveQueueSize } from "./size-intent";
import { createRecordIdentity } from "./replica-identity";
import { writeMetadata } from "./metadata-operation";
import { validateReference } from "./reference-validation";
import type { Storage } from "../storage/types";
import {
  hash,
  idSchema,
  transition,
  type ImageRequest,
  type Job,
  type Model,
  type Project,
  type Reference,
  requestSchema,
  projectSchema,
} from "./schema";
export class ImageService {
  constructor(readonly store: Storage) {}
  async projects() {
    return (await this.store.list<Project>("projects")).sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }
  async moveProject(id: string, directory: string) {
    projectSchema.shape.id.parse(id);
    projectSchema.shape.directory.unwrap().parse(directory);
    if (!this.store.moveProject) throw new UserFacingError("Project folders are available in local storage");
    return this.store.moveProject(id, directory);
  }
  async createProject(name: string, directory?: string) {
    const clean = name.trim();
    if (!clean || clean.length > 100)
      throw new UserFacingError("Project name must contain 1–100 characters");
    const folder = projectSchema.shape.directory.parse(directory);
    const id = crypto.randomUUID();
    const identity = await createRecordIdentity(this.store, "projects", id);
    const project = {
      ...identity,
      directory: folder,
      id,
      name: clean,
      machineId: identity.originMachine,
      updatedAt: new Date().toISOString(),
      order:
        Math.min(
          0,
          ...(await this.store.list<Project>("projects")).map(
            (project) => project.order ?? 0,
          ),
        ) - 1,
      createdAt: new Date().toISOString(),
    };
    if (this.store.createProject) return this.store.createProject(project);
    await this.store.put("projects", project.id, project);
    return project;
  }
  async create(input: ImageRequest) {
    const parsed = requestSchema.parse(input);
    resolveQueueSize(parsed);
    if (!(await this.store.get("projects", parsed.projectId)))
      throw new UserFacingError("Project does not exist");
    if (parsed.topicId) {
      const topic = await this.store.get<{
        projectId: string;
        deleted?: boolean;
      }>("topics", parsed.topicId);
      if (!topic || topic.deleted || topic.projectId !== parsed.projectId)
        throw new UserFacingError("Topic does not belong to project");
    }
    const { idempotencyKey, ...body } = parsed;
    const requestHash = await hash(JSON.stringify(body));
    const id = `IMG-${idempotencyKey}`;
    const existingRequest = async () => {
      const existing = await this.store.get<Job>("jobs", id);
      if (existing && existing.requestHash !== requestHash)
        throw new UserFacingError("Idempotency key already belongs to a different request");
      return existing;
    };
    // An active provider call holds this record for its entire execution. A replay
    // can return its committed job immediately without waiting for generation.
    const committed=await existingRequest();
    if(committed)return committed;
    return waitForLock(this.store,id, async () => {
      const existing=await existingRequest();
      if(existing)return existing;
      if (await this.store.get("tombstones", id)) {
        throw new UserFacingError("This request was permanently deleted. Use a new idempotency key for a new request.");
      }
      for (const referenceId of parsed.referenceIds) {
        const reference = await this.store.get<Reference>(
          "references",
          referenceId,
        );
        if (reference?.kind !== "image")
          throw new UserFacingError(
            "Select image references");
      }
      if (parsed.source === "api" && !parsed.model)
        throw new UserFacingError("Choose an available image model");
      if (parsed.resolution && (parsed.source !== "api" || parsed.provider !== "google"))
        throw new UserFacingError("Resolution levels require a supported Google image model");
      if (parsed.source === "api") {
        const models = await this.store.get<Model[]>("models", parsed.provider);
        const profile = models?.find(model => model.id === parsed.model)?.sizeProfile;
        if (parsed.resolution && !profile) throw new UserFacingError("The selected model has no resolution profile");
        if (profile) resolveModelSize(profile, parsed);
      }
      const now = new Date().toISOString();
      const identity = await createRecordIdentity(this.store, "jobs", id);
      const job: Job = {
        ...identity,
        ...parsed,
        tags: parsed.tags?.map((tag) => ({
          tag,
          source: "agent" as const,
          createdAt: now,
        })),
        id,
        requestHash,
        machineId: identity.originMachine,
        createdAt: now,
        updatedAt: now,
        status: "queued",
      };
      // The job lock serializes this intent with the executor. A crash after the job
      // commit cannot strand it, even if the submitting MCP process exits immediately.
      if (job.source === "api" && configuration("STORAGE_DRIVER") !== "cloudflare")
        await this.store.put("api-pending", id, { id, createdAt: now });
      await this.store.put("jobs", id, job);
      return job;
    },10000);
  }
  async retryImage(id: string, acknowledgeUncertain = false) {
    idSchema.parse(id);
    return this.store.lock(`retry-${id}`, async () => {
      const original = await this.store.get<Job>("jobs", id);
      if (!original || original.source !== "api" || original.imported || original.archivedAt || original.trashedAt ||
          !["blocked", "failed", "uncertain"].includes(original.status))
        throw new UserFacingError("Select a failed or blocked provider request");
      if (original.status === "uncertain" && !acknowledgeUncertain)
        throw new UserFacingError("Retrying an uncertain result may be charged again. Confirm before retrying.");
      const idempotencyKey = `retry-${await hash(id)}`;
      const existing = await this.store.get<Job>("jobs", `IMG-${idempotencyKey}`);
      if (existing) return existing;
      return this.create({
        ...original,
        width: original.requestedSize?.width ?? original.width,
        height: original.requestedSize?.height ?? original.height,
        tags: original.tags?.map(item => item.tag),
        idempotencyKey,
      });
    });
  }
  async markUncertainFailed(id: string) {
    idSchema.parse(id);
    return this.store.lock(id, async () => {
      const job = await this.store.get<Job>("jobs", id);
      if (!job || job.status !== "uncertain" || job.archivedAt || job.trashedAt)
        throw new UserFacingError("Select an uncertain request");
      const failed = transition(job, "failed");
      await this.store.put("jobs", id, failed);
      return failed;
    });
  }
  async moveJob(id: string, projectId: string) {
    if (!(await this.store.get("projects", projectId)))
      throw new UserFacingError("Project does not exist");
    return this.store.lock("stacks", async () => {
      const job = await this.store.get<Job>("jobs", id);
      if (!job) throw new UserFacingError("Job does not exist");
      const members = job.stackId
        ? (await this.store.list<Job>("jobs")).filter(
            (item) => item.stackId === job.stackId,
          )
        : [job];
      await writeMetadata(
        this.store,
        members.map((member) => ({
          collection: "jobs",
          id: member.id,
          merge: true,
          unset: ["topicId"],
          value: {
            projectId,
            updatedAt: new Date().toISOString(),
          },
        })),
      );
    });
  }
  async cancelJob(id: string) {
    return this.store.lock(id, async () => {
      const job = await this.store.get<Job>("jobs", id);
      if (job?.status !== "queued")
        throw new UserFacingError("Only queued jobs can be cancelled");
      if (job.source === "queue" && job.outputPath)
        throw new UserFacingError(
          "This request is already in the worker queue. Its status is managed by the worker.");
      await this.store.put("jobs", id, {
        ...job,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      });
    });
  }
  async jobs() {
    return (await this.store.list<Job>("jobs")).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  async importImage(
    name: string,
    mime: string,
    bytes: Uint8Array,
    projectId = "inbox",
  ) {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new UserFacingError("Image must be between 1 byte and 20 MB");
    if (!mime.startsWith("image/"))
      throw new UserFacingError("Import supports images only");
    validateReference(mime, bytes);
    const digest = await hash(bytes);
    const id = `IMG-import-${digest}`;
    return this.store.lock(id, async () => {
      const existing = await this.store.get<Job>("jobs", id);
      if (existing) return { job: existing, duplicate: true };
      if (projectId === "inbox" && !(await this.store.get("projects", "inbox")))
        await this.store.put("projects", "inbox", {
          ...await createRecordIdentity(this.store, "projects", "inbox"),
          id: "inbox",
          name: "Inbox",
          createdAt: new Date().toISOString(),
        });
      if (!(await this.store.get("projects", projectId)))
        throw new UserFacingError("Project does not exist");
      const { imageSize } = await import("image-size");
      const dimensions = imageSize(bytes);
      const { hasTransparentPixels } = await import("../sources/image-opacity");
      const transparent = await hasTransparentPixels(bytes);
      const now = new Date().toISOString();
      const blobKey = `results/${digest}`;
      await this.store.putBlob(blobKey, bytes, mime);
      const identity = await createRecordIdentity(this.store, "jobs", id);
      const job: Job = {
        ...identity,
        id,
        projectId,
        idempotencyKey: `import-${digest}`,
        prompt: name.slice(0, 200) || "Imported image",
        source: "api",
        provider: "openai",
        model: "",
        width: dimensions.width!,
        height: dimensions.height!,
        transparent: transparent ?? false,
        opacityVerified: transparent !== undefined,
        referenceIds: [],
        createdAt: now,
        updatedAt: now,
        status: "done",
        requestHash: digest,
        blobKey,
        machineId: identity.originMachine,
        imported: true,
        originalName: name.slice(0, 200),
      };
      await this.store.put("jobs", id, job);
      return { job, duplicate: false };
    });
  }
  async addReference(
    projectId: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    parentId?: string,
    timestampMs?: number,
    referenceId?: string,
  ) {
    if (!(await this.store.get("projects", projectId)))
      throw new UserFacingError("Project does not exist");
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
      ].includes(mime)
    )
      throw new UserFacingError("Unsupported reference format");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new UserFacingError("Reference must be between 1 byte and 20 MB");
    validateReference(mime, bytes);
    if (
      timestampMs !== undefined &&
      (!Number.isFinite(timestampMs) || timestampMs < 0)
    )
      throw new UserFacingError("Frame timestamp must be a non-negative number");
    if (parentId && !mime.startsWith("image/"))
      throw new UserFacingError("A video frame must be an image");
    if (parentId) {
      const parent = await this.store.get<Reference>("references", parentId);
      if (!parent || parent.kind !== "video" || parent.projectId !== projectId)
        throw new UserFacingError("Frame must belong to a video in this project");
    }
    const writeReference = async () => {
      const digest = await hash(bytes);
      const blobKey = `refs/${digest}`;
      if (referenceId) {
        const existing = await this.store.get<Reference>("references", referenceId);
        if (existing) {
          if (existing.projectId !== projectId || existing.mime !== mime)
            throw new UserFacingError("Reference identifier belongs to different content");
          if (existing.blobKey !== blobKey) {
            const legacy = await this.store.getBlob(existing.blobKey);
            if (!legacy || await hash(legacy.bytes) !== digest)
              throw new UserFacingError("Reference identifier belongs to different content");
          }
          return existing;
        }
      }
      await this.store.putBlob(blobKey, bytes, mime);
      const id = referenceId ?? crypto.randomUUID();
      const identity = await createRecordIdentity(this.store, "references", id);
      const reference: Reference = {
        ...identity,
        id,
        projectId,
        machineId: identity.originMachine,
        updatedAt: new Date().toISOString(),
        name: name.slice(0, 200),
        mime,
        blobKey,
        kind: "image",
        parentId,
        timestampMs,
        createdAt: new Date().toISOString(),
      };
      await this.store.put("references", reference.id, reference);
      return reference;
    };
    if (referenceId) {
      const { idSchema } = await import("./schema");
      idSchema.parse(referenceId);
      return this.store.lock(`reference-${referenceId}`, writeReference);
    }
    return writeReference();
  }
}
