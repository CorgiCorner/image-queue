import { afterEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { executionStatus } from "../src/mcp/execution-status";
afterEach(()=>vi.unstubAllEnvs());
it("reports persisted paused and stopped runners to a separate MCP process",async()=>{
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');
 const store=new MemoryStorage();
 expect(await executionStatus(store)).toMatchObject({state:'paused',requiresUserAction:true});
 await store.put('settings','local-runner',{workers:1,paused:false,blockedReason:'Codex is not signed in.',blockedJobId:'one'});
 expect(await executionStatus(store)).toMatchObject({state:'blocked',blockedJobId:'one',requiresUserAction:true});
});
