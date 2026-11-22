import { maxBatchImages, requestsForCount } from "../core/request-count";
import { version } from "../../package.json";
import { generationPreferenceSchema, readGenerationPreference, saveGenerationPreference, type GenerationPreference } from "../core/generation-preference";
import { jobRecovery } from "../core/job-recovery";
import { applyVerifiedModelProfiles, assertModelOptions } from "../core/model-profiles";
import { modelsWithSizeProfiles } from "../core/model-catalog";
import { setTimeout as delay } from "node:timers/promises";
import { imageDetails } from "../core/image-details";
import { aspectRatios, resolveQueueSize, resolveModelSize, sizeProfileSchema } from "../core/size-intent";
import { galleryQuerySchema, queryGallery } from "../core/gallery-query";
import { visibleJobs } from "../core/retention";
import { configureAppViews, readThumbnail } from "./apps";
import { annotateTools } from "./tool-annotations";
import { protectToolErrors } from "./error-boundary";
import { changeProcessing, processingInput, failurePolicy, processingStatus } from "../core/processing";
import { UserFacingError, publicErrorMessage } from "../core/user-facing-error";
import { requireReleaseProvider } from "../core/release-providers";
import { noteInput } from "../core/notes";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { dispatch, refreshedJob, refreshedJobs, retryImageJob, service } from "../core/runtime";
import { idSchema, projectSchema, type Job, type Model, requestSchema, retryImageSchema } from "../core/schema";
import { executionStatus } from "./execution-status";
import type { Storage } from "../storage/types";

const mcpRequestSchema = requestSchema.omit({ exactDimensions: true }).extend({
  width: requestSchema.shape.width.optional(),
  height: requestSchema.shape.height.optional(),
  aspectRatio: z.enum(aspectRatios).optional(),
  source: requestSchema.shape.source.optional(),
  count: z.number().int().min(1).max(10).optional(),
});
async function normalizeRequest(raw: Omit<z.infer<typeof mcpRequestSchema>, "count">, store: Storage, preference?: GenerationPreference) {
  const existing = await store.get<Job>("jobs", `IMG-${raw.idempotencyKey}`);
  const source = raw.source ?? existing?.source ?? preference?.source ?? "queue";
  const savedModel = existing?.source === "api" ? existing.model : preference?.model;
  const input = { ...raw, source, model: raw.model || (source === "api" ? savedModel ?? "" : "") };
  if ((input.quality !== undefined || input.complexity !== undefined) && input.source !== "api")
    throw new UserFacingError("Quality and complexity apply only to API generation. Remove them or use source \"api\".");
  if ((input.outputFormat !== undefined || input.frameCount !== undefined || input.frameDurationMs !== undefined) && input.source !== "api")
    throw new UserFacingError("Output format and frame settings apply only to API generation. Remove them or use source \"api\".");
  if (input.resolution && (input.source !== "api" || input.provider !== "google"))
    throw new UserFacingError("Resolution levels require a supported Google image model");
  if (input.source === "api") {
    requireReleaseProvider(input.provider);
    if (existing?.source === input.source && existing.provider === input.provider && existing.model === input.model) {
      const target = resolveQueueSize(input);
      const size = input.width === undefined && input.aspectRatio === existing.aspectRatio
        ? existing.requestedSize ?? { width: existing.width, height: existing.height }
        : target;
      return requestSchema.parse({
        ...input,
        ...size,
        exactDimensions: input.width === undefined && existing.exactDimensions === false ? false : undefined,
      });
    }
    const models = applyVerifiedModelProfiles((await store.get<Model[]>("models", input.provider)) ?? []);
    const model = models.find(entry => entry.id === input.model);
    const profile = sizeProfileSchema.safeParse(model?.sizeProfile);
    if (!model || !profile.success) throw new UserFacingError("This model has no valid size profile. Choose another model or refresh its configuration.");
    assertModelOptions(model, input);
    return requestSchema.parse({
      ...input,
      ...resolveModelSize(profile.data, input).target,
      exactDimensions: profile.data.mode === "aspect-ratio" && input.width === undefined ? false : undefined,
    });
  }
  return requestSchema.parse({...input,...resolveQueueSize(input)});
}
async function normalizedRequests(raw: z.infer<typeof mcpRequestSchema>, store: Storage, preference?: GenerationPreference) {
  const { count, ...request } = raw;
  return Promise.all(requestsForCount(request, count ?? 1).map(item => normalizeRequest(item, store, preference)));
}

