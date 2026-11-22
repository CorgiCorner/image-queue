import { UserFacingError } from "../core/user-facing-error";
import { MAX_WORKERS, poolConfig, type Pulse } from "../core/pool";
import { queueWaitNotice, workerHealth } from "../core/workspace-state";
import { configuration } from "../core/config";
import { prepareCorrection } from "../core/prepare-correction";
import { imageViewHtml, imageViewVersion } from "./views/image-html";
import { imageDetails } from "../core/image-details";
import { galleryQuerySchema, queryGallery } from "../core/gallery-query";
import { galleryViewHtml, galleryViewVersion } from "./views/gallery-html";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { storage } from "../storage";
import type { Job } from "../core/schema";
import { hasSavedResult } from "../core/job-status";
import { thumbnail } from "../sources/thumbnail";
import { jobViewHtml, jobViewVersion } from "./views/job-html";
import { referenceViewHtml, referenceViewVersion } from "./views/reference-html";
import { z } from "zod";
import { idSchema } from "../core/schema";
import { refreshedJob, refreshedJobs, service, dispatch } from "../core/runtime";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import {
  getUiCapability,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

// Hosts cache a view by its address and keep showing the old one after a
// deployment, so each address carries the version of the view's content.
export const JOB_VIEW_URI = `ui://image-queue/job-${jobViewVersion}`;
export const GALLERY_VIEW_URI = `ui://image-queue/gallery-${galleryViewVersion}`;
export const IMAGE_VIEW_URI = `ui://image-queue/image-${imageViewVersion}`;
export const REFERENCE_VIEW_URI = `ui://image-queue/reference-${referenceViewVersion}`;

/** Register optional resources only after the host advertises MCP Apps. */
export function configureAppViews(server: McpServer, tools: RegisteredTool[], galleryTool?: RegisteredTool, imageTool?: RegisteredTool, mode: "negotiate" | "always" = "negotiate", panelUrl?: string) {
  if (mode === "always") return installAppViews(server, tools, galleryTool, imageTool, panelUrl);
  server.server.oninitialized = () => {
    const capability = getUiCapability(server.server.getClientCapabilities());
    if (capability?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) installAppViews(server, tools, galleryTool, imageTool, panelUrl);
  };
}

function installAppViews(server: McpServer, tools: RegisteredTool[], galleryTool?: RegisteredTool, imageTool?: RegisteredTool, panelUrl?: string) {
  {
    for (const tool of tools)
      tool.update({ _meta: { ui: { resourceUri: JOB_VIEW_URI } } });
    if (galleryTool) {
      galleryTool.update({ _meta: { ui: { resourceUri: GALLERY_VIEW_URI } } });
      server.registerTool("list_thumbnails", {
        description: "Read the next page of images for the gallery view",
        inputSchema: galleryQuerySchema.shape,
        _meta: { ui: { visibility: ["app"] } },
      }, async input => ({ content: [{ type: "text" as const, text: JSON.stringify(queryGallery(await refreshedJobs(), input)) }] }));
      registerAppResource(server, "Image gallery", GALLERY_VIEW_URI, {}, async () => ({
        contents: [{ uri: GALLERY_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: galleryViewHtml,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
      }));
    }
    if (imageTool) {
      imageTool.update({ _meta: { ui: { resourceUri: IMAGE_VIEW_URI } } });
      registerAppResource(server, "Image notes and versions", IMAGE_VIEW_URI, {}, async () => ({
        contents: [{ uri: IMAGE_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: imageViewHtml,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
      }));
    }
    // Claude passes only text to a tool, never a file attached to the chat, so
    // the user hands the image to this card, which uploads it through the host.
    server.registerTool("upload_reference", {
      description: "Show a card in which the user chooses, drops or pastes an image from their computer or phone to use as a reference in projectId. Use it whenever the user attached an image to the conversation and wants it as a reference: an attached file cannot be passed to image-queue, so ask the user to pick the same image in the card. Also use it on the hosted server, where add_reference cannot read local files. The card sends the new referenceId back as a message; wait for it, then pass it in referenceIds.",
      inputSchema: { projectId: idSchema },
      _meta: { ui: { resourceUri: REFERENCE_VIEW_URI } },
    }, async ({ projectId }) => {
      const api = await service();
      if (projectId !== "inbox" && !(await api.store.get("projects", projectId))) throw new UserFacingError("Project does not exist");
      return { content: [{ type: "text" as const, text: JSON.stringify({ projectId, next: "Ask the user to choose the image in the card. The card replies with its referenceId." }) }] };
    });
    server.registerTool("save_uploaded_reference", {
      description: "Store one image the user chose in the reference upload card",
      inputSchema: z.object({
        projectId: idSchema,
        name: z.string().trim().min(1).max(200),
        mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
        // 20 MB as base64.
        data: z.string().min(1).max(28_000_000),
      }),
      _meta: { ui: { visibility: ["app"] } },
    }, async ({ projectId, name, mime, data }) => {
      const reference = await (await service()).addReference(projectId, name, mime, new Uint8Array(Buffer.from(data, "base64")));
      return { content: [{ type: "text" as const, text: JSON.stringify({ id: reference.id, name: reference.name, projectId: reference.projectId, mime: reference.mime }) }] };
    });
    registerAppResource(server, "Upload reference", REFERENCE_VIEW_URI, {}, async () => ({
      contents: [{ uri: REFERENCE_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: referenceViewHtml,
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
    }));
    server.registerTool("add_notes_to_queue", {
      description: "Create one correction from the image's unsent notes after the user clicks Request next version",
      inputSchema: z.object({ imageId: idSchema, idempotencyKey: idSchema.max(96), instruction: z.string().trim().max(12000).optional() }),
      _meta: { ui: { visibility: ["app"] } },
    }, async input => {
      const job = await prepareCorrection(await service(), input);
      await dispatch(job.id);
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
    server.registerTool("read_image_file", {
      description: "Read one finished image at full size so the inline view can hand it to the host as a download",
      inputSchema: z.object({ id: idSchema }),
      _meta: { ui: { visibility: ["app"] } },
    }, async ({ id }) => {
      const file = await readImageFile(id);
      return { content: [{ type: "resource" as const, resource: {
        uri: `image-queue://image/${file.name}`, mimeType: file.mime, blob: Buffer.from(file.bytes).toString("base64"),
      } }] };
    });
    // Some hosts proxy a view's tool calls but read only the ui:// resource a tool names,
    // so the views ask this tool first and keep the resource below as a fallback.
    server.registerTool("read_thumbnail", {
      description: "Read the preview of one finished image for an inline view. animated=true keeps the frames of a GIF.",
      inputSchema: z.object({ id: idSchema, animated: z.boolean().optional() }),
      _meta: { ui: { visibility: ["app"] } },
    }, async ({ id, animated }) => {
      const preview = await readThumbnail(id, { animated });
      return { content: [
        { type: "image" as const, data: Buffer.from(preview.bytes).toString("base64"), mimeType: preview.mime },
        // The view offers Play when a GIF's frames did not survive the preview.
        { type: "text" as const, text: JSON.stringify({ animated: preview.animated }) },
      ] };
    });
    server.registerResource(
      "image-thumbnail",
      new ResourceTemplate("image-queue://thumbnail/{id}", { list: undefined }),
      {},
      async (uri, variables) => {
        const preview = await readThumbnail(idSchema.parse(variables.id));
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
            text: jobViewHtml.replace("__IMAGE_QUEUE_DASHBOARD__", encodeURIComponent(dashboardUrl(panelUrl) ?? "")),
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
          },
        ],
      }),
    );
  }
}

const extensions: Record<string, string> = {
  "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg",
};

/** The full-size file of a finished image that is not in Trash, named after its ID. */
export async function readImageFile(id: string) {
  const store = await storage();
  const job = await store.get<Job>("jobs", id);
  if (!job || job.trashedAt || !hasSavedResult(job) || !job.blobKey) throw new UserFacingError("Image is unavailable");
  const blob = await store.getBlob(job.blobKey);
  if (!blob) throw new UserFacingError("Image is unavailable");
  const mime = extensions[blob.mime] ? blob.mime : "image/png";
  return { bytes: blob.bytes, mime, name: `${job.id}.${extensions[mime]}` };
}

/**
 * Render the preview of a finished image that is not in Trash: 640 px, or a
 * 480 px animation when the frames of a GIF are asked for (the smaller width
 * keeps an eight-frame preview quick to load through the host).
 */
export async function readThumbnail(id: string, options: { animated?: boolean } = {}) {
  const store = await storage();
  const job = await store.get<Job>("jobs", id);
  if (!job || job.trashedAt || !hasSavedResult(job))
    throw new UserFacingError("Image is unavailable");
  let blob = job.blobKey ? await store.getBlob(job.blobKey) : undefined;
  if (!blob && job.source === "queue") {
    const { queueOutput, configuredQueueRoot } = await import("../sources/queue");
    blob = { bytes: await queueOutput(await configuredQueueRoot(), job), mime: "image/png" };
  }
  if (!blob) throw new UserFacingError("Image is unavailable");
  const animated = Boolean(options.animated) && (job.outputFormat === "gif" || blob.mime === "image/gif");
  return animated ? thumbnail(blob.bytes, 480, { animated: true }) : thumbnail(blob.bytes, 640);
}

/** The panel the views link to: the configured URL, else the origin that served the MCP request, else the local default. */
function dashboardUrl(panelUrl?: string) {
  try {
    const url = new URL(configuration("DASHBOARD_URL") ?? panelUrl ?? "http://127.0.0.1:3215");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
