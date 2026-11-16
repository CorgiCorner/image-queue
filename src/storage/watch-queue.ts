import {watch} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
/** Watch the directory because atomic saves replace the file inode. */
export function watchQueue(root:string,wake:()=>void,intervalMs=30000) {
 let closed=false;let checking=false;let fingerprint:string|undefined;
 let settled:ReturnType<typeof setTimeout>|undefined;
 async function check(){
  if(closed||checking)return;checking=true;
  try{const s=await stat(path.join(root,'images-todo.md'));const next=`${s.mtimeMs}:${s.size}:${s.ino}`;
   if(fingerprint!==undefined&&fingerprint!==next&&!closed)wake();fingerprint=next;
  }catch{/* watcher keeps running; executor reports actual access failures */}finally{checking=false;}
 }
 const watcher=watch(root,(_event,file)=>{if(!closed&&(!file||file.toString()==='images-todo.md')){wake();void check();if(settled)clearTimeout(settled);settled=setTimeout(()=>{if(!closed){wake();void check();}},100);settled.unref();}});
 watcher.on('error',()=>{void check();});
 void check();const timer=setInterval(()=>void check(),intervalMs);timer.unref();
 return ()=>{closed=true;clearInterval(timer);if(settled)clearTimeout(settled);watcher.close();};
}