const response = async (value: unknown, store?: Storage, execution?: Awaited<ReturnType<typeof executionStatus>>) => {
  const isJob = (item: unknown): item is Job => !!item && typeof item === "object" && "source" in item && ["queue","api"].includes(String(item.source)) && "status" in item;
  const bySource = new Map<Job["source"],Promise<Awaited<ReturnType<typeof executionStatus>>>>();
  if (isJob(value) || (Array.isArray(value) && value.some(isJob))) store ??= (await service()).store;
  const withRecovery = async (item: unknown) => {
    if (!isJob(item)) return item;
    const recovery = jobRecovery(item);
    if (!bySource.has(item.source)) bySource.set(item.source,execution ? Promise.resolve(execution) : executionStatus(store!,item.source));
    const status = await bySource.get(item.source);
    if (item.source==="queue") {
      const originalPath = recovery?.action === "inspect_size_mismatch"
        ? (await store?.get<{ original?: string }>("generation-artifacts", item.id))?.original
        : undefined;
      return { ...item, execution:status, recovery: originalPath ? { ...recovery, originalPath } : recovery };
    }
    return {...item, execution:status, ...(recovery ? {recovery} : {})};
  };
  value = Array.isArray(value) ? await Promise.all(value.map(withRecovery)) : await withRecovery(value);
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
};
/**
 * appViews "negotiate" adds the MCP Apps views once the host advertises them.
 * "always" is for a stateless endpoint, where every request gets a new server
 * that never sees the host's initialize message. panelUrl is the origin a hosted
 * deployment is served from, so views link to it instead of the local default.
 */
