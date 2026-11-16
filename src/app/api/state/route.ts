import { setTimeout as delay } from "node:timers/promises";
import { StorageLockBusy } from "@/storage/types";
import { accessDeniedResponse } from "@/core/access-response";
import { loadWorkspaceState } from "@/core/load-workspace-state";

export async function GET(request: Request) {
  const denied = await accessDeniedResponse(request);
  if (denied) return denied;
  const headers = { "Cache-Control": "no-store" };
  const unavailable = () => Response.json({ error: "Workspace could not be loaded. Try again." }, { status: 500, headers });
  for (const wait of [25, 75, 150]) {
    try {
      return Response.json(await loadWorkspaceState(), { headers });
    } catch (error) {
      if (!(error instanceof StorageLockBusy)) return unavailable();
      await delay(wait, undefined, { signal: request.signal });
    }
  }
  try {
    return Response.json(await loadWorkspaceState(), { headers });
  } catch (error) {
    if (!(error instanceof StorageLockBusy)) return unavailable();
    return Response.json({ error: "Workspace update in progress" }, {
      status: 503,
      headers: { ...headers, "Retry-After": "1" },
    });
  }
}
