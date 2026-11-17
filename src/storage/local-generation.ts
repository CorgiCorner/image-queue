import {mkdir,mkdtemp,readFile,realpath,writeFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {Storage} from './types';
import {MUTATION_LOCK_WAIT_MS} from './mutation-lock';
import {waitForLock} from './wait-for-lock';
import {runCodexAppServer} from './codex-app-server';
import {prepareLocalAttempt,updateLocalAttempt,recordLocalAttemptFailure} from '../core/local-worker-attempt';
import {fitImage} from '../sources/image-fit';
import {hasTransparentPixels} from '../sources/image-opacity';
import {UserFacingError} from '../core/user-facing-error';
import {hash} from '../core/schema';
import {imageSize} from 'image-size';
import type {RunnerResult} from '../core/job-source';
export interface LocalGenerationJob {
 id:string;prompt:string;references:string[];width:number;height:number;transparent:boolean;
 model:'gpt-6.1-sol'|'gpt-6.1-terra'|'gpt-6-luna';effort:'low'|'medium'|'high'|'xhigh';
}
/** Isolated output folders are persisted with attempts, never shared between jobs. */
export function localGeneration(store:Storage,runRoot:string,executable='codex') {
 const attempts=new Map<string,{id:string;directory:string;archive:string}>();
 return {
  async prepare(job:LocalGenerationJob) {
   const attempt=await prepareLocalAttempt(store,{jobId:job.id,model:job.model,prompt:job.prompt,references:job.references});
   const archive=path.join(runRoot,attempt.id);await mkdir(archive,{recursive:true,mode:0o700});
   const directory=await mkdtemp(path.join(tmpdir(),'image-queue-generation-'));
   attempts.set(job.id,{id:attempt.id,directory:await realpath(directory),archive});
  },
  async generate(job:LocalGenerationJob,signal:AbortSignal):Promise<RunnerResult> {
   const attempt=attempts.get(job.id);if(!attempt)throw new Error('Durable generation attempt missing');
   const receipt=path.join(attempt.directory,'receipt.json');
   const original=path.join(attempt.archive,'original.png');
   let originalArchived=false;
   try {
    const output=await runCodexAppServer({executable,signal,eventLog:path.join(attempt.directory,'events.jsonl'),errorLog:path.join(attempt.directory,'stderr.log'),beforeStart:async()=>{await updateLocalAttempt(store,attempt.id,'running');const current=await store.get<import('../core/schema').Job>('jobs',job.id);if(current)await store.put('jobs',job.id,{...current,status:'running',attemptId:attempt.id,startedAt:new Date().toISOString()});},onStarted:async()=>{},request:{...job,workspace:attempt.directory,output:path.join(attempt.directory,'original.png'),receipt}});
    const actual=JSON.parse(await readFile(receipt,'utf8'));
    const attached=actual.attachment;
    if(actual.prompt!==job.prompt||JSON.stringify(actual.referencePaths)!==JSON.stringify(job.references)||
      (job.references.length?attached?.parameter!=='referenced_image_paths'||JSON.stringify(attached.value)!==JSON.stringify(job.references):attached!==null))throw new UserFacingError('Generation receipt does not match the requested prompt and references. The result was retained for inspection; it was not published.');
    const generatedBytes=new Uint8Array(await readFile(output.path));
    await writeFile(original,generatedBytes,{mode:0o600});
    originalArchived=true;
    const dimensions=imageSize(generatedBytes);
    await waitForLock(store,job.id,async()=>{
     const current=await store.get<import('../core/schema').Job>('jobs',job.id);
     if(current)await store.put('jobs',job.id,{...current,requestedSize:{width:job.width,height:job.height},providerResultSize:{width:dimensions.width,height:dimensions.height}});
    },MUTATION_LOCK_WAIT_MS);
    const fitted=await fitImage(generatedBytes,job).catch(async error=>{
     await store.put('generation-artifacts',job.id,{original});
     throw error;
    });
    if(job.transparent && !(await hasTransparentPixels(fitted.bytes)))throw new UserFacingError('Generated image is not transparent. The result was retained for inspection; it was not published.');
    const blobKey=await hash(fitted.bytes);await store.putBlob(blobKey,fitted.bytes,'image/png');
    await writeFile(path.join(attempt.directory,'provenance.md'),`Prompt: ${job.prompt}\nWorker model: ${job.model}\nGenerated: ${new Date().toISOString()}\n`,{mode:0o600});
    for(const name of ['receipt.json','provenance.md','events.jsonl','stderr.log']){
     try{await copyFile(path.join(attempt.directory,name),path.join(attempt.archive,name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    await writeFile(path.join(attempt.archive,'fitted.png'),fitted.bytes,{mode:0o600});
    await store.put('generation-artifacts',job.id,{original,image:path.join(attempt.archive,'fitted.png'),receipt:path.join(attempt.archive,'receipt.json'),provenance:path.join(attempt.archive,'provenance.md')});
    // Success is recorded only after the source accepts publication.
    return {blobKey,width:job.width,height:job.height,mime:'image/png'};
   } catch(error) {
    // A failed validation or publication must not discard an image already produced.
    const message=error instanceof UserFacingError ? error.message : 'Local generation did not finish validation. Inspect the retained attempt before retrying.';
    let retainedDirectory=attempt.archive;
    for(const name of ['original.png','receipt.json','provenance.md','events.jsonl','stderr.log']) {
     if(name==='original.png' && originalArchived)continue;
     try {await copyFile(path.join(attempt.directory,name),path.join(attempt.archive,name));}
     catch(copyError) {
      // Preserve the original failure even if the durable archive is unavailable.
      // The private working directory remains intact and is recorded for recovery.
      if((copyError as NodeJS.ErrnoException).code!=='ENOENT'){retainedDirectory=attempt.directory;break;}
     }
    }
    await recordLocalAttemptFailure(store,attempt.id,message,retainedDirectory);
    throw error;
   }
  },
  async uncertain(jobId:string,error?:unknown) {
   const a=attempts.get(jobId);
   if(a){
    const current=await store.get<{state:string;error?:string;artifactDirectory?:string}>('local-attempts',a.id);
    if(current?.state!=='succeeded')await recordLocalAttemptFailure(store,a.id,current?.error ?? (error instanceof UserFacingError ? error.message : 'Local delivery did not complete. Inspect the retained result before retrying.'),current?.artifactDirectory ?? a.archive);
   }
   attempts.delete(jobId);
  },
  async published(jobId:string) {const a=attempts.get(jobId);if(a){await updateLocalAttempt(store,a.id,'succeeded');await rm(a.directory,{recursive:true,force:true});}attempts.delete(jobId);},
 };
}
