import {UserFacingError} from './user-facing-error';
import {LocalGenerationError} from './local-generation-error';
import {LocalWorkerPool} from './local-worker-pool';
import type {JobSource,RunnerCapability,RunnerResult,ClaimedJob} from './job-source';
export interface ExecutorJob {id:string}
export interface ExecutorGeneration<T extends ExecutorJob> {
 /** Commit the attempt before the process is launched. */
 prepare(job:T):Promise<void>;
 published?(jobId:string):Promise<void>;
 uncertain?(jobId:string, error?:unknown):Promise<void>;
 generate(job:T,signal:AbortSignal):Promise<RunnerResult>;
}
/** Binds scheduling to the same source contract used by a future remote runner. */
export function createLocalExecutor<T extends ExecutorJob>(options:{
 admit?(claim:()=>Promise<ClaimedJob<T>|null>):Promise<ClaimedJob<T>|null>;
 failed?(message:string,id:string):Promise<string|undefined>;
 delivered?():Promise<void>;
 source:JobSource<T>;generation:ExecutorGeneration<T>;runnerId:string;
 capabilities:RunnerCapability[];heartbeatMs?:number;hasPending?():Promise<boolean>;beforeClaim?():Promise<void>;report(error:unknown):void;blocked?(message:string,phase:'admission'|'generation',jobId?:string):Promise<void>;
}) {
 type Work={id:string;claim:ClaimedJob<T>;result?:RunnerResult};
 return new LocalWorkerPool<Work>({
  claim:async(allowed)=>{
   if(options.hasPending && !(await options.hasPending()))return undefined;
   await options.beforeClaim?.();
   if(!allowed())return undefined;
   const acquire=()=>options.source.claim(`${options.runnerId}:${crypto.randomUUID()}`,options.capabilities);
   const claim=options.admit?await options.admit(acquire):await acquire();
   return claim?{id:claim.job.id,claim}:undefined;
  },
  begin:async work=>{await options.generation.prepare(work.claim.job);await options.source.start?.(work.id,work.claim.leaseId);},
  execute:async(work,signal)=>{
   const controller=new AbortController();
   const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)controller.abort();
   let failure:unknown;
   let pending:Promise<void>|undefined;
   const timer=setInterval(()=>{
    if(pending||failure)return;
    pending=options.source.heartbeat(work.id,work.claim.leaseId).catch(error=>{failure=error;controller.abort();}).finally(()=>{pending=undefined;});
   },options.heartbeatMs??15000);
   try {
    work.result=await options.generation.generate(work.claim.job,controller.signal);
    await pending;
    if(failure)throw failure;
    if(controller.signal.aborted)throw new Error('Execution interrupted');
   } finally {clearInterval(timer);signal.removeEventListener('abort',abort);await pending;}
  },
  complete:async work=>{
   if(!work.result)throw new Error('Generation result missing');
   await options.source.complete(work.id,work.claim.leaseId,work.result);
   await options.generation.published?.(work.id);
   await options.delivered?.();
  },
  uncertain:async(work,error)=>{
   await options.generation.uncertain?.(work.id,error);
   await options.source.fail(work.id,work.claim.leaseId,{
    code:error instanceof LocalGenerationError?error.code:'execution_interrupted',
    message:error instanceof UserFacingError?error.message:'Generation did not complete locally. Verify the result before retrying.',
    uncertain:error instanceof LocalGenerationError?error.uncertain:true,
   });
  },
  report:options.report,blocked:options.blocked,failed:options.failed,
 });
}
