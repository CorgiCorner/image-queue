import {expect,it,vi} from 'vitest';
import {MemoryStorage} from '../src/storage/memory';
import {LocalJobSource} from '../src/core/local-job-source';
it('leases once, validates ownership and keeps an expired attempt uncertain',async()=>{
 let now=0;const job={id:'one',capability:'codex-image' as const};const hooks={next:vi.fn(async()=>job),complete:vi.fn(async()=>{}),fail:vi.fn(async()=>{})};
 const source=new LocalJobSource(new MemoryStorage(),hooks,()=>now,100);
 const a=await source.claim('runner',['codex-image']);await source.start('one',a!.leaseId);expect(a?.job).toEqual(job);expect(await source.claim('other',['codex-image'])).toBeNull();
 await expect(source.heartbeat('wrong',a!.leaseId)).rejects.toThrow('lease');now=101;
 expect(await source.claim('other',['codex-image'])).toBeNull();expect(hooks.fail).toHaveBeenCalledWith('one',expect.objectContaining({uncertain:true}));
 await expect(source.complete('one',a!.leaseId,{blobKey:'a'.repeat(64),width:1,height:1,mime:'image/png'})).rejects.toThrow('lease');
});
it('renews active work and accepts a validated result only once',async()=>{
 let now=0;const hooks={next:vi.fn(async()=>({id:'one',capability:'codex-image' as const})),complete:vi.fn(async()=>{}),fail:vi.fn(async()=>{})};
 const source=new LocalJobSource(new MemoryStorage(),hooks,()=>now,100);const a=(await source.claim('runner',['codex-image']))!;
 await source.start('one',a.leaseId);now=90;await source.heartbeat('one',a.leaseId);now=110;
 await source.complete('one',a.leaseId,{blobKey:'a'.repeat(64),width:10,height:20,mime:'image/png'});
 expect(hooks.complete).toHaveBeenCalledOnce();await expect(source.heartbeat('one',a.leaseId)).rejects.toThrow('lease');
});

it('releases an expired lease that never began execution',async()=>{
 let now=0;const source=new LocalJobSource(new MemoryStorage(),{next:async()=>({id:'one',capability:'codex-image'}),complete:async()=>{},fail:async()=>{throw Error('must not mark uncertain')}},()=>now,100);
 const first=await source.claim('runner',['codex-image']);now=101;const next=await source.claim('runner',['codex-image']);expect(next?.leaseId).not.toBe(first?.leaseId);
});

it('exclusive restart recovery releases unstarted work immediately and preserves started uncertainty',async()=>{
 const store=new MemoryStorage();const fail=vi.fn(async()=>{});let id='unstarted';
 const source=new LocalJobSource(store,{next:async()=>({id,capability:'codex-image'}),complete:async()=>{},fail},()=>0,60000);
 await source.claim('old',['codex-image']);await source.recoverAfterRestart();expect(fail).not.toHaveBeenCalled();
 const resumed=await source.claim('new',['codex-image']);expect(resumed).toBeTruthy();await source.start(id,resumed!.leaseId);await source.recoverAfterRestart();expect(fail).toHaveBeenCalledWith(id,expect.objectContaining({uncertain:true}));expect(await source.claim('third',['codex-image'])).toBeNull();
});

it('rejects publication before execution is marked started',async()=>{
 const complete=vi.fn(async()=>{});const source=new LocalJobSource(new MemoryStorage(),{next:async()=>({id:'one',capability:'codex-image'}),complete,fail:async()=>{}});
 const a=(await source.claim('runner',['codex-image']))!;
 await expect(source.complete('one',a.leaseId,{blobKey:'a'.repeat(64),width:1,height:1,mime:'image/png'})).rejects.toThrow('not started');expect(complete).not.toHaveBeenCalled();
});
