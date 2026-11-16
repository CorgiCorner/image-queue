import { jobRecovery } from "../core/job-recovery";
import { applyVerifiedModelProfiles } from "../core/model-profiles";
import { modelsWithSizeProfiles } from "../core/model-catalog";
import { setTimeout as delay } from "node:timers/promises";
import { imageDetails } from "../core/image-details";
import { aspectRatios, resolveQueueSize, resolveModelSize, sizeProfileSchema } from "../core/size-intent";
import { galleryQuerySchema, queryGallery } from "../core/gallery-query";
import { visibleJobs } from "../core/retention";
import { configureAppViews } from "./apps";
import { protectToolErrors } from "./error-boundary";
import { UserFacingError } from "../core/user-facing-error";
import { requireReleaseProvider } from "../core/release-providers";
import { noteInput } from "../core/notes";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { enqueue, refreshedJobs, retryImageJob, service } from "../core/runtime";
import { idSchema, projectSchema, type Job, type Model, requestSchema, retryImageSchema } from "../core/schema";

const mcpRequestSchema = requestSchema.omit({ exactDimensions: true }).extend({
  width: requestSchema.shape.width.optional(),
  height: requestSchema.shape.height.optional(),
  aspectRatio: z.enum(aspectRatios).optional(),
});
async function normalizeRequest(input: z.infer<typeof mcpRequestSchema>, api: Awaited<ReturnType<typeof service>>) {
  if (input.resolution && (input.source !== "api" || input.provider !== "google"))
    throw new UserFacingError("Resolution levels require a supported Google image model");
  if (input.source === "api") {
    requireReleaseProvider(input.provider);
    const models = applyVerifiedModelProfiles((await api.store.get<Model[]>("models", input.provider)) ?? []);
    const profile = sizeProfileSchema.safeParse(models?.find(model => model.id === input.model)?.sizeProfile);
    if (!profile.success) throw new UserFacingError("This model has no valid size profile. Choose another model or refresh its configuration.");
    return requestSchema.parse({
      ...input,
      ...resolveModelSize(profile.data, input).target,
      exactDimensions: profile.data.mode === "aspect-ratio" && input.width === undefined ? false : undefined,
    });
  }
  return requestSchema.parse({...input,...resolveQueueSize(input)});
}

