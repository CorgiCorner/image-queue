import {mkdtemp,copyFile,writeFile,chmod,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {FileStorage} from '../src/storage/fs';
import {startLocalRunner} from '../src/storage/local-runner';
import {appendQueue,parseQueue} from '../src/sources/queue';
import {readFile} from 'node:fs/promises';
import type {Job} from '../src/core/schema';
const roots:string[]=[];afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
it('runs the complete local lifecycle and disables new scheduled claims',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-runner-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await copyFile(resolve('docs/protocol/worker.py'),join(queue,'worker.py'));await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 const seed=join(root,'seed.png');await sharp({create:{width:32,height:32,channels:3,background:'blue'}}).png().toFile(seed);
 const executable=join(root,'fake-codex');
 await writeFile(executable,`#!/usr/bin/env python3
import sys,json,os,shutil
if sys.argv[1:]==['--version']: print('codex-cli 0.167.1');sys.exit(0)
if sys.argv[1:]==['login','status']: print('Logged in using ChatGPT');sys.exit(0)
def emit(x): print(json.dumps(x),flush=True)
for line in sys.stdin:
 x=json.loads(line);m=x.get('method');i=x.get('id')
 if i is None: continue
 result={}
 if m=='config/read': result={'config':{}}
 if m=='account/rateLimits/read': result={'rateLimits':{'primary':{'usedPercent':0,'windowDurationMins':300,'resetsAt':2000000000}}}
 if m=='thread/start': result={'thread':{'id':'fixture'}}
 if m=='mcpServerStatus/list': result={'data':[]}
 emit({'id':i,'result':result})
 if m=='turn/start':
  request=json.loads(x['params']['input'][0]['text'])
  if request['imageRequest']=='A missing image':
   emit({'method':'item/completed','params':{'threadId':'fixture','item':{'type':'agentMessage','text':'The image tool rejected the attachment.'}}})
   emit({'method':'turn/completed','params':{'threadId':'fixture','turn':{'status':'completed'}}})
   continue
  folder=os.path.join(os.environ['CODEX_HOME'],'generated_images','fixture');os.makedirs(folder,exist_ok=True)
  out=os.path.join(folder,'image.png');shutil.copyfile(${JSON.stringify(seed)},out)
  emit({'method':'item/completed','params':{'threadId':'fixture','item':{'type':'imageGeneration','status':'completed','revisedPrompt':request['imageRequest'],'savedPath':out,'inputImages':[]}}})
  emit({'method':'turn/completed','params':{'threadId':'fixture','turn':{'status':'completed'}}})
`);await chmod(executable,0o700);
 vi.stubEnv('CODEX_HOME',join(root,'codex'));vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:1,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1});
 const job={id:'IMG-lifecycle',idempotencyKey:'lifecycle',projectId:'project',prompt:'A blue square',source:'queue',provider:'openai',model:'',width:32,height:32,transparent:false,referenceIds:[],status:'queued',requestHash:'hash',createdAt:new Date().toISOString()} as unknown as Job;
 const oversized={...job,id:'IMG-oversized',idempotencyKey:'oversized'};
 const missing={...job,id:'IMG-missing-image',idempotencyKey:'missing-image',prompt:'A missing image'};
 const references=Array.from({length:6},(_,i)=>join(root,`ref-${i}.png`));
 await Promise.all(references.map(file=>copyFile(seed,file)));
 for(const request of [oversized,missing,job]){
  await appendQueue(queue,request,request===oversized?references:[]);
  await store.put('jobs',request.id,request);
 }
 const runner=await startLocalRunner(store);
 try {
  await vi.waitFor(async()=>{
   expect(runner?.status().blockedReason).toBeUndefined();
   const entries=parseQueue(await readFile(join(queue,'images-todo.md'),'utf8'));
   expect(entries.map(entry=>entry.status)).toEqual([
    expect.stringContaining('blocked: Local Codex accepts at most 5 reference images (got 6)'),
    'blocked: Codex did not start image generation.','done',
   ]);
  },{timeout:25000});
  expect((await store.get<any>('settings','worker-pool')).workers).toBe(0);
  await expect(startLocalRunner(store)).rejects.toThrow('operation is in progress');
  await vi.waitFor(async()=>expect(await store.list('local-attempts')).toEqual(expect.arrayContaining([
   expect.objectContaining({jobId:job.id,state:'succeeded'}),
   expect.objectContaining({jobId:missing.id,state:'failed'}),
  ])),{timeout:10000});
  const attempts=await store.list<{jobId:string}>('local-attempts');
  expect(attempts).toHaveLength(2);
  expect(await store.get('jobs',oversized.id)).toMatchObject({status:'blocked'});
  expect(await store.get('jobs',missing.id)).toMatchObject({status:'failed',error:expect.stringContaining('The image tool rejected the attachment.')});
  const next={...job,id:'IMG-external',idempotencyKey:'external'};await store.put('jobs',next.id,next);await appendQueue(queue,next,[]);
  await vi.waitFor(async()=>{expect(parseQueue(await readFile(join(queue,'images-todo.md'),'utf8')).find(j=>j.id===next.id)?.status).toBe('done');},{timeout:25000});
 } finally {await runner?.stop();}
},60000);

