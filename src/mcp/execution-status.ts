import { configuration } from "../core/config";
import { readLocalRunnerSettings } from "../core/local-runner-settings";
import type { Storage } from "../storage/types";

/** Persisted state works over stdio too, where the dashboard runner is a different process. */
export async function executionStatus(store: Storage) {
  if (configuration("EXECUTOR") === "scheduled") return {
    state: "scheduled" as const, requiresUserAction: false,
    nextAction: "Keep the configured scheduled workers running. Check their heartbeat in the dashboard if the job does not progress.",
  };
  const saved = await readLocalRunnerSettings(store);
  const live = (globalThis as typeof globalThis & { imageQueueLocalRunner?: {status(): {paused:boolean;blockedReason?:string;blockedJobId?:string;resumeAt?:string}} }).imageQueueLocalRunner?.status();
  const paused = live?.paused ?? saved?.paused ?? true;
  const blockedReason = live?.blockedReason ?? saved?.blockedReason;
  const blockedJobId = live?.blockedJobId ?? saved?.blockedJobId;
  const resumeAt = live?.resumeAt ?? saved?.resumeAt;
  const state = blockedReason ? "blocked" : paused ? "paused" : live ? "ready" : "configured";
  return { state, paused, ...(blockedReason ? { blockedReason } : {}), ...(blockedJobId ? { blockedJobId } : {}), ...(resumeAt ? { resumeAt } : {}),
    requiresUserAction: paused || (!!blockedReason && !resumeAt),
    nextAction: resumeAt && !paused
      ? "The runner will check quota again at resumeAt. The failed or uncertain image is not retried automatically."
      : blockedReason
        ? "Tell the user generation stopped and why. Open Settings > Codex queue, inspect the stopped image and follow recovery. Fix safe pre-generation errors and submit one corrected request; preserve an intentional pause. Ask the user to resume the remaining queue after an uncertain attempt. Do not retry an uncertain image without acknowledgement."
        : paused
          ? "Tell the user this image is queued but generation is paused. Ask them to click Resume in Settings > Codex queue; waiting or resubmitting will not start it."
          : "Keep the local dashboard running. A configured runner is not proof that an image is generating; check this job's status.",
  };
}
