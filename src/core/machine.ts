import {waitForLock} from "../storage/wait-for-lock";
import type { Storage } from "../storage/types";
import { configuration } from "./config";
export async function machineId(store: Storage): Promise<string> {
  const configured = configuration("MACHINE_ID");
  if (configured) return configured;
  const existing = await store.get<{ id: string }>("settings", "machine");
  if (existing) return existing.id;
  return waitForLock(store,"machine-identity", async () => {
    const current = await store.get<{ id: string }>("settings", "machine");
    if (current) return current.id;
    const id = crypto.randomUUID();
    await store.put("settings", "machine", { id });
    return id;
  },10000);
}
