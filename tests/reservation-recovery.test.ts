import {expect,it} from 'vitest';
import {MemoryStorage} from '../src/storage/memory';
import {inspectReservedResult} from '../src/core/reservation-recovery';
import type {Job} from '../src/core/schema';
it('requires explicit acknowledgement and preserves original reservation metadata',async()=>{
 const store=new MemoryStorage();const job={id:'IMG-one',source:'queue',status:'running',claim:{owner:'worker-2',since:'2026-11-16T10:42:00Z',reserved:true},outputPath:'/queue/original.png'} as Job;
 await store.put('jobs',job.id,job);
 await expect(inspectReservedResult(store,{id:job.id,acknowledgeUncertain:false} as never)).rejects.toThrow();
 const result=await inspectReservedResult(store,{id:job.id,acknowledgeUncertain:true});expect(result.status).toBe('uncertain');expect(result.claim).toEqual(job.claim);expect(result.outputPath).toBe(job.outputPath);
});
it('cannot convert an actively generating local job or an unrelated request',async()=>{
 const store=new MemoryStorage();await store.put('jobs','IMG-one',{id:'IMG-one',source:'queue',status:'running',claim:{owner:'local:1',reserved:undefined}});
 await expect(inspectReservedResult(store,{id:'IMG-one',acknowledgeUncertain:true})).rejects.toThrow('reserved');
});
