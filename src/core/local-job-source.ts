import type {Storage} from '../storage/types';
import {waitForLock} from '../storage/wait-for-lock';
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
 private ownedLeases?: Map<string,Lease>;
 private excludedIds?: Set<string>;
 private async save(lease:Lease) {
  await this.store.put('runner-leases',lease.id,lease);
  if(lease.state==="active")this.ownedLeases?.set(lease.id,lease);
  else this.ownedLeases?.delete(lease.id);
  this.excludedIds?.add(lease.jobId);
 }
 constructor(private store:Storage,private hooks:LocalSourceHooks<T>,private now=Date.now,private leaseMs=60000){}
 /**
  * Parallel workers contend for this lock routinely; wait rather than fail.
  * Half the lease (30 s of 60 s): a heartbeat that starts 15 s after the last
  * one and waits the full bound still lands 15 s before the lease expires.
  * The holder can keep the lock for a while (queue helper and project writes
  * each wait for their own locks), so a shorter bound would abort live work.
  */
 private claims<R>(work:()=>Promise<R>){return waitForLock(this.store,'local-runner-claims',work,this.leaseMs/2);}
 async claim(runnerId:string,capabilities:RunnerCapability[]):Promise<ClaimedJob<T>|null>{
  if(!runnerId.trim()||!capabilities.length)throw new Error('Runner identity and capabilities required');
  return this.claims(async()=>{
   const leases=this.ownedLeases ?? new Map((await this.store.list<Lease>('runner-leases')).map(l=>[l.id,l]));
   await this.recoverExpired(leases);
   const excluded=this.excludedIds ?? new Set(Array.from(leases.values(),l=>l.jobId));
   const job=await this.hooks.next(capabilities,excluded,runnerId);if(!job)return null;
   if(!capabilities.includes(job.capability))throw new Error('Unsupported runner capability');
   if(excluded.has(job.id))return null;
   const lease:Lease={id:crypto.randomUUID(),jobId:job.id,runnerId,expiresAt:this.now()+this.leaseMs,state:'active'};
   await this.save(lease);
   return {job,leaseId:lease.id,expiresAt:new Date(lease.expiresAt).toISOString()};
  });
 }
 private async active(jobId:string,id:string){
  const lease=await this.store.get<Lease>('runner-leases',id);
  if(!lease||lease.jobId!==jobId||lease.state!=='active'||lease.expiresAt<=this.now())throw new Error('Runner lease is no longer active');
  return lease;
 }
 async start(jobId:string,id:string){
  await this.claims(async()=>{const l=await this.active(jobId,id);await this.save({...l,startedAt:this.now()});});
 }
 async heartbeat(jobId:string,id:string){
  await this.claims(async()=>{const l=await this.active(jobId,id);await this.save({...l,expiresAt:this.now()+this.leaseMs});});
 }
 async complete(jobId:string,id:string,result:RunnerResult){
  await this.claims(async()=>{
   const l=await this.active(jobId,id);
   if(l.startedAt===undefined)throw new Error('Generation has not started');
   if(!/^[a-f0-9]{64}$/.test(result.blobKey)||!Number.isInteger(result.width)||result.width<1||!Number.isInteger(result.height)||result.height<1||result.mime!=='image/png')throw new Error('Invalid generated result');
   await this.hooks.complete(jobId,result);await this.save({...l,state:'complete'});
  });
 }
 async fail(jobId:string,id:string,error:RunnerFailure){
  await this.claims(async()=>{const l=await this.active(jobId,id);await this.hooks.fail(jobId,error);await this.save({...l,state:error.uncertain?'uncertain':'failed'});});
 }
 /** Caller must hold exclusive executor ownership before using this. */
 async recoverAfterRestart(){
  const leases=await this.store.list<Lease>('runner-leases');
  this.excludedIds=new Set(leases.map(l=>l.jobId));
  this.ownedLeases=new Map(leases.filter(l=>l.state==='active').map(l=>[l.id,l]));
  await this.recoverExpired(this.ownedLeases,true);
 }
 private async recoverExpired(leases:Map<string,Lease>,all=false){
  for(const l of leases.values())if(l.state==='active'&&(all||l.expiresAt<=this.now())){
   if(l.startedAt===undefined){await this.store.delete('runner-leases',l.id);leases.delete(l.id);this.excludedIds?.delete(l.jobId);continue;}
   await this.hooks.fail(l.jobId,{code:'lease_expired',message:'Execution interrupted; verify the result before retrying.',uncertain:true});
   await this.save({...l,state:'uncertain'});
  }
 }
}
