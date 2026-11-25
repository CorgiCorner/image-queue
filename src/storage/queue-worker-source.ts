import {createInterface} from 'node:readline';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Storage} from './types';
import {RejectedQueueRequest} from '../core/local-worker-pool';
import {LocalJobSource,type LocalSourceHooks} from '../core/local-job-source';
import {codexReferenceLimitError} from '../core/local-generation-error';
import type {LocalAttempt} from '../core/local-worker-attempt';
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
 const bundled = path.resolve('docs/protocol/worker.py');
 const installed = path.join(options.queueRoot,'worker.py');
 let command:Promise<string>|undefined;
 async function helper(args:string[]) {
  // Use the compatible, upgraded helper for a stock v0.1.3 installation. Preserve custom helpers.
  command ??= readFile(installed).then(async bytes=>
    (await hash(bytes))==='f2b353d0fe9414b40425822af4410ce67df8e0544e2baecb703fb6034826c822' ? bundled : installed);
  const result=await exec(options.python??'python3',[await command,'--root',options.queueRoot,...args],{maxBuffer:1024*1024});
  return JSON.parse(result.stdout);
 }
 async function candidate(excluded:ReadonlySet<string>) {
  const child=spawn(options.python??'python3',[bundled,'--root',options.queueRoot,'candidates'],{stdio:['ignore','pipe','ignore']});
  const lines=createInterface({input:child.stdout});
  const finished=new Promise<void>((resolve,reject)=>{
   child.once('error',reject);
   child.once('close',code=>code===0?resolve():reject(new Error('Could not inspect the queue protocol')));
  });
  let pending=false;
  let blocked=false;
  let owner:string|undefined;
  await Promise.all([finished,(async()=>{
   for await(const line of lines){
    const row=JSON.parse(line) as {id:string;worker?:string};
    if(!row.worker){if(!excluded.has(row.id))pending=true;continue;}
    if(!row.worker.startsWith('local:')){
     const job=await store.get<Job>('jobs',row.id);
     if(!job?.reservationReviewedAt || !Number.isFinite(Date.parse(job.reservationReviewedAt)) || job.claim?.owner!==row.worker || !['uncertain','failed'].includes(job.status))blocked=true;
    } else if(!owner&&!excluded.has(row.id)&&!claims.has(row.id)){
     const pointer=await store.get<string>('attempt-by-job',row.id);
     const attempt=pointer && await store.get<{startedAt?:string;state:string}>('local-attempts',pointer);
     if(!attempt || (!attempt.startedAt && attempt.state!=='uncertain' && attempt.state!=='failed'))owner=row.worker;
    }
   }
  })()]);
  return blocked ? undefined : owner ? {owner} : pending ? {owner:undefined} : undefined;
 }
 async function hasPending(){return !!await candidate(new Set());}
 const hooks:LocalSourceHooks<QueueExecutionJob>={
  async next(_capabilities,excluded,runnerId){
   const selection=await candidate(excluded);
   if(!selection)return null;
   const claimOwner=selection.owner??runnerId;
   const claim=await helper(['claim','--worker',claimOwner]) as Claim&{job?:null};
   if(claim.job===null)return null;
   if((claim.already_owned&&!selection.owner)||excluded.has(claim.id))throw new Error('Existing reservation requires recovery; automatic generation refused');
   const message=claim.generation.ready
    ? codexReferenceLimitError(claim.generation.referencePaths.length)
    : claim.generation.error??'Invalid request';
   if(message){
    await helper(['finish','--worker',claim.worker,'--id',claim.id,'--token',claim.token,'--status','blocked','--reason',message]);
    const job=await store.get<Job>('jobs',claim.id);
    if(job)await store.put('jobs',claim.id,{...job,status:'blocked',error:message,updatedAt:new Date().toISOString()});
    throw new RejectedQueueRequest(claim.id,message);
   }
   claims.set(claim.id,claim);
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
  async recordedFailure(id){
   const pointer=await store.get<string>('attempt-by-job',id);
   const attempt=pointer?await store.get<LocalAttempt>('local-attempts',pointer):undefined;
   if(attempt?.state==='failed'&&attempt.error)return {code:'recorded_failure',message:attempt.error,uncertain:false};
  },
  async fail(id,error){
   const job=await store.get<Job>('jobs',id);
   if(job?.status==='done'){claims.delete(id);return;}
   if(job?.outputPath){
    const observed=await (await queueInspector(options.queueRoot))(job);
    // The helper validates delivery and receipt before committing done. A crash
    // between that commit and our metadata write must preserve the delivered image.
    if(observed.status==='done' && observed.generatedSize){
     await store.put('jobs',id,{...job,...observed,claim:undefined,error:undefined,updatedAt:new Date().toISOString()});
     claims.delete(id);
     return;
    }
   }
   if(!error.uncertain){
    let claim:Pick<Claim,'worker'|'token'>|undefined=claims.get(id);
    if(error.code==='recorded_failure'){
     const rows=await helper(['list']) as {id:string;reservation?:{worker:string;token:string;state:string}}[];
     const reservation=rows.find(row=>row.id===id)?.reservation;
     claim=reservation?.state==='reserved'&&reservation.worker.startsWith('local:')?reservation:undefined;
    }
    if(claim){
     const reason=error.code==='reference_limit'?error.message:'Codex did not start image generation.';
     await helper(['finish','--worker',claim.worker,'--id',id,'--token',claim.token,'--status','blocked','--reason',reason]);
    }
   }
   // An ambiguous result keeps its protocol reservation.
   if(job)await store.put('jobs',id,{...job,status:error.uncertain?'uncertain':'failed',error:error.message,
    ...(!error.uncertain?{claim:undefined}:{}),updatedAt:new Date().toISOString()});
   claims.delete(id);
  },
 };
 return Object.assign(new LocalJobSource(store,hooks),{hasPending});
}
