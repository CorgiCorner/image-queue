import {processingStatus} from "../core/processing";
import { isSizeMismatchError, sizeMismatchRecoveryMessage } from "../core/job-recovery";
import { configuration } from "../core/config";
import { readLocalRunnerSettings } from "../core/local-runner-settings";
import type { Storage } from "../storage/types";

/** Persisted state works over stdio too, where the dashboard runner is a different process. */
export async function executionStatus(store: Storage, source: "queue"|"api" = "queue") {
  // A hosted deployment runs provider jobs from its generation queue; it has no local processing controls.
  if (source === "api" && configuration("STORAGE_DRIVER") === "cloudflare") return {
    state: "hosted" as const, requiresUserAction: false, nextAction: "Check this job for the provider result.",
  };
  const controls = await processingStatus(store);
  if (source === "api") {
    const api = controls.api;
    const paused = controls.paused || api.paused;
    const state = paused ? "paused" : api.blockedReason ? "blocked" : api.online ? "ready" : "offline";
    return {state, paused, blockedReason:api.blockedReason, resumeAt:api.resumeAt, running:api.running, online:api.online,
      requiresUserAction:paused || !api.online || (!!api.blockedReason && !api.resumeAt),
      nextAction:paused ? "API processing is paused. Resume it in Settings > Processing when the user is ready."
        : !api.online ? "Start the local dashboard to process accepted API requests."
        : api.blockedReason ? api.blockedReason : "The API executor is available. Check this job for its result."};
  }
  if (configuration("EXECUTOR") === "scheduled") return {
    state: controls.paused || controls.queue.paused ? "paused" as const : "scheduled" as const, requiresUserAction: controls.paused || controls.queue.paused,
    nextAction: controls.paused || controls.queue.paused ? "Resume the paused queue in Settings to process pending requests." : "Keep the configured scheduled workers running. Check their heartbeat in the dashboard if the job does not progress.",
  };
  const saved = await readLocalRunnerSettings(store);
  const live = (globalThis as typeof globalThis & { imageQueueLocalRunner?: {status(): {running?:number;paused:boolean;blockedReason?:string;blockedJobId?:string;resumeAt?:string}} }).imageQueueLocalRunner?.status();
  const paused = controls.paused || controls.queue.paused;
  const blockedReason = live?.blockedReason ?? controls.queue.blockedReason ?? saved?.blockedReason;
  const blockedJobId = live?.blockedJobId ?? saved?.blockedJobId;
  const resumeAt = live?.resumeAt ?? saved?.resumeAt;
  const online = !!live || controls.queue.online;
  const state = blockedReason ? "blocked" : paused ? "paused" : online ? "ready" : "offline";
  return { state, paused, online, running: live?.running ?? controls.queue.running, ...(blockedReason ? { blockedReason } : {}), ...(blockedJobId ? { blockedJobId } : {}), ...(resumeAt ? { resumeAt } : {}),
    requiresUserAction: paused || !online || (!!blockedReason && !resumeAt),
    nextAction: resumeAt && !paused
      ? "The runner will check quota again at resumeAt. The failed or uncertain image is not retried automatically."
      : isSizeMismatchError(blockedReason)
        ? sizeMismatchRecoveryMessage
      : blockedReason
        ? "Report the stop reason. Inspect the affected request and fix the cause. Resume Codex in Settings > Processing or with set_queue_processing when authorized. Inspect uncertain results before retrying."
        : paused
          ? "This image is queued. Resume the paused control in Settings > Processing or with set_queue_processing when authorized."
          : online ? "The Codex executor is available. Check this job for its result." : "Start the local dashboard to process accepted Codex requests.",
  };
}
