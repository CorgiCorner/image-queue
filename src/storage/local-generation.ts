import {mkdir,mkdtemp,readFile,realpath,writeFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {Storage} from './types';
import {runCodexAppServer} from './codex-app-server';
import {prepareLocalAttempt,updateLocalAttempt} from '../core/local-worker-attempt';
import {fitImage} from '../sources/image-fit';
import {hasTransparentPixels} from '../sources/image-opacity';
import {hash} from '../core/schema';
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
   try {
    const output=await runCodexAppServer({executable,signal,eventLog:path.join(attempt.directory,'events.jsonl'),errorLog:path.join(attempt.directory,'stderr.log'),beforeStart:async()=>{await updateLocalAttempt(store,attempt.id,'running');const current=await store.get<import('../core/schema').Job>('jobs',job.id);if(current)await store.put('jobs',job.id,{...current,status:'running',attemptId:attempt.id,startedAt:new Date().toISOString()});},onStarted:async()=>{},request:{...job,workspace:attempt.directory,output:path.join(attempt.directory,'original.png'),receipt}});
    const actual=JSON.parse(await readFile(receipt,'utf8'));
    const attached=actual.attachment;
    if(actual.prompt!==job.prompt||JSON.stringify(actual.referencePaths)!==JSON.stringify(job.references)||
      (job.references.length?attached?.parameter!=='referenced_image_paths'||JSON.stringify(attached.value)!==JSON.stringify(job.references):attached!==null))throw new Error('Actual generation receipt does not match requested prompt and references');
    const fitted=await fitImage(new Uint8Array(await readFile(output.path)),job);
    if(job.transparent && !(await hasTransparentPixels(fitted.bytes)))throw new Error('Generated image is not transparent');
    const blobKey=await hash(fitted.bytes);await store.putBlob(blobKey,fitted.bytes,'image/png');
    await writeFile(path.join(attempt.directory,'provenance.md'),`Prompt: ${job.prompt}\nWorker model: ${job.model}\nGenerated: ${new Date().toISOString()}\n`,{mode:0o600});
    for(const name of ['original.png','receipt.json','provenance.md','events.jsonl','stderr.log']){
     try{await copyFile(path.join(attempt.directory,name),path.join(attempt.archive,name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    await writeFile(path.join(attempt.archive,'fitted.png'),fitted.bytes,{mode:0o600});
    await store.put('generation-artifacts',job.id,{image:path.join(attempt.archive,'fitted.png'),receipt:path.join(attempt.archive,'receipt.json'),provenance:path.join(attempt.archive,'provenance.md')});
    // Success is recorded only after the source accepts publication.
    return {blobKey,width:job.width,height:job.height,mime:'image/png'};
   } catch(error) {await updateLocalAttempt(store,attempt.id,'uncertain');throw error;}
  },
  async uncertain(jobId:string) {const a=attempts.get(jobId);if(a){const current=await store.get<{state:string}>('local-attempts',a.id);if(current?.state==='running'||current?.state==='prepared')await updateLocalAttempt(store,a.id,'uncertain');}attempts.delete(jobId);},
  async published(jobId:string) {const a=attempts.get(jobId);if(a){await updateLocalAttempt(store,a.id,'succeeded');await rm(a.directory,{recursive:true,force:true});}attempts.delete(jobId);},
 };
}
