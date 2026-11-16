import {resolveExecutable} from './resolve-executable';
/** Prefer a stable package-manager link over its versioned Cellar target. */
export async function nodeExecutable() {
 const candidates=[...(process.platform==='darwin'?['/opt/homebrew/bin/node','/usr/local/bin/node']:[]),'node',process.execPath];
 for(const candidate of candidates){try{return await resolveExecutable(candidate);}catch{/* try the next installed path */}}
 return process.execPath;
}
