import {expect,it} from 'vitest';
import {MemoryStorage} from '../src/storage/memory';
import {readLocalRunnerSettings} from '../src/core/local-runner-settings';
it('migrates zero workers to a paused queue without a zero concurrency limit',async()=>{
 const store=new MemoryStorage();await store.put('settings','local-runner',{workers:0});
 expect(await readLocalRunnerSettings(store)).toMatchObject({workers:1,paused:true});
});
it('keeps the desired concurrency while paused',async()=>{
 const store=new MemoryStorage();await store.put('settings','local-runner',{workers:3,paused:true});
 expect(await readLocalRunnerSettings(store)).toMatchObject({workers:3,paused:true});
});