export function createServer({ appViews = "negotiate", panelUrl }: { appViews?: "negotiate" | "always"; panelUrl?: string } = {}) {
  const server = new McpServer(
    { name: "image-queue", version },
    { capabilities: { resources: { listChanged: true } } },
  );
  protectToolErrors(server);
  annotateTools(server);
  server.registerTool("get_queue_processing", {
    description:"Read local processing state, concurrency, failure policy and last delivery separately for Codex and OpenAI API.",
  },async()=>{
    const api=await service();
    if ((await import("../core/config")).configuration("STORAGE_DRIVER")==="cloudflare") return response({mode:"hosted",nextAction:"Use job status to inspect hosted API execution."});
    const { configuredQueueRoot, pendingQueueCount } = await import("../sources/queue");
    const { waitingApiCount } = await import("../core/api-runner");
    const [state, queueWaiting, apiWaiting] = await Promise.all([
      processingStatus(api.store),
      configuredQueueRoot(api.store).then(pendingQueueCount),
      waitingApiCount(api.store),
    ]);
    return response({ ...state, queue: { ...state.queue, waiting: queueWaiting }, api: { ...state.api, waiting: apiWaiting } });
  });
  server.registerTool("set_queue_processing", {
    description:"Change local processing for both sources (all + paused), or set per-source pause, parallel workers and failure policy. limit 0 continues independent requests. Resume clears this source's stop; global resume preserves individual pauses. Resuming API permits billed pending work. Only resume at the user's direction.",
    inputSchema:{source:z.enum(["all","queue","api"]),paused:z.boolean().optional(),workers:z.number().int().min(1).max(5).optional(),policy:failurePolicy.optional()},
  },async input=>{
    const store=(await service()).store;
    await changeProcessing(store,processingInput.parse(input));
    return response(await processingStatus(store));
  });
  server.registerTool("get_generation_source",{description:"Read the saved default source and API model for new image requests, with that model's capabilities (sizes, transparency, quality and complexity values, references). Existing requests keep their source."},async()=>{
    const store=(await service()).store;
    const saved=await readGenerationPreference(store);
    const preference=saved??{source:"queue" as const};
    const model=saved?.model?applyVerifiedModelProfiles((await store.get<Model[]>("models","openai"))??[]).find(entry=>entry.id===saved.model&&entry.sizeProfile):undefined;
    return response({preference,...(model?{model}:{}),existingRequestsChanged:false});
  });
  server.registerTool("set_generation_source",{
    description:"Set the default source (queue or api) and optional configured OpenAI image model for NEW requests. This does not generate images, retry old requests, resume Codex or change existing jobs. API image requests are billed to the configured key. Use the user's chosen source; never switch it merely to bypass an error.",
    inputSchema:generationPreferenceSchema.shape,
  },async input=>response({preference:await saveGenerationPreference((await service()).store,input),existingRequestsChanged:false,generationStarted:false}));
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
        "Queue one or more images. If source is omitted, use the saved default from get_generation_source; an explicit source overrides it for this request. API calls are billed separately. For the agent queue provide aspectRatio (1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9) or exact width and height. API aspect-only requests require a verified size profile; models with a dimensions profile (GPT Image 2, 2.5 and 2.6) render each ratio natively on their pixel grid, and smaller exact sizes such as 256x256 sprites are generated at the smallest allowed size and fitted down. transparent=true needs a model with transparency and PNG or WebP output. quality (low, medium, high, xhigh, max, auto), complexity (low, medium, high; GPT Image 2.6 only) and outputFormat (png, webp, jpeg, gif, svg) are API-only and must be listed for the model by list_models. Omit outputFormat for PNG. GIF accepts frameCount (2–16) and frameDurationMs (20–2000). All GIF frames are rendered as one sheet that must fit the model limits, so 1024x1024 never works for a GIF: with GPT Image 2.6 request width and height of 960x960 or smaller for 2 to 9 frames and 816x816 for 10 to 12 frames; more than 12 frames do not fit. A GIF cannot be scaled after generation on the hosted server: for a GIF pass only aspectRatio, or a width and height the model renders natively (multiples of 16 and at least the model's minimum pixels, e.g. 608x1088 for a tall GIF of up to 12 frames; aspectRatio 9:16 alone gives 720x1280, which fits at most 9 frames). GIF output may include reference images; they guide the animation. SVG cannot include reference images or frame settings; each SVG job is a separate call. idempotencyKey must be new for every new or changed request (add a random suffix); reuse a key only to repeat exactly the same request. count (1–10) creates that many independent jobs with the same parameters. The first uses idempotencyKey and the rest use idempotencyKey-2 through idempotencyKey-N. Replaying that same key and count returns those jobs and creates nothing. count 1 or omitted returns the single job; a larger count also includes a jobs array. For a Google model that lists resolution levels, pass resolution (512, 1K, 2K or 4K) from that list. Reference inputs must be real PNG, JPEG or WebP files (maximum 20 MB each): import them with add_reference (a local path on the local server) or upload_reference (an image attached to the chat, or any image on the hosted server), then pass returned referenceIds. SVG, GIF, PDF, Markdown, URLs and renamed non-image files are not accepted; convert to PNG before importing. A Codex queue job waits for the local runner; if paused, the user must resume it in the dashboard.",
      inputSchema: mcpRequestSchema.shape,
    },
    async (input) => {
      const api = await service();
      const preference = await readGenerationPreference(api.store);
      const normalized = await normalizedRequests(input, api.store, preference);
      const jobs: Job[] = [];
      for (const request of normalized) {
        const job = await api.create(request);
        // Local API requests are durable before this call returns;
        // Cloudflare hands them to the generation queue.
        if (job.status === "queued") await dispatch(job.id);
        jobs.push((await api.store.get<Job>("jobs", job.id))!);
      }
      const [first] = jobs;
      return response((input.count ?? 1) > 1 ? { ...first, jobs } : first, api.store);
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
    "view_image",
    {
      description: "Show a 640 px preview of one finished image as image content, so the user can see the result in chat, for example in the Claude mobile app. Use after get_job or wait_for_job reports status done, or status blocked with a saved file whose size could not be adapted.",
      inputSchema: { id: idSchema },
    },
    async ({ id }) => {
      const preview = await readThumbnail(id);
      return { content: [{ type: "image" as const, data: Buffer.from(preview.bytes).toString("base64"), mimeType: preview.mime }] };
    },
  );
  server.registerTool(
    "get_job",
    {
      description: "Get job status, error, output path and execution state. A queued job may be paused or blocked: read execution.nextAction and tell the user; do not silently wait or resubmit.",
      inputSchema: { id: idSchema },
    },
    async ({ id }) =>
      response(
        (await refreshedJob(id)) ?? {
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
        (await refreshedJob(id)) ?? {
          error: "Not found",
        },
      ),
  );
  server.registerTool(
    "request_images",
    {
      description:
        "Submit image requests without opening an inline view. Omitting source uses the saved default; an explicit source overrides it per request. API calls are billed separately. Each queue request accepts aspectRatio or exact width and height. API requests also accept transparent, quality, complexity and outputFormat within the model's capabilities from list_models. GIF accepts frameCount and frameDurationMs. GIF output may include reference images; they guide the animation. SVG cannot include references or frame settings. Each request may set count (1–10) and expands into that many independent jobs. The 20-image cap counts the expanded jobs. All size and option inputs are validated before the first submission. References must be imported PNG, JPEG or WebP images (up to 20 MB each), supplied by referenceIds; no SVG, PDF, Markdown or URLs.",
      inputSchema: { requests: z.array(mcpRequestSchema).min(1).max(20) },
    },
    async ({ requests }) => {
      const api = await service();
      const jobs: (Job | {id:string;error:string})[] = [];
      const preference = await readGenerationPreference(api.store);
      const expanded = requests.flatMap(raw => {
        const { count, ...request } = raw;
        return requestsForCount(request, count ?? 1);
      });
      const normalized = await Promise.all(expanded.map(input => normalizeRequest(input, api.store, preference)));
      if (normalized.length > maxBatchImages)
        throw new UserFacingError(`A batch can include at most ${maxBatchImages} images.`);
      for (const input of normalized) {
        try {
          const job = await api.create(input);
          if (job.status === "queued") await dispatch(job.id);
          jobs.push((await api.store.get<Job>("jobs", job.id))!);
        } catch (error) {
          jobs.push({id:`IMG-${input.idempotencyKey}`,error:publicErrorMessage(error)});
        }
      }
      return response(jobs, api.store);
    },
  );
  server.registerTool(
    "wait_for_job",
    {
      description: "Wait up to 60 seconds for a terminal state. An unclaimed Codex job returns early if the queue needs user action. Inspect status, error, recovery and execution.nextAction before deciding what to do.",
      inputSchema: {
        id: idSchema,
        timeoutSeconds: z.number().min(0).max(60).default(30),
      },
    },
    async ({ id, timeoutSeconds }, { mcpReq: { signal } }) => {
      const deadline = Date.now() + timeoutSeconds * 1000;
      const api = await service();
      let job: Job | undefined;
      do {
        signal.throwIfAborted();
        job = await refreshedJob(id,api);
        if (
          !job ||
          !["queued", "running"].includes(job.status) ||
          Date.now() >= deadline
        )
          break;
        if (job.status === "queued" && !job.claim) {
          const execution = await executionStatus(api.store,job.source);
          if (execution.requiresUserAction) return response(job, api.store, execution);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await delay(Math.min(1000, remaining), undefined, { signal });
      } while (Date.now() <= deadline);
      return response(job ?? { error: "Not found" }, api.store);
    },
  );
  server.registerTool(
    "add_reference",
    {
      description:
        "Import a real PNG, JPEG (.jpg/.jpeg) or WebP file from a local path, maximum 20 MB, under configured REFERENCE_ROOTS. Works only on the local server; for an image attached to the chat or on the hosted server call upload_reference instead. Returns a reference ID for request_image/referenceIds. SVG, GIF, PDF, Markdown/text and URLs are not image references. Convert unsupported formats to PNG first; renaming an extension is not conversion.",
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
        "List the saved OpenAI image models (it does not contact OpenAI; when the user asks to refresh, reload or update the model list, call refresh_models instead) with their capabilities: sizeProfile (fixed sizes or dimension limits), references, transparency, qualities, complexities (empty when the model has no complexity setting), outputFormats (requestable on an API job; the result is stored in that format, PNG when omitted), generationVerified (false when only OpenAI documentation backs the profile) and documentedOnly (capabilities stated by OpenAI documentation that no generation receipt has confirmed yet). Capabilities are per model ID; the first listed model is the preferred default.",
    },
    async () =>
      response(modelsWithSizeProfiles(applyVerifiedModelProfiles((await (await service()).store.list<Model[]>("models")).flat())).filter(model => model.provider === "openai")),
  );
  server.registerTool(
    "refresh_models",
    {
      description:
        "Refresh (reload) the model list: rediscover the OpenAI image models available to the server's configured API key and save them, then return the usable ones (those with a verified size profile), like list_models. Use it when list_models is empty or a model the user expects is missing. It makes one model-list request to OpenAI, generates nothing and is not billed.",
    },
    async () => {
      const { refreshModelCatalog } = await import("../core/model-refresh");
      return response(await refreshModelCatalog((await service()).store, "openai"));
    },
  );
  server.registerTool(
    "retry_image",
    {
      description: "Explicitly retry a blocked queue request or a failed/blocked provider request as a separate, idempotent attempt. For an uncertain result, obtain the user's agreement to another possible charge and set acknowledgeUncertain=true. Never retry automatically.",
      inputSchema: retryImageSchema.shape,
    },
    async ({id, acknowledgeUncertain}) => {
      const job = await retryImageJob(id, acknowledgeUncertain);
      await dispatch(job.id);
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
      await dispatch(job.id);
      return response(job);
    },
  );
  configureAppViews(server, [requestTool, showJobTool], galleryTool, imageTool, appViews, panelUrl);
  return server;
}
