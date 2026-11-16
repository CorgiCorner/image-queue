import {mkdtemp,writeFile,chmod,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {runCodexProcess} from '../src/storage/codex-process';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
async function fixture(body:string){
 const root=await mkdtemp(join(tmpdir(),'iq-process-test-'));roots.push(root);const executable=join(root,'fake-codex');
 await writeFile(executable,'#!/bin/sh\n'+body);await chmod(executable,0o700);
 return {root,executable,request:{workspace:root,output:join(root,'result.png'),prompt:'test',references:[],model:'gpt-6.1-sol' as const,effort:'low' as const},signal:new AbortController().signal,eventLog:join(root,'events'),errorLog:join(root,'errors'),onStarted:vi.fn(async()=>{})};
}
it('waits for child exit and returns only the expected local file',async()=>{
 const f=await fixture('printf test > result.png\n');const r=await runCodexProcess(f);expect(r.path).toBe(await realpath(f.request.output));expect(f.onStarted).toHaveBeenCalledOnce();expect(await readFile(r.path,'utf8')).toBe('test');
});
it('rejects missing output and nonzero exits',async()=>{
 await expect(runCodexProcess(await fixture('exit 3\n'))).rejects.toThrow('exit 3');
 await expect(runCodexProcess(await fixture('exit 0\n'))).rejects.toThrow();
});
it('cancels the owned process and reports uncertainty',async()=>{
 const f=await fixture('sleep 30\n');const c=new AbortController();f.signal=c.signal;f.onStarted=vi.fn(async()=>{c.abort();});
 await expect(runCodexProcess(f)).rejects.toThrow('uncertain');
},5000);
it('does not start when cancelled or when the output escapes its run directory',async()=>{
 const f=await fixture('exit 0\n');const c=new AbortController();c.abort();
 await expect(runCodexProcess({...f,signal:c.signal})).rejects.toThrow('cancelled');
 await expect(runCodexProcess({...f,request:{...f.request,output:join(tmpdir(),'result.png')}})).rejects.toThrow('private run');
});