it('keeps a blocked runner stopped across application restarts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-runner-blocked-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',process.execPath);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:0,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1,blockedReason:'Check previous execution'});
 const runner=await startLocalRunner(store);try{expect(runner?.status().blockedReason).toBe('Check previous execution');expect(runner?.status().desiredWorkers).toBe(1);await runner?.wake();expect(runner?.status().enabled).toBe(0);expect(runner?.status().running).toBe(0);}finally{await runner?.stop();}
});
it('rejects API-key login before reserving a queued subscription request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-runner-login-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');const executable=join(root,'codex');await writeFile(executable,'#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"codex-cli 0.167.1\"; else echo \"Logged in using an API key\"; fi\n');await chmod(executable,0o700);
 vi.stubEnv('CODEX_HOME',join(root,'codex'));vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:1,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1});const job={id:'IMG-login',prompt:'A square',width:32,height:32,transparent:false,referenceIds:[]} as unknown as Job;await appendQueue(queue,job,[]);
 const runner=await startLocalRunner(store);try{await vi.waitFor(()=>expect(runner?.status().blockedReason).toContain('API key'),{timeout:5000});expect(parseQueue(await readFile(join(queue,'images-todo.md'),'utf8'))[0].status).toBe('pending');expect(await store.list('runner-leases')).toHaveLength(0);}finally{await runner?.stop();}
});

it('keeps the application available when the Codex executable is missing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-missing-codex-'));roots.push(root);
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',join(root,'missing'));
 const runner=await startLocalRunner(new FileStorage(join(root,'store')));
 expect(runner?.status()).toMatchObject({enabled:0,running:0,blockedReason:expect.stringContaining('Codex CLI')});
 await runner?.stop();
});

