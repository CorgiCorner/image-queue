import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Storage} from './types';
import {LocalJobSource,type LocalSourceHooks} from '../core/local-job-source';
import type {LocalGenerationJob} from './local-generation';
import type {RunnerResult} from '../core/job-source';
import {hash,type Job} from '../core/schema';
import {imageSize} from 'image-size';
import {queueInspector} from '../sources/queue';
import {poolConfig} from '../core/pool';
const exec=promisify(execFile);
interface Claim {id:string;token:string;worker:string;already_owned:boolean;generation:{ready:boolean;error?:string;toolArguments:{prompt:string;transparent_background:boolean};referencePaths:string[];width:number;height:number}}
export type QueueExecutionJob=LocalGenerationJob&{capability:'codex-image'};
/** Only this execution adapter claims/publishes; the UI queue adapter stays an observer. */
export function queueWorkerSource(store:Storage,options:{queueRoot:string;workerId:string;model:LocalGenerationJob['model'];effort:LocalGenerationJob['effort'];python?:string}) {
 const claims=new Map<string,Claim>();
 async function legacyReservationBlocks(candidates:{id:string;reservation?:{worker:string;state:string}}[]) {
  for(const candidate of candidates) {
   if(candidate.reservation?.state!=='reserved'||candidate.reservation.worker.startsWith('local:'))continue;
   const job=await store.get<Job>('jobs',candidate.id);
   if(!job?.reservationReviewedAt || !Number.isFinite(Date.parse(job.reservationReviewedAt)) || job.claim?.owner!==candidate.reservation.worker || !['uncertain','failed'].includes(job.status))return true;
  }
  return false;
 }

 async function helper(args:string[]) {
  const result=await exec(options.python??'python3',[path.join(options.queueRoot,'worker.py'),'--root',options.queueRoot,...args],{maxBuffer:1024*1024});
  return JSON.parse(result.stdout);
 }
 async function hasPending() {
  const candidates=await helper(['list']) as {id:string;status:string;reservation?:{worker:string;state:string}}[];
  if(await legacyReservationBlocks(candidates))return false;
  const attempts=await store.list<{jobId:string;startedAt?:string;state:string}>('local-attempts');
  return candidates.some(c=>c.status==='pending'&&!c.reservation || c.reservation?.worker.startsWith('local:')&&!attempts.some(a=>a.jobId===c.id&&(a.startedAt||a.state==='uncertain')));
 }
 const hooks:LocalSourceHooks<QueueExecutionJob>={
  async next(_capabilities,excluded,runnerId){
   const candidates=await helper(['list']) as {id:string;status:string;reservation?:{worker:string;state:string}}[];
   // Drain legacy workers before the new executor takes any work.
   if(await legacyReservationBlocks(candidates))return null;
   const attempts=await store.list<{jobId:string;state:string;startedAt?:string}>('local-attempts');
   const resumable=candidates.find(c=>c.reservation?.worker.startsWith('local:')&&!excluded.has(c.id)&&!attempts.some(a=>a.jobId===c.id&&(a.startedAt||a.state==='uncertain')));
   const claimOwner=resumable?.reservation?.worker??runnerId;
   // Avoid acquiring an already ambiguous request or a legacy live reservation.
   if(!resumable&&!candidates.some(c=>c.status==='pending'&&!c.reservation&&!excluded.has(c.id)))return null;
   const claim=await helper(['claim','--worker',claimOwner]) as Claim&{job?:null};
   if(claim.job===null)return null;
   if((claim.already_owned&&!resumable)||excluded.has(claim.id))throw new Error('Existing reservation requires recovery; automatic generation refused');
   claims.set(claim.id,claim);
   if(!claim.generation.ready){await helper(['finish','--worker',claim.worker,'--id',claim.id,'--token',claim.token,'--status','blocked','--reason',claim.generation.error??'Invalid request']);return null;}
   const config=await poolConfig(store);
   return {id:claim.id,capability:'codex-image',prompt:claim.generation.toolArguments.prompt,references:claim.generation.referencePaths,width:claim.generation.width,height:claim.generation.height,transparent:claim.generation.toolArguments.transparent_background,model:config.workerModel??options.model,effort:config.workerEffort??options.effort};
  },
  async complete(id:string,result:RunnerResult){
   const claim=claims.get(id);if(!claim)throw new Error('Execution claim not found');
   const artifact=await store.get<{image:string;receipt:string;provenance:string}>('generation-artifacts',id);
   if(!artifact)throw new Error('Generation artifacts missing');
   const blob=await store.getBlob(result.blobKey);if(!blob)throw new Error('Generated content missing');
   if(await hash(blob.bytes)!==result.blobKey)throw new Error('Generated content hash mismatch');
   const dimensions=imageSize(blob.bytes);
   if(dimensions.type!=='png'||dimensions.width!==result.width||dimensions.height!==result.height)throw new Error('Generated content dimensions mismatch');
   await writeFile(artifact.image,blob.bytes,{mode:0o600});
   await helper(['publish','--worker',claim.worker,'--id',id,'--token',claim.token,'--source',artifact.image,'--prompt-source',artifact.provenance,'--generation-receipt',artifact.receipt]);
   await helper(['finish','--worker',claim.worker,'--id',id,'--token',claim.token,'--status','done']);
   const job=await store.get<Job>('jobs',id);
   if(job){
    const observed=job.outputPath?await (await queueInspector(options.queueRoot))(job):{};
    await store.put('jobs',id,{...job,...observed,status:'done',blobKey:result.blobKey,width:result.width,height:result.height,claim:undefined,error:undefined,updatedAt:new Date().toISOString()});
   }
   claims.delete(id);
  },
  async fail(id,error){
   // Retain the protocol reservation: uncertainty never makes it available twice.
   const job=await store.get<Job>('jobs',id);
   if(job)await store.put('jobs',id,{...job,status:error.uncertain?'uncertain':'failed',error:error.message,updatedAt:new Date().toISOString()});
  },
 };
 return Object.assign(new LocalJobSource(store,hooks),{hasPending});
}
