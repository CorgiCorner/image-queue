import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {expect,it} from 'vitest';
import {migrateLegacyLocks} from '../scripts/migrate-legacy-locks';
it('requires an explicit offline confirmation and archives only known empty locks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-legacy-migration-'));
 try{
  await mkdir(join(root,'locks/a.lock'),{recursive:true});await writeFile(join(root,'locks/a.lock/kernel'),'');
  await expect(migrateLegacyLocks(root,false)).rejects.toThrow('offline');
  expect(await migrateLegacyLocks(root,true)).toEqual(['a.lock']);
  expect(await readdir(join(root,'locks'))).toEqual([]);expect(await readdir(join(root,'legacy-lock-archive'))).toHaveLength(1);
  await mkdir(join(root,'locks/b.lock'));await writeFile(join(root,'locks/b.lock/owner'),'unknown');
  await expect(migrateLegacyLocks(root,true)).rejects.toThrow('Unknown');
 }finally{await rm(root,{recursive:true,force:true});}
});
