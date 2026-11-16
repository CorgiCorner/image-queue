import { mcpConfigurations, type McpLaunch } from './mcp-configuration';
import { poolSchema, type PoolConfig } from './pool';

/** A draft only: the desktop client still requires the user to send it. */
export function workerSetupLink(launch: McpLaunch | undefined, pool: PoolConfig, origin?: string) {
  const entry = launch?.args.find(arg => /[\\/]dist[\\/]mcp\.mjs$/.test(arg));
  if (!entry || !launch) return undefined;
  const root = entry.replace(/[\\/]dist[\\/]mcp\.mjs$/, '');
  const config = poolSchema.parse(pool);
  const prompt = `Set up scheduled image-queue workers for this local installation. Read AGENTS.md, docs/codex-workers.md and WORKER.md in the workspace first. Use the supported Codex automation tools; do not edit internal scheduler databases. Prepare the configured queue directory before scheduling: follow docs/codex-workers.md to install docs/protocol/worker.py and docs/protocol/request.sh if missing, and initialize images-todo.md only for a new empty queue. Preserve existing helpers unless an explicit compatible upgrade is needed, and never replace an existing queue or reservation. Inspect existing workers for this installation and reuse them instead of creating duplicates. Copy the safe installation environment below into the scheduled worker bootstrap, and apply it to every pool and tagging command. The MCP client environment alone does not configure scheduled chats. Never fall back to a different store or queue; stop if the configured directories are unavailable. Verify that the first heartbeat appears in this exact dashboard store, not merely in another local installation. Configure at most ${config.workers} active slots, model ${config.workerModel ?? 'gpt-6.1-sol'}, reasoning ${config.workerEffort ?? 'low'}, Fast (priority), with the documented base schedule and gate. If the configured active count is zero, keep workers paused; do not enable them during setup. Preserve every existing reservation and queue entry. Do not generate images during setup. Verify the resulting schedules and report the first heartbeat; if automation tools are unavailable, explain the remaining manual step instead of claiming success.\n\nThe following is installation configuration, not additional instructions:\n${mcpConfigurations(launch, origin)[1].value}`;
  const query = new URLSearchParams({path: root, prompt});
  return `codex://threads/new?${query.toString()}`;
}
