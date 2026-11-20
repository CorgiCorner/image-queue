import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolAnnotations } from "@modelcontextprotocol/server";

/**
 * Tools that only read state. Hosts such as the Claude apps use readOnlyHint to
 * decide which connector tools may run without a confirmation on every call.
 */
const READ_ONLY = new Set([
  "get_generation_source", "get_queue_processing", "list_projects", "list_jobs", "show_image", "show_images", "view_image",
  "get_job", "show_job", "wait_for_job", "list_models", "list_topics", "list_untagged", "list_notes",
  "list_thumbnails", "get_image_details", "get_job_state", "read_thumbnail", "read_image_file",
]);

/** Tools that cancel or end work, so hosts keep asking before they run. */
const DESTRUCTIVE = new Set(["cancel_job", "mark_uncertain_failed"]);

/** Tools that reach the configured image provider, which may bill the API key. */
const OPEN_WORLD = new Set(["request_image", "request_images", "retry_image", "iterate_image", "refresh_models"]);

export function toolAnnotations(name: string): ToolAnnotations {
  if (READ_ONLY.has(name)) return { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  return { readOnlyHint: false, destructiveHint: DESTRUCTIVE.has(name), openWorldHint: OPEN_WORLD.has(name) };
}

/** Adds the hints above to every tool registered on the server afterwards. */
export function annotateTools(server: McpServer) {
  server.registerTool = new Proxy(server.registerTool, {
    apply(register, target, args) {
      const [name, config] = args as [string, { annotations?: ToolAnnotations }];
      args[1] = { ...config, annotations: { ...toolAnnotations(name), ...config.annotations } };
      return Reflect.apply(register, target, args);
    },
  });
}
