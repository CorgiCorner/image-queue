import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {codexProcessEnvironment} from '../core/codex-generation-command';
import {codexUsage,type CodexUsage} from '../core/codex-usage';
/** Official read-only app-server request. Never reads login files or returns account metadata. */
export async function readCodexUsage(executable:string,timeoutMs=10000):Promise<CodexUsage> {
 const child=spawn(executable,['app-server','--stdio'],{env:codexProcessEnvironment(process.env),stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});
 const lines=createInterface({input:child.stdout});
 return new Promise(resolve=>{
  let settled=false;
  const terminate=(signal:NodeJS.Signals)=>{if(!child.pid)return;try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}};
  const finish=(value:CodexUsage)=>{if(settled)return;settled=true;clearTimeout(timer);lines.close();child.stdin.end();terminate('SIGTERM');const force=setTimeout(()=>terminate('SIGKILL'),500);force.unref();child.once('close',()=>clearTimeout(force));resolve(value);};
  const timer=setTimeout(()=>finish(codexUsage(undefined)),timeoutMs);timer.unref();
  child.on('error',()=>finish(codexUsage(undefined)));child.on('exit',()=>finish(codexUsage(undefined)));
  lines.on('line',line=>{
   let data;try{data=JSON.parse(line);}catch{return;}
   if(data.id===1){if(data.error){finish(codexUsage(undefined));return;}child.stdin.write(JSON.stringify({method:'initialized'})+'\n');child.stdin.write(JSON.stringify({id:2,method:'account/rateLimits/read',params:{}})+'\n');}
   if(data.id===2)finish(codexUsage(data.result));
  });
  child.stdin.on('error',()=>finish(codexUsage(undefined)));
  child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'image_queue_usage',version:'0.1.0'},capabilities:{experimentalApi:true}}})+'\n');
 });
}