it('retains a crashed generation as uncertain and does not replay it after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-crashed-runner-'));roots.push(root);
 const queue=join(root,'queue');await mkdir(queue);await copyFile(resolve('docs/protocol/worker.py'),join(queue,'worker.py'));await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 const executable=join(root,'fake-codex'),counter=join(root,'started');
 await writeFile(executable,`#!/usr/bin/env python3
import sys,json
if sys.argv[1:]==['--version']: print('codex-cli 0.167.1');sys.exit(0)
if sys.argv[1:]==['login','status']: print('Logged in using ChatGPT');sys.exit(0)
for line in sys.stdin:
 x=json.loads(line);i=x.get('id');m=x.get('method')
 if i is None: continue
 result={}
 if m=='config/read': result={'config':{}}
 if m=='thread/start': result={'thread':{'id':'fixture'}}
 if m=='mcpServerStatus/list': result={'data':[]}
 if m=='turn/start':
  open(${JSON.stringify(counter)},'a').write('started\\n')
  sys.exit(19)
 print(json.dumps({'id':i,'result':result}),flush=True)
`);await chmod(executable,0o700);
 vi.stubEnv('CODEX_HOME',join(root,'codex'));vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:1,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1});
 const job={id:'IMG-crash',prompt:'A blue square',source:'queue',width:32,height:32,transparent:false,referenceIds:[],status:'queued'} as unknown as Job;
 await appendQueue(queue,job,[]);await store.put('jobs',job.id,job);
 const first=await startLocalRunner(store);
 try {await vi.waitFor(async()=>expect((await store.get<Job>('jobs',job.id))?.status).toBe('uncertain'),{timeout:25000});}finally{await first?.stop();}
 expect((await store.list<any>('local-attempts'))[0].state).toBe('uncertain');
 const before=await readFile(join(queue,'images-todo.md'),'utf8');expect(parseQueue(before)[0].status).not.toBe('done');
 const second=await startLocalRunner(store);
 try {await second?.wake();expect(second?.status().enabled).toBe(1);expect(second?.status().blockedReason).toBeUndefined();expect(await readFile(counter,'utf8')).toBe('started\n');expect(await readFile(join(queue,'images-todo.md'),'utf8')).toBe(before);}finally{await second?.stop();}
},45000);

it('keeps quota-exhausted work pending and stores a verified reset time',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-quota-runner-'));roots.push(root);
 const queue=join(root,'queue');await mkdir(queue);await copyFile(resolve('docs/protocol/worker.py'),join(queue,'worker.py'));await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 const executable=join(root,'codex');
 await writeFile(executable,`#!/usr/bin/env python3
import sys,json
if sys.argv[1:]==['--version']: print('codex-cli 0.167.1');sys.exit(0)
if sys.argv[1:]==['login','status']: print('Logged in using ChatGPT');sys.exit(0)
for line in sys.stdin:
 x=json.loads(line)
 if 'id' not in x:continue
 r={'rateLimits':{'primary':{'usedPercent':100,'resetsAt':2000000000}}} if x.get('method')=='account/rateLimits/read' else {}
 print(json.dumps({'id':x['id'],'result':r}),flush=True)
`);await chmod(executable,0o700);
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:1,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1});
 await appendQueue(queue,{id:'IMG-quota',prompt:'A circle',width:32,height:32,transparent:false,referenceIds:[]} as unknown as Job,[]);
 const runner=await startLocalRunner(store);
 try {
  await vi.waitFor(()=>expect(runner?.status().blockedReason).toContain('Resets at'),{timeout:5000});
  expect(await store.get('settings','codex-usage')).toMatchObject({state:'exhausted',resetAt:new Date(2000000000*1000).toISOString()});
  expect(parseQueue(await readFile(join(queue,'images-todo.md'),'utf8'))[0].status).toBe('pending');
  expect(await store.list('local-attempts')).toHaveLength(0);
 }finally{await runner?.stop();}
},10000);

it('does not claim work when Codex is signed out',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-signedout-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 const executable=join(root,'codex');await writeFile(executable,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.167.1"; else echo "Not logged in"; fi\n');await chmod(executable,0o700);
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','worker-pool',{workers:1,idleMinutes:5,activeMinutes:1,activityWindowMinutes:10});await store.put('settings','local-runner',{workers:1});
 await appendQueue(queue,{id:'IMG-signedout',prompt:'A circle',width:32,height:32,transparent:false,referenceIds:[]} as unknown as Job,[]);
 const runner=await startLocalRunner(store);
 try{await vi.waitFor(()=>expect(runner?.status().blockedReason).toContain('Sign in'),{timeout:5000});expect(await store.list('runner-leases')).toHaveLength(0);expect(parseQueue(await readFile(join(queue,'images-todo.md'),'utf8'))[0].status).toBe('pending');}finally{await runner?.stop();}
});

