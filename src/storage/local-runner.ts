import {mkdir} from 'node:fs/promises';
import {scheduleQuotaResume} from '../core/local-runner-resume';
import {watchQueue} from './watch-queue';
import path from 'node:path';
import type {Storage} from './types';
import {configuration} from '../core/config';
import {poolConfig,savePoolConfig} from '../core/pool';
import {pathSettings} from '../core/paths';
import {createLocalExecutor} from '../core/local-executor';
import {recoverLocalAttempts} from '../core/local-worker-attempt';
import {queueWorkerSource} from './queue-worker-source';
import {localGeneration} from './local-generation';
import {prepareLocalQueue} from './prepare-local-queue';
import {resolveExecutable} from './resolve-executable';
import {readCodexUsage} from './codex-usage';
import {readCodexLogin} from './codex-login';
import {checkCodexVersion} from './codex-version';
import {UserFacingError} from '../core/user-facing-error';
import {readLocalRunnerSettings} from '../core/local-runner-settings';
/** Local execution is the default; legacy scheduled mode is explicit. */
export interface LocalRunner { wake(resume?:boolean):Promise<void>; status():{mode:string;running:number;enabled:number;desiredWorkers:number;paused:boolean;blockedReason?:string;blockedJobId?:string;canResume?:boolean;resumeAt?:string}; stop():Promise<void> }
export async function startLocalRunner(store:Storage):Promise<LocalRunner|undefined> {
 if(configuration('EXECUTOR')==='scheduled')return undefined;
 let executable:string;
 try { executable=await resolveExecutable(configuration('CODEX_BIN')??'codex'); }
 catch {
  const blockedReason=process.platform==='darwin'?'Codex CLI is unavailable. Install it, then check again.':'Codex CLI could not be located on this untested platform. Set IMAGE_QUEUE_CODEX_BIN, then check again.';
  let delegate:LocalRunner|undefined;
  let checking:Promise<void>|undefined;
  let desiredWorkers=(await readLocalRunnerSettings(store))?.workers??1;
  let paused=(await readLocalRunnerSettings(store))?.paused??true;
  let stopped=false;
  return {
   async wake(resume=false){
    if(stopped)return;
    if(delegate)return delegate.wake(resume);
    if(!resume){const config=await readLocalRunnerSettings(store);desiredWorkers=config?.workers??1;paused=config?.paused??true;return;}
    if(!checking)checking=(async()=>{
     desiredWorkers=(await readLocalRunnerSettings(store))?.workers??1;paused=(await readLocalRunnerSettings(store))?.paused??true;
     try{await resolveExecutable(configuration('CODEX_BIN')??'codex');}catch{return;}
     delegate=await startLocalRunner(store);
     if(stopped)await delegate?.stop();else await delegate?.wake(true);
    })().finally(()=>{checking=undefined;});
    await checking;
   },
   status(){return delegate?.status()??{mode:'local',running:0,enabled:0,desiredWorkers,paused,blockedReason,canResume:true};},
   async stop(){stopped=true;await checking;await delegate?.stop();},
  };
 }
 const root=configuration('STORAGE_DIR')??path.join(process.cwd(),'storage');
 const runRoot=path.join(root,'generation-runs');await mkdir(runRoot,{recursive:true,mode:0o700});
 const pool=await poolConfig(store);const paths=await pathSettings(store);
 // Preserve the local count separately; the old chat gate must take no new work.
 const saved=await readLocalRunnerSettings(store);
 const localCount=saved?.workers??1;
 let paused=saved?.paused??true;
 let desiredWorkers=localCount;

 const source=queueWorkerSource(store,{queueRoot:paths.queueDirectory,workerId:'local',model:pool.workerModel??'gpt-6.1-sol',effort:pool.workerEffort??'low'});
 let executor:ReturnType<typeof createLocalExecutor<import('./queue-worker-source').QueueExecutionJob>>|undefined;
 let stopWatching:(()=>void)|undefined;
 let release:()=>void=()=>{};
 let startedResolve:()=>void=()=>{};const started=new Promise<void>(r=>{startedResolve=r});
 let failure:unknown;
 let blockedJobId=saved?.blockedJobId;
 let admissionReset:string|undefined;
 let scheduledReset:string|undefined;
 let stopped=false;
 let cancelResume=()=>{};
 const armResume=(resetAt?:string)=>{
  cancelResume();
  scheduledReset=resetAt;
  if(resetAt)cancelResume=scheduleQuotaResume(resetAt,async()=>{
   const config=await readLocalRunnerSettings(store);
   if(stopped||!config?.workers||config.paused||config.resumeAt!==resetAt)return;
   await store.put('settings','local-runner',{workers:config.workers,paused:false});
   if(stopped)return;
   scheduledReset=undefined;
   desiredWorkers=config.workers;
   executor?.configure(config.workers);
  });
 };
 // Hold an OS-backed exclusive lock for this executor's entire lifetime.
 const lifetime=store.lock('local-executor',async()=>{
  await prepareLocalQueue(paths.queueDirectory,process.cwd());
  if(!saved)await store.put('settings','local-runner',{workers:localCount,paused});
  if(pool.workers!==0)await savePoolConfig(store,{...pool,workers:0});
  const recovered=await recoverLocalAttempts(store);
  await source.recoverAfterRestart();
  for(const attempt of recovered){const job=await store.get<import('../core/schema').Job>('jobs',attempt.jobId);if(job)await store.put('jobs',job.id,{...job,status:'uncertain',error:'Local execution was interrupted. Verify the result before retrying.'});}
  executor=createLocalExecutor<import('./queue-worker-source').QueueExecutionJob>({source,generation:localGeneration(store,runRoot,executable),runnerId:'local',capabilities:['codex-image'],hasPending:()=>source.hasPending(),beforeClaim:async()=>{admissionReset=undefined;await checkCodexVersion(executable);const login=await readCodexLogin(executable);if(login!=='chatgpt')throw new UserFacingError(login==='api-key'?'Codex uses an API key. Sign in with ChatGPT to use your plan.':'Sign in to Codex with ChatGPT before starting local generation.');const usage=await readCodexUsage(executable);await store.put('settings','codex-usage',usage);if(usage.state==='exhausted'){admissionReset=usage.resetAt;throw new UserFacingError(usage.resetAt?`Codex limit reached. Resets at ${usage.resetAt}.`:'Codex limit reached. Check your plan before resuming.');}},blocked:async (blockedReason,phase,jobId)=>{blockedJobId=jobId;const settings=await readLocalRunnerSettings(store);const resumeAt=phase==='admission'?admissionReset:undefined;admissionReset=undefined;await store.put('settings','local-runner',{workers:settings?.workers??1,paused:settings?.paused??true,blockedReason,...(jobId?{blockedJobId:jobId}:{}),...(resumeAt?{resumeAt}:{})});armResume(settings?.workers&&!settings.paused?resumeAt:undefined);},report:()=>console.error('Local image execution requires attention.')});
  stopWatching=watchQueue(paths.queueDirectory,()=>executor?.wake());
  executor.configure(saved?.blockedReason||paused?0:localCount);if(saved?.blockedReason)executor.block(saved.blockedReason);if(saved?.workers&&!paused)armResume(saved.resumeAt);startedResolve();await new Promise<void>(r=>{release=r});
 }).catch(error=>{stopWatching?.();failure=error;startedResolve();});
 await started;if(failure)throw failure;
 return {
  async wake(resume=false){
   const config=await readLocalRunnerSettings(store);
   desiredWorkers=config?.workers??1;paused=config?.paused??true;
   if(paused){cancelResume();scheduledReset=undefined;executor!.configure(0);return;}
   if(resume){blockedJobId=undefined;cancelResume();scheduledReset=undefined;await store.put('settings','local-runner',{workers:desiredWorkers,paused:false});}
   if(resume||(!config?.blockedReason&&desiredWorkers!==executor!.enabled))executor!.configure(desiredWorkers);
   executor!.wake();
  },
  status(){return {mode:'local',running:executor!.running,enabled:executor!.enabled,desiredWorkers,paused,resumeAt:scheduledReset,blockedJobId,blockedReason:executor!.blockedReason};},
  async stop(){stopped=true;cancelResume();stopWatching?.();executor!.stop();while(executor!.settling)await new Promise(r=>setTimeout(r,50));release();await lifetime;},
 };
}
