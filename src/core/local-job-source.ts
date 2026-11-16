import type {Storage} from '../storage/types';
import type {JobSource,ClaimedJob,RunnerCapability,RunnerFailure,RunnerResult} from './job-source';
export interface RunnableJob {id:string;capability:RunnerCapability}
interface Lease {id:string;jobId:string;runnerId:string;expiresAt:number;startedAt?:number;state:'active'|'complete'|'failed'|'uncertain'}
export interface LocalSourceHooks<T extends RunnableJob> {
 next(capabilities:RunnerCapability[], excludedJobIds:ReadonlySet<string>, runnerId:string):Promise<T|null>;
 complete(jobId:string,result:RunnerResult):Promise<void>;
 fail(jobId:string,error:RunnerFailure):Promise<void>;
}
/** One lock orders claims; leased work is never selected twice after an ambiguous run. */
export class LocalJobSource<T extends RunnableJob> implements JobSource<T> {
 constructor(private store:Storage,private hooks:LocalSourceHooks<T>,private now=Date.now,private leaseMs=60000){}
 async claim(runnerId:string,capabilities:RunnerCapability[]):Promise<ClaimedJob<T>|null>{
  if(!runnerId.trim()||!capabilities.length)throw new Error('Runner identity and capabilities required');
  return this.store.lock('local-runner-claims',async()=>{
   await this.recoverExpired();
   const leases=await this.store.list<Lease>('runner-leases');
   const excluded=new Set(leases.map(l=>l.jobId));
   const job=await this.hooks.next(capabilities,excluded,runnerId);if(!job)return null;
   if(!capabilities.includes(job.capability))throw new Error('Unsupported runner capability');
   if(excluded.has(job.id))return null;
   const lease:Lease={id:crypto.randomUUID(),jobId:job.id,runnerId,expiresAt:this.now()+this.leaseMs,state:'active'};
   await this.store.put('runner-leases',lease.id,lease);
   return {job,leaseId:lease.id,expiresAt:new Date(lease.expiresAt).toISOString()};
  });
 }
 private async active(jobId:string,id:string){
  const lease=await this.store.get<Lease>('runner-leases',id);
  if(!lease||lease.jobId!==jobId||lease.state!=='active'||lease.expiresAt<=this.now())throw new Error('Runner lease is no longer active');
  return lease;
 }
 async start(jobId:string,id:string){
  await this.store.lock('local-runner-claims',async()=>{const l=await this.active(jobId,id);await this.store.put('runner-leases',id,{...l,startedAt:this.now()});});
 }
 async heartbeat(jobId:string,id:string){
  await this.store.lock('local-runner-claims',async()=>{const l=await this.active(jobId,id);await this.store.put('runner-leases',id,{...l,expiresAt:this.now()+this.leaseMs});});
 }
 async complete(jobId:string,id:string,result:RunnerResult){
  await this.store.lock('local-runner-claims',async()=>{
   const l=await this.active(jobId,id);
   if(l.startedAt===undefined)throw new Error('Generation has not started');
   if(!/^[a-f0-9]{64}$/.test(result.blobKey)||!Number.isInteger(result.width)||result.width<1||!Number.isInteger(result.height)||result.height<1||result.mime!=='image/png')throw new Error('Invalid generated result');
   await this.hooks.complete(jobId,result);await this.store.put('runner-leases',id,{...l,state:'complete'});
  });
 }
 async fail(jobId:string,id:string,error:RunnerFailure){
  await this.store.lock('local-runner-claims',async()=>{const l=await this.active(jobId,id);await this.hooks.fail(jobId,error);await this.store.put('runner-leases',id,{...l,state:error.uncertain?'uncertain':'failed'});});
 }
 /** Caller must hold exclusive executor ownership before using this. */
 async recoverAfterRestart(){await this.recoverExpired(true);}
 private async recoverExpired(all=false){
  for(const l of await this.store.list<Lease>('runner-leases'))if(l.state==='active'&&(all||l.expiresAt<=this.now())){
   if(l.startedAt===undefined){await this.store.delete('runner-leases',l.id);continue;}
   await this.hooks.fail(l.jobId,{code:'lease_expired',message:'Execution interrupted; verify the result before retrying.',uncertain:true});
   await this.store.put('runner-leases',l.id,{...l,state:'uncertain'});
  }
 }
}
