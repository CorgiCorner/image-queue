import { setTimeout as delay } from "node:timers/promises";
import { StorageLockBusy } from "@/storage/types";
import { accessDeniedResponse } from "@/core/access-response";
import { idSchema, type Job } from "@/core/schema";
import { refreshedJobs, service } from "@/core/runtime";
import { loadWorkspaceState } from "@/core/load-workspace-state";

export async function GET(request: Request) {
  const denied = await accessDeniedResponse(request);
  if (denied) return denied;
  const headers = { "Cache-Control": "no-store" };
  const ids = new URL(request.url).searchParams.getAll("job");
  if (ids.length > 32 || ids.some(id => !idSchema.safeParse(id).success))
    return Response.json({ error: "Invalid job selection" }, { status: 400, headers });
  async function load() {
    if (!ids.length) return loadWorkspaceState();
    const api = await service();
    const records = await Promise.all(ids.map(id => api.store.get<Job>("jobs", id)));
    const jobs = await refreshedJobs(api, records.filter((job): job is Job => !!job));
    return jobs.map(({id, status, updatedAt, claim}) => ({id, status, updatedAt, claim}));
  }
  const unavailable = () => Response.json({ error: "Workspace could not be loaded. Try again." }, { status: 500, headers });
  for (const wait of [25, 75, 150]) {
    try {
      return Response.json(await load(), { headers });
    } catch (error) {
      if (!(error instanceof StorageLockBusy)) return unavailable();
      await delay(wait, undefined, { signal: request.signal });
    }
  }
  try {
    return Response.json(await load(), { headers });
  } catch (error) {
    if (!(error instanceof StorageLockBusy)) return unavailable();
    return Response.json({ error: "Workspace update in progress" }, {
      status: 503,
      headers: { ...headers, "Retry-After": "1" },
    });
  }
}