const response = async (value: unknown) => {
  const isQueueJob = (item: unknown): item is Job => !!item && typeof item === "object" && "source" in item && item.source === "queue" && "status" in item;
  if (isQueueJob(value) || (Array.isArray(value) && value.some(isQueueJob))) {
    const { executionStatus } = await import("./execution-status");
    const execution = await executionStatus((await service()).store);
    value = Array.isArray(value) ? value.map(item => isQueueJob(item) ? { ...item, execution, recovery: jobRecovery(item) } : item) : { ...value as Job, execution, recovery: jobRecovery(value as Job) };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
};
export function createServer() {
  const server = new McpServer(
    { name: "image-queue", version: "0.1.0" },
    { capabilities: { resources: { listChanged: true } } },
  );
  protectToolErrors(server);
  server.registerTool(
    "list_projects",
    { description: "List image projects" },
    async () => response(await (await service()).projects()),
  );
  server.registerTool(
    "create_project",
    {
      description: "Create an image project",
      inputSchema: { name: z.string().trim().min(1).max(100), directory: projectSchema.shape.directory },
    },
    async ({ name, directory }) => response(await (await service()).createProject(name, directory)),
  );
  const requestTool = server.registerTool(
    "request_image",
    {
      description:
        "Queue one image. For the agent queue provide aspectRatio (1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9) or exact width and height. API aspect-only requests require a verified size profile. For a Google model that lists resolution levels, pass resolution (512, 1K, 2K or 4K) from that list. Reuse idempotencyKey only for an identical request. Reference inputs must be real PNG, JPEG or WebP files (maximum 20 MB each): import them with add_reference, then pass returned referenceIds. SVG, GIF, PDF, Markdown, URLs and renamed non-image files are not accepted; convert to PNG before importing. A Codex queue job waits for the local runner; if paused, the user must resume it in the dashboard.",
      inputSchema: mcpRequestSchema.shape,
    },
    async (input) => {
      const api = await service();
      const job = await api.create(await normalizeRequest(input, api));
      // Keep execution in this call so a stdio exit cannot abandon API work.
      await enqueue(job.id);
      return response(await api.store.get<Job>("jobs", job.id));
    },
  );
  server.registerTool(
    "list_jobs",
    {
      description: "List jobs, optionally filtered by project",
      inputSchema: {
        projectId: idSchema.optional(),
        includeArchived: z.boolean().default(false),
        includeTrashed: z.boolean().default(false),
      },
    },
    async ({ projectId, includeArchived, includeTrashed }) =>
      response(
        (await refreshedJobs()).filter(
          (j) =>
            (!projectId || j.projectId === projectId) &&
            (includeArchived || !j.archivedAt) &&
            (includeTrashed || !j.trashedAt),
        ),
      ),
  );
  const imageTool = server.registerTool("show_image", {
    description: "Show an image with its notes and retained versions",
    inputSchema: { id: idSchema },
  }, async ({ id }) => response(await imageDetails((await service()).store, id)));
  const galleryTool = server.registerTool(
    "show_images",
    {
      description: "Browse images by project, topic, tag or phrase with pagination",
      inputSchema: galleryQuerySchema.shape,
    },
    async input => response(queryGallery(await refreshedJobs(), input)),
  );
  server.registerTool(
    "get_job",
    {
      description: "Get job status, error, output path and execution state. A queued job may be paused or blocked: read execution.nextAction and tell the user; do not silently wait or resubmit.",
      inputSchema: { id: idSchema },
    },
    async ({ id }) =>
      response(
        (await refreshedJobs()).find((j) => j.id === id) ?? {
          error: "Not found",
        },
      ),
  );
  const showJobTool = server.registerTool(
    "show_job",
    {
      description: "Show an existing image request",
      inputSchema: { id: idSchema },
    },
    async ({ id }) =>
      response(
        (await refreshedJobs()).find((job) => job.id === id) ?? {
          error: "Not found",
        },
      ),
  );
  server.registerTool(
    "request_images",
    {
      description:
        "Submit 1–20 image requests without opening an inline view. Each queue request accepts aspectRatio or exact width and height. All size inputs are validated before the first submission. References must be imported PNG, JPEG or WebP images (up to 20 MB each), supplied by referenceIds; no SVG, PDF, Markdown or URLs.",
      inputSchema: { requests: z.array(mcpRequestSchema).min(1).max(20) },
    },
    async ({ requests }) => {
      const api = await service();
      const jobs: Job[] = [];
      const normalized = await Promise.all(requests.map(input => normalizeRequest(input, api)));
      for (const input of normalized) {
        const job = await api.create(input);
        await enqueue(job.id);
        jobs.push((await api.store.get<Job>("jobs", job.id))!);
      }
      return response(jobs);
    },
  );
  server.registerTool(
    "wait_for_job",
    {
      description: "Wait up to 60 seconds for a terminal state. Always inspect status, error, recovery and execution.nextAction: paused/blocked execution requires user action, not repeated submission.",
      inputSchema: {
        id: idSchema,
        timeoutSeconds: z.number().min(0).max(60).default(30),
      },
    },
    async ({ id, timeoutSeconds }, { mcpReq: { signal } }) => {
      const deadline = Date.now() + timeoutSeconds * 1000;
      let job: Job | undefined;
      do {
        signal.throwIfAborted();
        job = (await refreshedJobs()).find((j) => j.id === id);
        if (
          !job ||
          !["queued", "running"].includes(job.status) ||
          Date.now() >= deadline
        )
          break;
        await delay(Math.min(1000, deadline - Date.now()), undefined, { signal });
      } while (Date.now() <= deadline);
      return response(job ?? { error: "Not found" });
    },
  );
  server.registerTool(
    "add_reference",
    {
      description:
        "Import a real PNG, JPEG (.jpg/.jpeg) or WebP file, maximum 20 MB, under configured REFERENCE_ROOTS. Returns a reference ID for request_image/referenceIds. SVG, GIF, PDF, Markdown/text and URLs are not image references. Convert unsupported formats to PNG first; renaming an extension is not conversion.",
      inputSchema: { projectId: idSchema, filePath: z.string().max(4096).describe("Local path to a PNG, JPEG or WebP image, up to 20 MB; must be under an allowed reference directory") },
    },
    async ({ projectId, filePath }) => {
      const { addLocalReference } = await import("../storage/local-references");
      return response(
        await addLocalReference(await service(), projectId, filePath),
      );
    },
  );
  server.registerTool(
    "list_models",
    {
      description:
        "List discovered models with configured size profiles; includes their size mode and limits",
    },
    async () =>
      response(modelsWithSizeProfiles(applyVerifiedModelProfiles((await (await service()).store.list<Model[]>("models")).flat())).filter(model => model.provider === "openai")),
  );
  server.registerTool(
    "retry_image",
    {
      description: "Explicitly retry a blocked queue request or a failed/blocked provider request as a separate, idempotent attempt. For an uncertain result, obtain the user's agreement to another possible charge and set acknowledgeUncertain=true. Never retry automatically.",
      inputSchema: retryImageSchema.shape,
    },
    async ({id, acknowledgeUncertain}) => {
      const job = await retryImageJob(id, acknowledgeUncertain);
      await enqueue(job.id);
      return response(await (await service()).store.get<Job>("jobs",job.id));
    },
  );
  server.registerTool(
    "mark_uncertain_failed",
    {
      description: "Explicitly mark an uncertain provider result as failed, without making another provider call.",
      inputSchema: { id: idSchema },
    },
    async ({id}) => response(await (await service()).markUncertainFailed(id)),
  );
  server.registerTool(
    "cancel_job",
    {
      description: "Cancel an unreserved queue job",
      inputSchema: { id: idSchema },
    },
    async ({ id }) => {
      await (await service()).cancelJob(id);
      return response({ id, status: "cancelled" });
    },
  );
  server.registerTool(
    "create_topic",
    {
      description: "Create a topic inside a project",
      inputSchema: {
        projectId: idSchema,
        name: z.string().trim().min(1).max(100),
      },
    },
    async ({ projectId, name }) =>
      response(
        await (
          await import("../core/organization")
        ).createTopic((await service()).store, projectId, name),
      ),
  );
  server.registerTool(
    "list_topics",
    { description: "List topics", inputSchema: {} },
    async () =>
      response(
        (
          await (
            await service()
          ).store.list<import("../core/organization").Topic>("topics")
        ).filter((topic) => !topic.deleted),
      ),
  );
  server.registerTool(
    "move_to_topic",
    {
      description: "Move images into a topic",
      inputSchema: {
        ids: z.array(idSchema).min(1).max(1000),
        topicId: idSchema,
      },
    },
    async ({ ids, topicId }) => {
      await (
        await import("../core/organization")
      ).moveToTopic((await service()).store, ids, topicId);
      return response({ moved: ids.length });
    },
  );
  server.registerTool(
    "tag_image",
    {
      description: "Add agent-proposed tags while preserving user tags",
      inputSchema: {
        id: idSchema,
        tags: z.array(z.string().min(1).max(60)).max(50),
      },
    },
    async ({ id, tags }) =>
      response(
        await (
          await import("../core/tags")
        ).tagImage((await service()).store, id, tags, "agent"),
      ),
  );
  server.registerTool(
    "list_untagged",
    {
      description:
        "List completed, untagged images with 640px thumbnail links for idle workers. Returns an empty batch while generation is queued or running. Recheck before each image.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        afterId: idSchema.optional(),
      },
    },
    async ({ limit, afterId }) => {
      const { untaggedImages } = await import("../core/tags");
      return response(untaggedImages(await (await service()).jobs(), limit, afterId));
    },
  );
  server.registerTool(
    "add_note",
    {
      description: "Add a whole-image or normalized point/region note",
      inputSchema: noteInput,
    },
    async (input) =>
      response(
        await (
          await import("../core/notes")
        ).addNote((await service()).store, input),
      ),
  );
  server.registerTool(
    "list_notes",
    {
      description: "List notes for an image",
      inputSchema: { imageId: idSchema },
    },
    async ({ imageId }) =>
      response(
        (
          await (
            await service()
          ).store.list<import("../core/notes").ImageNote>("notes")
        ).filter((note) => note.imageId === imageId),
      ),
  );
  server.registerTool(
    "iterate_image",
    {
      description: "Request a new version using an existing imported PNG, JPEG or WebP image reference ID, not a path, URL, SVG or document",
      inputSchema: {
        parentId: idSchema,
        prompt: z.string().trim().min(3).max(12000),
        referenceId: idSchema,
        idempotencyKey: idSchema.max(96),
      },
    },
    async (input) => {
      const job = await (
        await import("../core/stacks")
      ).createIteration(await service(), input);
      await enqueue(job.id);
      return response(job);
    },
  );
  configureAppViews(server, [requestTool, showJobTool], galleryTool, imageTool);
  return server;
}
