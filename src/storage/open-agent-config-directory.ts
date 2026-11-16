import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {access,stat} from 'node:fs/promises';
import path from 'node:path';
import {UserFacingError} from '../core/user-facing-error';

export function agentConfigDirectory(client:'Codex'|'Claude Code',home=homedir(),cwd=process.cwd()) {
 return client==='Codex'?path.join(home,'.codex'):cwd;
}
export function fileManagerCommand(platform:string,directory:string):[string,string[]] {
 if(platform==='darwin')return ['/usr/bin/open',[directory]];
 if(platform==='win32')return ['explorer.exe',[directory]];
 if(platform==='linux')return ['xdg-open',[directory]];
 throw new UserFacingError('Opening folders is not available on this system');
}
/** Fixed destinations only. Never accepts an arbitrary path from the browser. */
export async function openAgentConfigDirectory(client:'Codex'|'Claude Code') {
 const directory=agentConfigDirectory(client);
 try{await access(directory);if(!(await stat(directory)).isDirectory())throw new Error('Not a directory');}
 catch{throw new UserFacingError('The configuration folder does not exist yet. Set up this client first.');}
 const [command,args]=fileManagerCommand(process.platform,directory);
 try{await promisify(execFile)(command,args,{timeout:5000,windowsHide:true});}
 catch{throw new UserFacingError('Could not open the configuration folder in your file manager');}
}
