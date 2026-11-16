import {execFile} from 'node:child_process';import{promisify}from'node:util';
import{parseCodexLogin,type CodexLogin}from'../core/codex-login';import{codexProcessEnvironment}from'../core/codex-generation-command';
const exec=promisify(execFile);
/** Only status text is classified; credentials are never read or returned. */
export async function readCodexLogin(executable:string):Promise<CodexLogin>{
 try{const r=await exec(executable,['login','status'],{env:codexProcessEnvironment(process.env),timeout:5000,maxBuffer:16384});return parseCodexLogin(r.stdout+'\n'+r.stderr);}
 catch(error){const e=error as {stdout?:string;stderr?:string};return parseCodexLogin((e.stdout??'')+'\n'+(e.stderr??''));}
}
