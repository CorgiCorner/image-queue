/** Shared boundary for an in-process source and a future authenticated remote source. */
export type RunnerCapability = 'codex-image' | 'provider-image';
export interface ClaimedJob<T> { job:T; leaseId:string; expiresAt:string }
export interface RunnerResult { blobKey:string; width:number; height:number; mime:'image/png' }
export interface RunnerFailure { code:string; message:string; uncertain:boolean }
export interface JobSource<T> {
 claim(runnerId:string, capabilities:RunnerCapability[]):Promise<ClaimedJob<T>|null>;
 heartbeat(jobId:string,leaseId:string):Promise<void>;
 start?(jobId:string,leaseId:string):Promise<void>;
 complete(jobId:string,leaseId:string,result:RunnerResult):Promise<void>;
 fail(jobId:string,leaseId:string,error:RunnerFailure):Promise<void>;
}