it('defaults to a paused local executor without enabling old scheduled slots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-default-runner-'));roots.push(root);
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR',undefined);vi.stubEnv('EXECUTOR',undefined);vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',process.execPath);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:join(root,'queue'),referenceDirectories:[root]});
 const runner=await startLocalRunner(store);
 try{expect(runner?.status()).toMatchObject({mode:'local',running:0,enabled:0});expect((await store.get<any>('settings','worker-pool')).workers).toBe(0);}finally{await runner?.stop();}
});
it('preserves explicit scheduled compatibility mode',async()=>{
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','scheduled');expect(await startLocalRunner(new FileStorage('/unused'))).toBeUndefined();
});

it('finds an installed CLI on Check again without restarting the application',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-install-recheck-'));roots.push(root);
 const executable=join(root,'codex'),queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 vi.stubEnv('IMAGE_QUEUE_EXECUTOR','local');vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',executable);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','local-runner',{workers:1});
 const runner=await startLocalRunner(store);
 try {
  expect(runner?.status().blockedReason).toContain('Codex CLI');
  expect(runner?.status().desiredWorkers).toBe(1);
  await writeFile(executable,'#!/bin/sh\nexit 0\n');await chmod(executable,0o700);
  await runner?.wake(true);
  expect(runner?.status()).toMatchObject({enabled:1,desiredWorkers:1,blockedReason:undefined});
 }finally{await runner?.stop();}
});

it('restores only a scheduled pre-generation quota block after its reset',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-reset-restart-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',process.execPath);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});
 await store.put('settings','local-runner',{workers:2,blockedReason:'Codex limit reached.',resumeAt:new Date(Date.now()+150).toISOString()});
 const runner=await startLocalRunner(store);
 try{expect(runner?.status().desiredWorkers).toBe(2);await vi.waitFor(()=>expect(runner?.status().enabled).toBe(2));expect(runner?.status().blockedReason).toBeUndefined();expect(await store.get('settings','local-runner')).toEqual({workers:2,paused:false});}finally{await runner?.stop();}
});

it('pauses without losing desired concurrency or resuming on a queue wake',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-paused-'));roots.push(root);const queue=join(root,'queue');await mkdir(queue);await writeFile(join(queue,'images-todo.md'),'# Image requests\n');
 vi.stubEnv('IMAGE_QUEUE_STORAGE_DIR',join(root,'store'));vi.stubEnv('IMAGE_QUEUE_CODEX_BIN',process.execPath);
 const store=new FileStorage(join(root,'store'));await store.put('settings','paths',{queueDirectory:queue,referenceDirectories:[root]});await store.put('settings','local-runner',{workers:3,paused:false});
 const runner=await startLocalRunner(store);
 try {
  await store.put('settings','local-runner',{workers:3,paused:true});await runner?.wake();expect(runner?.status()).toMatchObject({desiredWorkers:3,enabled:0,paused:true});
  await runner?.wake();expect(runner?.status().enabled).toBe(0);
  await store.put('settings','local-runner',{workers:3,paused:false});await runner?.wake(true);expect(runner?.status()).toMatchObject({desiredWorkers:3,enabled:3,paused:false});
 }finally{await runner?.stop();}
});

it("releases the executor after shutdown even if its heartbeat cannot be removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "iq-stop-"));
  roots.push(root);
  vi.stubEnv("IMAGE_QUEUE_EXECUTOR", "local");
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DIR", join(root, "store"));
  vi.stubEnv("IMAGE_QUEUE_CODEX_BIN", process.execPath);
  const store = new FileStorage(join(root, "store"));
  await store.put("settings", "paths", { queueDirectory: join(root, "queue"), referenceDirectories: [root] });
  const runner = await startLocalRunner(store);
  const remove = vi.spyOn(store, "delete").mockRejectedValueOnce(new Error("Status unavailable"));
  await expect(runner!.stop()).rejects.toThrow("Status unavailable");
  remove.mockRestore();
  const restarted = await startLocalRunner(store);
  try { expect(restarted?.status().paused).toBe(true); }
  finally { await restarted?.stop(); }
});
