import { UserFacingError } from "../core/user-facing-error";
import { MAX_WORKERS, poolConfig, type Pulse } from "../core/pool";
import { queueWaitNotice, workerHealth } from "../core/workspace-state";
import { configuration } from "../core/config";
import { prepareCorrection } from "../core/prepare-correction";
import { imageViewHtml } from "./views/image-html";
import { imageDetails } from "../core/image-details";
import { galleryQuerySchema, queryGallery } from "../core/gallery-query";
import { galleryViewHtml } from "./views/gallery-html";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { storage } from "../storage";
import type { Job } from "../core/schema";
import { thumbnail } from "../sources/thumbnail";
import { jobViewHtml } from "./views/job-html";
import { z } from "zod";
import { idSchema } from "../core/schema";
import { refreshedJob, refreshedJobs, service, enqueue } from "../core/runtime";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import {
  getUiCapability,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

export const JOB_VIEW_URI = "ui://image-queue/job";

/** Register optional resources only after the host advertises MCP Apps. */
export function configureAppViews(server: McpServer, tools: RegisteredTool[], galleryTool?: RegisteredTool, imageTool?: RegisteredTool) {
  server.server.oninitialized = () => {
    const capability = getUiCapability(server.server.getClientCapabilities());
    if (!capability?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return;
    for (const tool of tools)
      tool.update({ _meta: { ui: { resourceUri: JOB_VIEW_URI } } });
    if (galleryTool) {
      galleryTool.update({ _meta: { ui: { resourceUri: "ui://image-queue/gallery" } } });
      server.registerTool("list_thumbnails", {
        description: "Read the next page of images for the gallery view",
        inputSchema: galleryQuerySchema.shape,
        _meta: { ui: { visibility: ["app"] } },
      }, async input => ({ content: [{ type: "text" as const, text: JSON.stringify(queryGallery(await refreshedJobs(), input)) }] }));
      registerAppResource(server, "Image gallery", "ui://image-queue/gallery", {}, async () => ({
        contents: [{ uri: "ui://image-queue/gallery", mimeType: RESOURCE_MIME_TYPE, text: galleryViewHtml,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
      }));
    }
    if (imageTool) {
      imageTool.update({ _meta: { ui: { resourceUri: "ui://image-queue/image" } } });
      registerAppResource(server, "Image notes and versions", "ui://image-queue/image", {}, async () => ({
        contents: [{ uri: "ui://image-queue/image", mimeType: RESOURCE_MIME_TYPE, text: imageViewHtml,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
      }));
    }
    server.registerTool("add_notes_to_queue", {
      description: "Create one correction from the image's unsent notes after the user clicks Add to queue",
      inputSchema: z.object({ imageId: idSchema, idempotencyKey: idSchema.max(96), instruction: z.string().trim().max(12000).optional() }),
      _meta: { ui: { visibility: ["app"] } },
    }, async input => {
      const job = await prepareCorrection(await service(), input);
      await enqueue(job.id);
      return { content: [{ type: "text" as const, text: JSON.stringify(job) }] };
    });
    server.registerTool("get_image_details", {
      description: "Read image notes and retained versions for the inline image view",
      inputSchema: z.object({ id: idSchema }),
      _meta: { ui: { visibility: ["app"] } },
    }, async ({ id }) => ({ content: [{ type: "text" as const, text: JSON.stringify(await imageDetails(await storage(), id)) }] }));
    server.registerTool(
      "get_job_state",
      {
        description: "Read current image request state for the inline view",
        inputSchema: z.object({ id: idSchema }),
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ id }) => {
        const job = await refreshedJob(id);
        let workersOffline = false;
        let queueNotice: string | undefined;
        let workerSlot: number | undefined;
        if (job?.source === "queue" && (job.status === "queued" || (job.status === "running" && job.claim))) {
          const store = await storage();
          const pulses = await store.list<Pulse>("pulses");
          if (job.status === "queued") {
            if (configuration("EXECUTOR") === "scheduled") {
              const pool = await poolConfig(store);
              workersOffline = workerHealth(pool, pulses) === "Workers not responding";
              queueNotice = queueWaitNotice({ paused: pool.workers === 0, notResponding: workersOffline });
            } else {
              // Local workers send no heartbeats; report the runner's own paused or stopped state instead.
              const { executionStatus } = await import("./execution-status");
              const execution = await executionStatus(store);
              if ("paused" in execution) queueNotice = queueWaitNotice({ paused: !!execution.paused, blockedReason: execution.blockedReason, resumesAutomatically: Boolean(execution.resumeAt) });
            }
          } else {
            const matches = pulses.filter(pulse => pulse.workerId === job.claim?.owner &&
              Number.isInteger(pulse.slot) && pulse.slot >= 1 && pulse.slot <= MAX_WORKERS);
            if (matches.length === 1) workerSlot = matches[0].slot;
          }
        }
        if(job?.source==="api" && job.status==="queued"){
          const {executionStatus}=await import("./execution-status");
          const execution=await executionStatus(await storage(),"api");
          if(execution.requiresUserAction)queueNotice=execution.nextAction;
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(job ? { ...job, workersOffline, ...(queueNotice ? { queueNotice } : {}), workerSlot } : { error: "Not found" }) }],
        };
      },
    );
    server.registerResource(
      "image-thumbnail",
      new ResourceTemplate("image-queue://thumbnail/{id}", { list: undefined }),
      {},
      async (uri, variables) => {
        const id = idSchema.parse(variables.id);
        const store = await storage();
        const job = await store.get<Job>("jobs", id);
        if (!job || job.trashedAt || job.status !== "done")
          throw new UserFacingError("Image is unavailable");
        let blob = job.blobKey ? await store.getBlob(job.blobKey) : undefined;
        if (!blob && job.source === "queue") {
          const { queueOutput, configuredQueueRoot } = await import(
            "../sources/queue"
          );
          blob = {
            bytes: await queueOutput(await configuredQueueRoot(), job),
            mime: "image/png",
          };
        }
        if (!blob) throw new UserFacingError("Image is unavailable");
        const preview = await thumbnail(blob.bytes, 640);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: preview.mime,
              blob: Buffer.from(preview.bytes).toString("base64"),
            },
          ],
        };
      },
    );
    registerAppResource(
      server,
      "Image request",
      JOB_VIEW_URI,
      {
        description: "Image request status",
      },
      async () => ({
        contents: [
          {
            uri: JOB_VIEW_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: jobViewHtml.replace("__IMAGE_QUEUE_DASHBOARD__", encodeURIComponent(dashboardUrl() ?? "")),
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
          },
        ],
      }),
    );
  };
}

function dashboardUrl() {
  try {
    const url = new URL(configuration("DASHBOARD_URL") ?? "http://127.0.0.1:3215");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
