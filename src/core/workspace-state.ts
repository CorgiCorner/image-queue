import type { Job } from "./schema";
import type { PoolConfig, Pulse } from "./pool";
export function defaultGenerationSource(state: { cloud?: boolean; jobs: Job[]; pulses?: Pulse[]; localRunner?: {mode:string} }) {
  return !state.cloud && (state.localRunner?.mode === "local" || state.pulses?.length || state.jobs.some(job => job.source === "queue")) ? "queue" as const : "api" as const;
}
export function jobCounts(jobs: Job[]) {
  return {
    total: jobs.length,
    blocked: jobs.filter((job) => job.status === "blocked").length,
    done: jobs.filter((job) => job.status === "done").length,
    active: jobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length,
    attention: jobs.filter((job) =>
      ["blocked", "failed", "uncertain"].includes(job.status),
    ).length,
  };
}
export function pulseIsFresh(pulse: Pulse, now = Date.now()) {
  const age = now - Date.parse(pulse.lastWake);
  return Number.isFinite(age) && age >= 0 && age < 90000;
}
export function workerHealth(
  config: PoolConfig,
  pulses: Pulse[],
  now = Date.now(),
) {
  if (config.workers === 0) return "Workers paused";
  const fresh = new Set(
    pulses
      .filter(
        (pulse) =>
          Number.isInteger(pulse.slot) &&
          pulse.slot >= 1 &&
          pulse.slot <= config.workers &&
          pulseIsFresh(pulse, now),
      )
      .map((pulse) => pulse.slot),
  ).size;
  return fresh === 0
    ? "Workers not responding"
    : `${fresh} of ${config.workers} workers responding`;
}

export const workersOfflineMessage = "Workers are offline. Requests will wait in the queue.";

/** Present persisted quota reset timestamps in the viewer's locale and timezone. */
export function workerStatusMessage(message: string, locales?: string | string[], timeZone?: string) {
  return message.replace(/Resets at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\./g, (match, timestamp) => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return match;
    return `Resets at ${new Intl.DateTimeFormat(locales, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(date)}.`;
  });
}
