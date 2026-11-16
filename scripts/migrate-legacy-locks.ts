import {lstat,readdir,rename,open,mkdir} from 'node:fs/promises';
import path from 'node:path';
import native from 'fs-native-extensions';

/** Run only after all older app/MCP processes using this store have stopped. */
export async function migrateLegacyLocks(root:string,offlineConfirmed:boolean) {
 if(!offlineConfirmed)throw new Error('Stop every older app and MCP process, then explicitly confirm the store is offline.');
 const directory=path.join(root,'locks');
 const names=await readdir(directory);
 const moved:string[]=[];
 for(const name of names.filter(name=>name.endsWith('.lock'))){
  const legacy=path.join(directory,name),info=await lstat(legacy);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unexpected legacy lock path');
  const contents=await readdir(legacy);
  if(contents.some(entry=>entry!=='kernel'))throw new Error('Unknown lock contents; manual inspection required');
  let handle;
  try {
   if(contents.length){
    const file=path.join(legacy,'kernel'),metadata=await lstat(file);
    if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size!==0)throw new Error('Unknown lock owner data; manual inspection required');
    handle=await open(file,'r+');
    if(!native.tryLock(handle.fd))throw new Error('A legacy process still owns this lock');
   }
   const archive=path.join(root,'legacy-lock-archive');await mkdir(archive,{recursive:true,mode:0o700});
   await rename(legacy,path.join(archive,`${name}-${crypto.randomUUID()}`));moved.push(name);
  }finally{await handle?.close();}
 }
 return moved;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const root=process.argv[2];if(!root)throw new Error('Usage: tsx scripts/migrate-legacy-locks.ts STORE --offline-confirmed');
 console.log(JSON.stringify({archived:await migrateLegacyLocks(path.resolve(root),process.argv.includes('--offline-confirmed'))}));
}
