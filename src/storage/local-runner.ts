import {admitted, globalPause, processingLock, recordDelivery, recordFailure, resumeAfterReset, sourceControls} from "../core/processing";
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
  const unavailable:LocalRunner={
   async wake(resume=false){
    if(stopped)return;
    if(delegate)return delegate.wake(resume);
    const config=await sourceControls(store,'queue');desiredWorkers=config.workers;paused=config.paused||await globalPause(store);
    if(!resume && (paused || config.blockedReason))return;
    if(!checking)checking=(async()=>{
     desiredWorkers=(await readLocalRunnerSettings(store))?.workers??1;paused=(await readLocalRunnerSettings(store))?.paused??true;
     try{await resolveExecutable(configuration('CODEX_BIN')??'codex');}catch{return;}
     delegate=await startLocalRunner(store);
     clearInterval(timer);
     if(stopped)await delegate?.stop();else await delegate?.wake(resume);
    })().finally(()=>{checking=undefined;});
    await checking;
   },
   status(){return delegate?.status()??{mode:'local',running:0,enabled:0,desiredWorkers,paused,blockedReason,canResume:true};},
   async stop(){stopped=true;clearInterval(timer);await heartbeat;await checking;if(delegate)await delegate.stop();else await store.delete('processing-heartbeats','queue');},
  };
  let heartbeat:Promise<void>|undefined;
  const publish=async()=>{
   if(!delegate && !stopped)await store.put('processing-heartbeats','queue',{at:Date.now(),running:0,blockedReason});
  };
  await publish();
  const timer=setInterval(()=>{heartbeat??=(async()=>{await unavailable.wake();await publish();})().catch(()=>console.error('Could not check Codex availability.')).finally(()=>{heartbeat=undefined;});},5000);
  timer.unref();
  return unavailable;
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
   if(stopped||!config?.workers || !(await resumeAfterReset(store,'queue',resetAt)))return;
   if(stopped)return;
   scheduledReset=undefined;
   desiredWorkers=config.workers;
   executor?.configure(config.workers);
  });
 };
 // Hold an OS-backed exclusive lock for this executor's entire lifetime.
 const lifetime=store.lock('local-executor',async()=>{
  await prepareLocalQueue(paths.queueDirectory,process.cwd());
  if(!saved)await processingLock(store,async()=>{if(!await readLocalRunnerSettings(store))await store.put('settings','local-runner',{workers:localCount,paused});});
  if(pool.workers!==0)await savePoolConfig(store,{...pool,workers:0});
  const recovered=await recoverLocalAttempts(store);
  await source.recoverAfterRestart();
  for(const attempt of recovered){const job=await store.get<import('../core/schema').Job>('jobs',attempt.jobId);if(job && job.status!=='done')await store.put('jobs',job.id,{...job,status:'uncertain',error:'Local execution was interrupted. Verify the result before retrying.'});}
  executor=createLocalExecutor<import('./queue-worker-source').QueueExecutionJob>({source,generation:localGeneration(store,runRoot,executable),runnerId:'local',capabilities:['codex-image'],
   admit:claim=>processingLock(store,async()=>await admitted(store,'queue') && executor!.running < (await sourceControls(store,'queue')).workers ? claim() : null),
   failed:async(message,id)=>{const stop=/^Codex (usage limit reached|is not signed in)|^The selected Codex model is unavailable/.test(message);const reason=await recordFailure(store,'queue',message,{id,stop});if(reason)blockedJobId=id;return reason;},
   delivered:()=>recordDelivery(store,'queue').catch(()=>console.error('Could not record last Codex delivery.')),
   hasPending:()=>source.hasPending(),
   beforeClaim:async()=>{
    admissionReset=undefined;
    await checkCodexVersion(executable);
    const login=await readCodexLogin(executable);
    await store.put('connection-checks','codex',{login,checkedAt:new Date().toISOString()});
    if(login!=='chatgpt')throw new UserFacingError(login==='api-key'
      ? 'Codex uses an API key. Sign in with ChatGPT to use your plan.'
      : 'Sign in to Codex with ChatGPT before starting local generation.');
    const usage=await readCodexUsage(executable);
    await store.put('settings','codex-usage',usage);
    if(usage.state==='exhausted'){
      admissionReset=usage.resetAt;
      throw new UserFacingError(usage.resetAt?`Codex limit reached. Resets at ${usage.resetAt}.`:'Codex limit reached. Check your plan before resuming.');
    }
   },
   blocked:async (blockedReason,phase,jobId)=>{
    blockedJobId=jobId;
    const resumeAt=phase==='admission'?admissionReset:undefined;
    admissionReset=undefined;
    await recordFailure(store,'queue',blockedReason,{id:jobId,stop:true,resumeAt});
    const settings=await sourceControls(store,'queue');
    armResume(!settings.paused?settings.resumeAt:undefined);
   },
   report:error=>console.error('Local image execution requires attention.',error instanceof Error?`${error.name}: ${error.message}`:''),
  });
  stopWatching=watchQueue(paths.queueDirectory,()=>executor?.wake());
  paused=paused||await globalPause(store);
  executor.configure(saved?.blockedReason||paused?0:localCount);if(saved?.blockedReason)executor.block(saved.blockedReason);if(saved?.workers&&!paused)armResume(saved.resumeAt);startedResolve();await new Promise<void>(r=>{release=r});
 }).catch(error=>{stopWatching?.();failure=error;startedResolve();});
 await started;if(failure)throw failure;
 let refreshing:Promise<void>|undefined;
 async function refresh(resume=false){
   if(stopped)return;
   if(resume)await processingLock(store,async()=>{
     const current=await sourceControls(store,"queue");
     if(current.paused || await globalPause(store))return;
     delete current.blockedReason;delete current.blockedJobId;delete current.resumeAt;delete current.failures;
     await store.put("settings","local-runner",current);
   });
   const config=await sourceControls(store,"queue");
   desiredWorkers=config.workers;paused=config.paused||await globalPause(store);
   blockedJobId=config.blockedJobId;
   if(paused || config.blockedReason) {
     if(executor!.enabled!==0)executor!.configure(0);
     if(config.blockedReason)executor!.block(config.blockedReason);
     if(paused){cancelResume();scheduledReset=undefined;}
     else if(config.resumeAt!==scheduledReset)armResume(config.resumeAt);
   } else {
     if(executor!.blockedReason || executor!.enabled!==desiredWorkers)executor!.configure(desiredWorkers);
     else if(resume)executor!.wake();
   }
 }
 async function heartbeat(){
   await refresh();
   if(!stopped)await store.put('processing-heartbeats','queue',{at:Date.now(),running:executor!.running,blockedReason:executor!.blockedReason});
 }
 let timer: ReturnType<typeof setInterval> | undefined;
 async function stop() {
   stopped = true;
   clearInterval(timer);
   cancelResume();
   stopWatching?.();
   executor!.stop();
   try {
     await refreshing;
     while (executor!.settling) await new Promise(resolve => setTimeout(resolve, 50));
     await store.delete("processing-heartbeats", "queue");
   } finally {
     release();
     await lifetime;
   }
 }
 try {
   await heartbeat();
 } catch (error) {
   await stop().catch(() => console.error("Could not remove local execution status."));
   throw error;
 }
 timer=setInterval(()=>{refreshing??=heartbeat().catch(()=>console.error('Could not update local processing status.')).finally(()=>{refreshing=undefined});},5000);
 timer.unref();
 return {
  async wake(resume=false){await refresh(resume);executor!.wake();},
  status(){return {mode:'local',running:executor!.running,enabled:executor!.enabled,desiredWorkers,paused,resumeAt:scheduledReset,blockedJobId,blockedReason:executor!.blockedReason};},
  stop,
 };
}
