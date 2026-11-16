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

it('five parallel leases claim, heartbeat and complete on a shared disk store without lock refusals',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {FileStorage}=await import('../src/storage/fs');const {openProjectStorage}=await import('../src/storage/open-project-storage');
 const {mutationLock}=await import('../src/storage/mutation-lock');const {StorageLockBusy}=await import('../src/storage/types');
 const root=await mkdtemp(join(tmpdir(),'local-claims-'));
 try {
  const workspace=new FileStorage(root);const store=await openProjectStorage(workspace);
  // The same store as the live app: every lease write also takes the project mutation lock.
  let refusals=0;const lock=store.lock.bind(store);
  store.lock=async(key,work)=>{try{return await lock(key,work);}catch(error){if(error instanceof StorageLockBusy)refusals++;throw error;}};
  const slow=()=>new Promise(resolve=>setTimeout(resolve,5));
  const ids=Array.from({length:8},(_,index)=>`job-${index}`);
  const hooks={next:vi.fn(async(_c:unknown,excluded:ReadonlySet<string>)=>{await slow();const id=ids.find(id=>!excluded.has(id));return id?{id,capability:'codex-image' as const}:null;}),complete:vi.fn(async()=>{await slow();}),fail:vi.fn(async()=>{})};
  const source=new LocalJobSource(store,hooks);
  const result={blobKey:'a'.repeat(64),width:1,height:1,mime:'image/png' as const};
  const claimed=await Promise.all(Array.from({length:5},(_,index)=>source.claim(`local:${index}`,['codex-image'])));
  expect(new Set(claimed.map(c=>c!.job.id)).size).toBe(5);
  await Promise.all(claimed.map(c=>source.start(c!.job.id,c!.leaseId)));
  // Page writes from another caller contend for the same mutation lock meanwhile.
  const page=Promise.all(Array.from({length:5},(_,index)=>mutationLock(workspace,root,()=>workspace.put('settings',`page-${index}`,{index}))));
  for(let round=0;round<3;round++)await Promise.all(claimed.map(c=>source.heartbeat(c!.job.id,c!.leaseId)));
  const more=await Promise.all([
   ...claimed.slice(0,3).map(c=>source.complete(c!.job.id,c!.leaseId,result)),
   ...claimed.slice(3).map(c=>source.heartbeat(c!.job.id,c!.leaseId)),
   source.claim('local:5',['codex-image']),source.claim('local:6',['codex-image']),
  ]);
  await page;
  expect(hooks.complete).toHaveBeenCalledTimes(3);expect(hooks.fail).not.toHaveBeenCalled();
  expect(more.slice(5).every(c=>c&&typeof c==='object'&&'leaseId' in c)).toBe(true);
  // Contention really happened and was absorbed by waiting.
  expect(refusals).toBeGreaterThan(0);
 } finally { await rm(root,{recursive:true,force:true}); }
},20000);
