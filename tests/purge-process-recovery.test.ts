import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{expect,it}from'vitest';import{FileStorage}from'../src/storage/fs';
function line(c:ChildProcess){return new Promise<string>((res,rej)=>{let text='';c.stdout!.on('data',v=>{text+=v;if(text.includes('\n'))res(text.trim());});c.on('error',rej);c.on('exit',()=>{if(!text)rej(Error('Process exited without result'));});});}
it('recovers a real disk purge after its process is killed with the journal and locks held',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-purge-crash-'));let child:ChildProcess|undefined;
 try{
  const store=new FileStorage(root);for(const id of ['one','two'])await store.put('jobs',id,{id,status:'done',trashedAt:new Date().toISOString(),blobKey:'results/'+id});
  for(const id of ['one','two'])await store.putBlob('results/'+id,new Uint8Array([1,2,3]),'image/png');
  const run=(mode:string)=>spawn(process.execPath,['--import','tsx',resolve('tests/purge-process-fixture.ts'),root,mode],{stdio:['ignore','pipe','pipe']});
  child=run('interrupt');expect(await line(child)).toBe('JOURNALED');expect((await store.list<{complete:boolean}>('purge-operations'))[0].complete).toBe(false);
  child.kill('SIGKILL');await once(child,'exit');child=run('recover');const result=JSON.parse(await line(child));expect(result).toEqual({jobs:0,tombstones:2,complete:true});
  expect(await store.getBlob('results/one')).toBeUndefined();expect(await store.getBlob('results/two')).toBeUndefined();
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}await rm(root,{recursive:true,force:true});}
},20000);
