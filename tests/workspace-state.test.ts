import { describe, expect, it, vi } from "vitest";
import { defaultGenerationSource, jobCounts, workerHealth } from "../src/core/workspace-state";
import { defaultPool, type Pulse } from "../src/core/pool";
import type { Job } from "../src/core/schema";

describe("workspace state", () => {
  it("starts fresh installations with API and preserves existing queue workspaces", () => {
    expect(defaultGenerationSource({ jobs: [], pulses: [] })).toBe("api");
    expect(defaultGenerationSource({ jobs: [{ source: "api" } as Job] })).toBe("api");
    expect(defaultGenerationSource({ jobs: [{ source: "queue" } as Job] })).toBe("queue");
    expect(defaultGenerationSource({ jobs: [], pulses: [{} as Pulse] })).toBe("queue");
    expect(defaultGenerationSource({ cloud: true, jobs: [{ source: "queue" } as Job] })).toBe("api");
  });
  it("counts every status from the same job collection", () => {
    const jobs = ["done", "queued", "running", "blocked", "failed", "uncertain", "cancelled"].map(status => ({ status }) as Job);
    expect(jobCounts(jobs)).toEqual({total: 7, done: 1, active: 2, attention: 3, blocked: 1});
  });
  it("excludes stale and disabled slots from worker health", () => {
    const now = Date.now();
    const pulse = (slot: number, age: number) => ({slot, lastWake: new Date(now-age).toISOString()}) as Pulse;
    expect(workerHealth({...defaultPool, workers: 0}, [], now)).toBe("Workers paused");
    expect(workerHealth(defaultPool, [pulse(1, 90000), pulse(5, 0)], now)).toBe("Workers not responding");
    expect(workerHealth(defaultPool, [pulse(1, 0)], now)).toBe("1 of 4 workers responding");
  });
});
it("counts each valid live slot once and ignores future pulses", () => {
  const now=Date.now();
  const pulse=(slot:number,time:number)=>({slot,lastWake:new Date(time).toISOString()}) as Pulse;
  expect(workerHealth(defaultPool,[pulse(1,now),pulse(1,now),pulse(0,now),pulse(2,now+1000)],now)).toBe("1 of 4 workers responding");
});

it("uses the current clock and ignores malformed worker heartbeats", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  try {
    expect(workerHealth(defaultPool, [
      { slot: 1, lastWake: "invalid" } as Pulse,
      { slot: 1.5, lastWake: now.toISOString() } as Pulse,
      { slot: 4, lastWake: new Date(now.getTime() - 89_999).toISOString() } as Pulse,
    ])).toBe("1 of 4 workers responding");
  } finally {
    clock.mockRestore();
  }
});

it('uses one exact freshness boundary for table and summary', async () => {
  const { pulseIsFresh } = await import('../src/core/workspace-state');
  const now = Date.now();
  for (const age of [-1000, 0, 89999, 90000]) {
    const pulse = {slot: 1, lastWake: new Date(now-age).toISOString()} as Pulse;
    expect(workerHealth({...defaultPool,workers:1}, [pulse], now).includes('1 of 1')).toBe(pulseIsFresh(pulse,now));
  }
});

it("selects the local queue for a fresh local-runner workspace",()=>{expect(defaultGenerationSource({jobs:[],pulses:[],localRunner:{mode:"local"}})).toBe("queue");});

it("formats quota reset timestamps in the viewer timezone without changing other errors", async () => {
  const { workerStatusMessage } = await import("../src/core/workspace-state");
  const message = workerStatusMessage("Codex limit reached. Resets at 2026-11-17T08:00:00.000Z.", "en-GB", "Europe/Warsaw");
  expect(message).toContain("17 Nov 2026");
  expect(message).toContain("09:00");
  expect(message).not.toContain("T08:");
  expect(workerStatusMessage("Sign in to Codex.")).toBe("Sign in to Codex.");
  expect(workerStatusMessage("Resets at unknown.")).toBe("Resets at unknown.");
});

describe("queue wait notice", () => {
  it("reports a stopped queue as stopped, not as offline workers", async () => {
    const { queueWaitNotice } = await import("../src/core/workspace-state");
    const blocked = { paused: false, blockedReason: "Sign in to Codex.", notResponding: true };
    expect(queueWaitNotice(blocked)).toBe("Queue stopped — action needed. Sign in to Codex. Requests will wait until you resume the queue.");
    expect(queueWaitNotice(blocked, "version")).toBe("Queue stopped — action needed. Sign in to Codex. This version will wait until you resume the queue.");
    expect(queueWaitNotice({ ...blocked, paused: true })).toContain("Queue stopped — action needed.");
    for (const subject of ["requests", "version"] as const) expect(queueWaitNotice(blocked, subject)).not.toContain("offline");
  });
  it("says a quota stop resumes on its own and shows the reset in the viewer timezone", async () => {
    const { queueWaitNotice } = await import("../src/core/workspace-state");
    const message = queueWaitNotice({ paused: false, blockedReason: "Codex limit reached. Resets at 2026-11-17T08:00:00.000Z.", resumesAutomatically: true }, "requests", "en-GB", "Europe/Warsaw");
    expect(message).toMatch(/^Queue stopped\. Codex limit reached\. Resets at .*09:00\. Requests will wait in the queue and resume after the limit resets\.$/);
  });
  it("keeps turned off and offline for paused and unresponsive workers only", async () => {
    const { queueWaitNotice, workersOfflineMessage } = await import("../src/core/workspace-state");
    expect(queueWaitNotice({ paused: true, notResponding: true })).toBe("Workers are turned off. Requests will wait in the queue.");
    expect(queueWaitNotice({ paused: true }, "version")).toBe("Workers are turned off. This version will wait in the queue.");
    expect(queueWaitNotice({ paused: false, notResponding: true })).toBe(workersOfflineMessage);
    expect(queueWaitNotice({ paused: false, notResponding: true }, "version")).toBe("Workers are offline. This version will wait in the queue.");
    expect(queueWaitNotice({ paused: false })).toBeUndefined();
    expect(queueWaitNotice({ paused: false, blockedReason: "" })).toBeUndefined();
  });
});
