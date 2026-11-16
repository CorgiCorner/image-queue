import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{expect,it,vi}from'vitest';import{watchQueue}from'../src/storage/watch-queue';
it('observes consecutive atomic replacements of the queue file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-watch-'));await writeFile(join(root,'images-todo.md'),'one');const wake=vi.fn();const stop=watchQueue(root,wake,50);
 try{await new Promise(r=>setTimeout(r,80));for(const text of ['two','three']){wake.mockClear();await writeFile(join(root,'next.tmp'),text);await rename(join(root,'next.tmp'),join(root,'images-todo.md'));await vi.waitFor(()=>expect(wake).toHaveBeenCalled(),{timeout:1000});}}
 finally{stop();await rm(root,{recursive:true,force:true});}
});
it('detects a changed file through the metadata fallback and stops after shutdown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-watch-settle-'));await writeFile(join(root,'images-todo.md'),'one');const wake=vi.fn();const stop=watchQueue(root,wake,50);
 try{
  await new Promise(r=>setTimeout(r,80));wake.mockClear();await writeFile(join(root,'images-todo.md'),'two changed');
  await vi.waitFor(()=>expect(wake).toHaveBeenCalled(),{timeout:1000});
  stop();wake.mockClear();await new Promise(r=>setTimeout(r,150));expect(wake).not.toHaveBeenCalled();
 }finally{stop();await rm(root,{recursive:true,force:true});}
});
