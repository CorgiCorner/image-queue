import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {FileStorage} from '../src/storage/fs';
const roots:string[]=[];const children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function root(){const p=await mkdtemp(join(tmpdir(),'iq-lock-recovery-'));roots.push(p);return p;}
function run(root:string,action:string){const c=spawn(process.execPath,['--import','tsx',resolve('tests/file-lock-process-fixture.ts'),root,action],{stdio:['ignore','pipe','pipe','ipc']});children.push(c);return c;}
function output(c:ChildProcess){return new Promise<string>((res,rej)=>{let text='';c.stdout!.on('data',v=>{text+=v;if(text.includes('\n'))res(text.trim());});c.on('error',rej);c.on('exit',()=>{if(!text)rej(Error('Child exited without lock result'));});});}
it('releases a process lock after SIGKILL without stealing it while alive',async()=>{
 const p=await root();const owner=run(p,'hold');expect(await output(owner)).toBe('ACQUIRED');
 const contender=run(p,'once');expect(await output(contender)).toBe('BUSY');
 owner.kill('SIGKILL');await once(owner,'exit');
 const successor=run(p,'once');expect(await output(successor)).toBe('ACQUIRED');
},15000);
it('does not steal a legacy directory lock with no ownership metadata',async()=>{
 const p=await root();await mkdir(join(p,'locks/crash-check.lock'),{recursive:true});
 await expect(new FileStorage(p).lock('crash-check',async()=>1)).rejects.toThrow('progress');
});
it('does not follow a substituted lock file symlink',async()=>{
 const p=await root();const store=new FileStorage(p);await store.lock('crash-check',async()=>1);
 const file=join(p,'locks/crash-check.kernel');await rm(file);await symlink(join(p,'victim'),file);
 await expect(store.lock('crash-check',async()=>1)).rejects.toThrow();
});
it('permits only one of two simultaneous successors after a crash',async()=>{
 const p=await root();const owner=run(p,'hold');expect(await output(owner)).toBe('ACQUIRED');
 owner.kill('SIGKILL');await once(owner,'exit');
 const a=run(p,'hold'),b=run(p,'hold');
 const results=await Promise.all([output(a),output(b)]);
 expect([...results].sort()).toEqual(['ACQUIRED','BUSY']);
 const winner=[a,b][results.indexOf('ACQUIRED')];
 await new Promise<void>((resolve,reject)=>winner.send('release',error=>error?reject(error):resolve()));
},15000);
