import {spawn} from 'node:child_process';
import {open,realpath,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {codexFailureMessage} from '../core/codex-failure';
import {UserFacingError} from '../core/user-facing-error';
import {codexGenerationArguments,codexProcessEnvironment,type CodexGenerationRequest} from '../core/codex-generation-command';
export interface CodexProcessOptions {
 executable:string; request:CodexGenerationRequest; signal:AbortSignal;
 eventLog:string; errorLog:string; timeoutMs?:number;
 beforeStart?():Promise<void>;
 onStarted(pid:number):Promise<void>;
}
/** Launches one process group. Publication and retry remain the caller's job. */
export async function runCodexProcess(options:CodexProcessOptions) {
 const workspace=await realpath(options.request.workspace);
 const requestedOutput=path.resolve(options.request.output);
 const parent=await realpath(path.dirname(requestedOutput));
 const output=path.join(parent,path.basename(requestedOutput));
 if(parent!==workspace)throw new Error('Generation output must be inside the private run directory');
 if(options.signal.aborted)throw new Error('Generation cancelled');
 const logs=[await open(options.eventLog,'wx',0o600)];
 try {logs.push(await open(options.errorLog,'wx',0o600));} catch(error){await logs[0].close();throw error;}
 try {
  await options.beforeStart?.();
  if(options.signal.aborted)throw new Error('Generation cancelled');
  const child=spawn(options.executable,codexGenerationArguments(options.request),{cwd:workspace,env:codexProcessEnvironment(process.env),stdio:['ignore',logs[0].fd,logs[1].fd],detached:process.platform!=='win32'});
  let killTimer:ReturnType<typeof setTimeout>|undefined;
  let interrupted=false;
  const kill=(signal:NodeJS.Signals)=>{
   if(!child.pid)return;
   try {if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);} catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
  };
  const stop=()=>{interrupted=true;kill('SIGTERM');killTimer??=setTimeout(()=>kill('SIGKILL'),3000);killTimer.unref();};
  options.signal.addEventListener('abort',stop,{once:true});
  if(options.signal.aborted)stop();
  const timeout=setTimeout(stop,options.timeoutMs??180000);timeout.unref();
  const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  try {
   if(!child.pid)await exit;
   else try {await options.onStarted(child.pid);} catch(error){stop();await exit;throw error;}
   const code=await exit;
   if(interrupted||options.signal.aborted)throw new Error('Generation interrupted; result is uncertain');
   if(code!==0){const errors=await readFile(options.errorLog,'utf8');const events=await readFile(options.eventLog,'utf8');throw new UserFacingError(`${codexFailureMessage((errors+'\n'+events).slice(-64000))} (exit ${code})`);}
   const resolved=await realpath(output);
   if(resolved!==output||!(await stat(output)).isFile())throw new Error('Generation did not return the expected local file');
   return {path:output,pid:child.pid};
  } finally {
   clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);options.signal.removeEventListener('abort',stop);
   // Descendants must not survive a completed generation process.
   kill('SIGTERM');
  }
 } finally {await Promise.all(logs.map(log=>log.close()));}
}
