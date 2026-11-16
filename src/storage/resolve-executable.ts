import {access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
/** Resolve through PATH without freezing a package-manager versioned realpath. */
export async function resolveExecutable(name:string,searchPath=process.env.PATH??'') {
 const candidates=name.includes(path.sep)?[path.resolve(name)]:searchPath.split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,name));
 for(const candidate of candidates){
  try {await access(candidate,constants.X_OK);if((await stat(candidate)).isFile())return candidate;}catch{/* try next PATH entry */}
 }
 throw new Error('Codex CLI is unavailable. Install it and sign in before enabling local execution.');
}
