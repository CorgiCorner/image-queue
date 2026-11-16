import {mkdtemp,readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {prepareLocalQueue} from '../src/storage/prepare-local-queue';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
async function root(){const p=await mkdtemp(join(tmpdir(),'iq-bootstrap-'));roots.push(p);return p;}
it('prepares an empty local queue using the real protocol helpers',async()=>{
 const p=await root();await prepareLocalQueue(p,resolve('.'));expect(await readFile(join(p,'images-todo.md'),'utf8')).toBe('# Image requests\n');expect(await readFile(join(p,'worker.py'),'utf8')).toBe(await readFile('docs/protocol/worker.py','utf8'));
});
it('preserves existing queue entries and helper versions byte for byte',async()=>{
 const p=await root();await writeFile(join(p,'images-todo.md'),'existing reservation');await writeFile(join(p,'worker.py'),'custom helper');await prepareLocalQueue(p,resolve('.'));expect(await readFile(join(p,'images-todo.md'),'utf8')).toBe('existing reservation');expect(await readFile(join(p,'worker.py'),'utf8')).toBe('custom helper');
});
it('rejects a directory occupying a helper path',async()=>{const p=await root();await mkdir(join(p,'worker.py'));await expect(prepareLocalQueue(p,resolve('.'))).rejects.toThrow();});

it('refuses a substituted helper symlink',async()=>{const p=await root();await writeFile(join(p,'outside'),'unrelated');await symlink(join(p,'outside'),join(p,'worker.py'));await expect(prepareLocalQueue(p,resolve('.'))).rejects.toThrow('not a file');expect(await readFile(join(p,'outside'),'utf8')).toBe('unrelated');});
